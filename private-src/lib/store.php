<?php

// No declare(strict_types=1) -- see the note in config.php.

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/render.php';
require_once __DIR__ . '/validate.php';

/**
 * private/furnist365/site.json: load, save, back up, restore.
 *
 * Port of server/store.py. The owner's live copy is the only copy of this
 * data, so fc365_store_save() is deliberately paranoid and deliberately
 * ordered:
 *
 *     validate -> render -> back up -> tmp+rename JSON -> tmp+rename JS
 *
 * JSON first, JS second. The only crash window that leaves the two out of
 * step leaves NEW JSON and STALE JS, so the storefront keeps rendering the
 * previous, complete content -- never half-rendered, never blank.
 * POST /api/admin/publish re-derives the JS.
 *
 * Structural difference from the Python version: there is no long-lived
 * process to hold an in-memory threading.RLock() across a request. The
 * cross-process equivalent, used by fc365_store_mutate() below, is
 * flock(LOCK_EX) on a DEDICATED lock file (site.json.lock, never site.json
 * itself -- a rename() would swap the inode out from under an open locked
 * descriptor). Plain reads (fc365_store_load()) need no lock at all: an
 * atomic rename() means a concurrent reader can only ever see a fully old
 * or fully new file, never a torn one.
 */

class StoreError extends Exception
{
}

class StoreUnreadable extends Exception
{
}

class StaleRev extends Exception
{
    public int $current;

    public function __construct(int $current)
    {
        $this->current = $current;
        parent::__construct("stale rev; the current one is $current");
    }
}

/** fc365_store_restore() was asked for a backup filename that is not listed. */
class BackupNotFound extends Exception
{
}

function fc365_utc_now(): DateTimeImmutable
{
    return new DateTimeImmutable('now', new DateTimeZone('UTC'));
}

function fc365_iso(DateTimeImmutable $dt): string
{
    return $dt->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d\TH:i:s\Z');
}

function fc365_store_exists(): bool
{
    return is_file(FC365_SITE_JSON);
}

/**
 * Parse site.json. Raises StoreUnreadable. Ensures _meta defaults.
 *
 * Not lock-guarded -- see the module docstring above for why a plain read
 * needs none.
 */
function fc365_store_load(): array
{
    if (!fc365_store_exists()) {
        throw new StoreUnreadable('site.json does not exist');
    }
    $text = @file_get_contents(FC365_SITE_JSON);
    if ($text === false) {
        throw new StoreUnreadable('site.json could not be read');
    }
    $doc = json_decode($text, true);
    if (json_last_error() !== JSON_ERROR_NONE) {
        throw new StoreUnreadable('site.json could not be parsed: ' . json_last_error_msg());
    }
    if (!fc365_is_dict($doc)) {
        throw new StoreUnreadable('site.json is not a JSON object');
    }
    if (!isset($doc['_meta']) || !is_array($doc['_meta'])) {
        $doc['_meta'] = [];
    }
    if (!isset($doc['_meta']['schema'])) {
        $doc['_meta']['schema'] = FC365_SCHEMA_VERSION;
    }
    if (!isset($doc['_meta']['rev'])) {
        $doc['_meta']['rev'] = 1;
    }
    if (!isset($doc['_meta']['updatedAt'])) {
        $doc['_meta']['updatedAt'] = fc365_iso(fc365_utc_now());
    }
    return $doc;
}

/** A fresh, independently-owned copy of the current document. */
function fc365_store_get_doc(): array
{
    return fc365_store_load();
}

function fc365_store_rev(): int
{
    $doc = fc365_store_load();
    return (int) ($doc['_meta']['rev'] ?? 0);
}

/** Warm a readiness check. Returns null on failure instead of raising. */
function fc365_store_try_load(): ?array
{
    try {
        return fc365_store_load();
    } catch (StoreUnreadable $e) {
        return null;
    }
}

// --------------------------------------------------------------- backups
/**
 * site-YYYYmmdd-HHMMSS-ffffff-NN.json - every field fixed-width.
 *
 * Every field is fixed-width so plain string sort is chronological sort,
 * with no exceptions -- fc365_list_backups() and fc365_store_restore() both
 * sort filenames as strings. The sequence number is always present (not
 * only appended on a same-second collision) so there is never a
 * "with suffix vs without suffix" string-sort ambiguity.
 */
function fc365_backup_name(DateTimeImmutable $when, int $seq): string
{
    $stamp = $when->format('Ymd-His-u');
    return sprintf('site-%s-%02d.json', $stamp, $seq);
}

/** Newest first. */
function fc365_list_backups(): array
{
    fc365_ensure_private_dir(FC365_BACKUP_DIR);
    $out = [];
    $names = scandir(FC365_BACKUP_DIR);
    if ($names === false) {
        return $out;
    }
    foreach ($names as $name) {
        if (!str_starts_with($name, 'site-') || !str_ends_with($name, '.json')) {
            continue;
        }
        $full = FC365_BACKUP_DIR . '/' . $name;
        $stat = @stat($full);
        if ($stat === false) {
            continue;
        }
        $out[] = [
            'file' => $name,
            'bytes' => $stat['size'],
            'at' => fc365_iso((new DateTimeImmutable('@' . $stat['mtime']))),
        ];
    }
    usort($out, fn($a, $b) => strcmp($b['file'], $a['file']));
    return $out;
}

/** Copy the current site.json aside. Returns its path, or null if there is none. */
function fc365_take_backup(): ?string
{
    if (!fc365_store_exists()) {
        return null;
    }
    fc365_ensure_private_dir(FC365_BACKUP_DIR);
    $when = fc365_utc_now();
    $seq = 0;
    $name = fc365_backup_name($when, $seq);
    $target = FC365_BACKUP_DIR . '/' . $name;
    while (file_exists($target)) {
        $seq++;
        $name = fc365_backup_name($when, $seq);
        $target = FC365_BACKUP_DIR . '/' . $name;
    }
    if (!copy(FC365_SITE_JSON, $target)) {
        throw new StoreError('could not create a backup before writing');
    }
    fc365_prune_backups();
    return $target;
}

function fc365_prune_backups(): void
{
    $rows = fc365_list_backups();
    foreach (array_slice($rows, FC365_BACKUP_KEEP) as $row) {
        @unlink(FC365_BACKUP_DIR . '/' . $row['file']);
    }
}

// ---------------------------------------------------------- atomic write
/**
 * tmp (beside target) -> fflush -> rename. Atomic on the same filesystem on
 * Linux, the same guarantee os.replace() gave the Python version.
 *
 * The one real, stated gap versus Python: no PHP core fsync(). flush()
 * (fflush()) clears PHP's own userland buffer and hands the bytes to the
 * OS, but neither forces a physical disk flush the way os.fsync() did. This
 * is a narrow durability gap (a hard power loss in the split second before
 * the OS's own page cache flush could theoretically lose the last write)
 * that does not affect atomicity: a reader can never observe a half-written
 * file either way. See docs/php-admin-architecture.md sections 4 and 10.
 *
 * The tmp file sits directly beside its target (never a shared tmp
 * directory), so rename() never has to cross a filesystem boundary.
 */
function fc365_atomic_write(string $target, string $text): void
{
    $tmp = $target . '.tmp';
    $fp = @fopen($tmp, 'wb');
    if ($fp === false) {
        throw new StoreError("could not open $tmp for writing");
    }
    try {
        if (fwrite($fp, $text) === false) {
            throw new StoreError("could not write to $tmp");
        }
        fflush($fp);
    } finally {
        fclose($fp);
    }
    if (!rename($tmp, $target)) {
        @unlink($tmp);
        throw new StoreError("could not rename $tmp to $target");
    }
}

/**
 * The write sequence (architecture section 4/8). Returns [rev, warnings].
 * Raises ValidationError / StoreError / RenderError.
 *
 * MUST be called only from inside fc365_store_mutate()'s lock hold (or from
 * fc365_store_restore(), which itself holds the lock across this call) --
 * see the warning on fc365_store_mutate().
 */
function fc365_store_save(array $doc, bool $bump = true): array
{
    // 0. The document that lands on disk must already carry its new revision.
    $meta = is_array($doc['_meta'] ?? null) ? $doc['_meta'] : [];
    $meta['schema'] = FC365_SCHEMA_VERSION;
    if ($bump) {
        $current = (int) ($meta['rev'] ?? 0);
        $meta['rev'] = $current + 1;
    }
    $meta['updatedAt'] = fc365_iso(fc365_utc_now());
    $doc['_meta'] = $meta;

    // 1. Validate the WHOLE document, not the delta. Normalises in place.
    $warnings = fc365_validate_document($doc);

    // 2. Serialise, then parse the result back as a self-check.
    $text = json_encode($doc, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT);
    if ($text === false) {
        throw new StoreError('the document could not be serialised to JSON: ' . json_last_error_msg());
    }
    $text .= "\n";
    json_decode($text, true);
    if (json_last_error() !== JSON_ERROR_NONE) {
        throw new StoreError('the document did not survive a JSON round trip: ' . json_last_error_msg());
    }

    // 3. Render BEFORE writing anything, so a render bug cannot leave a
    //    good JSON next to a broken JS. May throw RenderError; propagates.
    $jsText = fc365_build_js($doc);

    // 4. Back up what is currently on disk.
    $backup = fc365_take_backup();

    // 5. JSON first.
    try {
        fc365_atomic_write(FC365_SITE_JSON, $text);
    } catch (StoreError $e) {
        throw new StoreError('could not write site.json: ' . $e->getMessage());
    }

    // 6. JS second.
    try {
        fc365_atomic_write(FC365_DATA_JS, $jsText);
    } catch (StoreError $e) {
        // 7. Put the JSON back so the two files stay in step.
        if ($backup !== null) {
            @copy($backup, FC365_SITE_JSON);
        }
        throw new StoreError('could not write assets/js/data.js: ' . $e->getMessage());
    }

    return [(int) $meta['rev'], $warnings];
}

/**
 * Acquire the dedicated site.json lock and run $fn() while holding it,
 * releasing it (and closing the descriptor) even if $fn() throws. Shared by
 * fc365_store_mutate(), fc365_store_restore() and bootstrap's direct save
 * (see lib/api.php) -- every write path takes the same lock, no exceptions.
 */
function fc365_with_site_lock(callable $fn)
{
    fc365_ensure_private_dir(FC365_PRIVATE_ROOT);
    $fp = fopen(FC365_SITE_JSON_LOCK, 'c+');
    if ($fp === false) {
        throw new StoreError('could not open the site.json lock file');
    }
    try {
        if (!flock($fp, LOCK_EX)) {
            throw new StoreError('could not acquire the site.json lock');
        }
        try {
            return $fn();
        } finally {
            flock($fp, LOCK_UN);
        }
    } finally {
        fclose($fp);
    }
}

/** fc365_store_save(), but under the site.json lock. Used by bootstrap. */
function fc365_store_save_locked(array $doc, bool $bump = true): array
{
    return fc365_with_site_lock(fn() => fc365_store_save($doc, $bump));
}

/**
 * Atomically: read -> check `rev` -> $applyFn($doc) -> save. One flock hold.
 *
 * This closes the read-check-mutate-write race (architecture bug class #2):
 * every mutating handler in lib/api.php goes through this function and
 * ONLY this function. There is no code path anywhere that reads the doc,
 * checks rev, and calls fc365_store_save() separately outside this lock.
 *
 * $applyFn(array $doc): array receives the freshly loaded, rev-confirmed
 * document (owned exclusively by this call, under the lock) and must
 * return the document to save (usually the same array, mutated). It may
 * throw anything (e.g. ApiError for duplicate_id/not_found); whatever it
 * throws propagates out of this function after the lock is released, and
 * nothing is written. Any reference-integrity / duplicate-id / not-found
 * check that needs the CURRENT state belongs inside $applyFn, precisely so
 * it runs against state that cannot change out from under it before the
 * write happens.
 *
 * Throws StaleRev(current) if the on-disk rev is not $rev.
 */
function fc365_store_mutate(int $rev, callable $applyFn): array
{
    return fc365_with_site_lock(function () use ($rev, $applyFn): array {
        $doc = fc365_store_load();
        $current = (int) ($doc['_meta']['rev'] ?? 0);
        if ($rev !== $current) {
            throw new StaleRev($current);
        }
        $doc = $applyFn($doc);
        return fc365_store_save($doc);
    });
}

/** Re-derive assets/js/data.js from site.json. Does not touch the JSON or rev. */
function fc365_store_publish(): array
{
    $doc = fc365_store_load();
    $jsText = fc365_build_js($doc);
    try {
        fc365_atomic_write(FC365_DATA_JS, $jsText);
    } catch (StoreError $e) {
        throw new StoreError('could not write assets/js/data.js: ' . $e->getMessage());
    }
    return [strlen($jsText), (int) ($doc['_meta']['rev'] ?? 0)];
}

/**
 * Swap a listed backup in through the same atomic path. Takes a backup
 * first, so a restore is itself undoable. Held under the same site.json
 * lock as fc365_store_mutate(), for the same reason.
 */
function fc365_store_restore(string $filename): array
{
    return fc365_with_site_lock(function () use ($filename): array {
        // The filename is matched against the listing, never joined from
        // user input.
        $listed = array_column(fc365_list_backups(), 'file');
        if (!in_array($filename, $listed, true)) {
            throw new BackupNotFound($filename);
        }
        $source = FC365_BACKUP_DIR . '/' . $filename;
        $text = @file_get_contents($source);
        if ($text === false) {
            throw new StoreError('that backup could not be read');
        }
        $doc = json_decode($text, true);
        if (json_last_error() !== JSON_ERROR_NONE || !fc365_is_dict($doc)) {
            throw new StoreError('that backup is not a JSON object');
        }

        // Keep moving forward: the restored content gets the next rev,
        // never an older one, so any admin tab holding the current rev
        // still gets its 409.
        try {
            $current = (int) (fc365_store_load()['_meta']['rev'] ?? 0);
        } catch (StoreUnreadable $e) {
            $current = 0;
        }
        if (!isset($doc['_meta']) || !is_array($doc['_meta'])) {
            $doc['_meta'] = [];
        }
        $doc['_meta']['rev'] = $current;
        return fc365_store_save($doc, true);
    });
}
