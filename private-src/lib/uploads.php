<?php

// No declare(strict_types=1) -- see the note in config.php.

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/render.php'; // fc365_slug()
require_once __DIR__ . '/store.php'; // fc365_iso()/fc365_utc_now(), for image listing mtimes

/**
 * Image upload, listing and deletion. Port of server/uploads.py.
 *
 * Base64 inside JSON, not multipart/form-data -- the frozen contract's
 * choice, unchanged here (architecture section 7.1).
 *
 * The client's filename is never used as a filename. The server regenerates
 * it from a slug of the basename plus the extension implied by the SNIFFED
 * type -- never the claimed one. Magic-byte sniffing is hand-ported (not
 * delegated to finfo/exif_imagetype), per architecture section 7.3.
 */

class UploadError extends Exception
{
    public int $status;
    public string $error;
    public array $extra;

    public function __construct(int $status, string $error, string $message, array $extra = [])
    {
        $this->status = $status;
        $this->error = $error;
        $this->extra = $extra;
        parent::__construct($message);
    }
}

// ----------------------------------------------------------- magic bytes
/** Return 'jpg'|'png'|'gif'|'webp'|'svg'|null. Extension is never trusted. */
function fc365_upload_sniff(string $data): ?string
{
    if (strlen($data) < 12) {
        return null;
    }
    if (substr($data, 0, 3) === "\xff\xd8\xff") {
        return 'jpg';
    }
    if (substr($data, 0, 8) === "\x89PNG\x0d\x0a\x1a\x0a") {
        return 'png';
    }
    $head6 = substr($data, 0, 6);
    if ($head6 === 'GIF87a' || $head6 === 'GIF89a') {
        return 'gif';
    }
    if (substr($data, 0, 4) === 'RIFF' && substr($data, 8, 4) === 'WEBP') {
        return 'webp';
    }
    $head = ltrim(substr($data, 0, 512));
    if (substr($head, 0, 5) === '<svg ' || substr($head, 0, 5) === "<svg\n" || substr($head, 0, 4) === '<svg') {
        return 'svg';
    }
    if (substr($head, 0, 5) === '<?xml' && str_contains(substr($data, 0, 4096), '<svg')) {
        return 'svg';
    }
    return null;
}

define('FC365_EXT_ALIASES', [
    'jpeg' => 'jpg', 'jpg' => 'jpg', 'png' => 'png', 'gif' => 'gif', 'webp' => 'webp', 'svg' => 'svg',
]);

function fc365_upload_claimed_extension($filename): ?string
{
    if (!is_string($filename) || !str_contains($filename, '.')) {
        return null;
    }
    $parts = explode('.', $filename);
    $ext = strtolower(trim((string) end($parts)));
    return FC365_EXT_ALIASES[$ext] ?? null;
}

// ------------------------------------------------------------ dimensions
/** Little-endian unsigned integer from raw bytes of any length. */
function fc365_le_uint(string $bytes): int
{
    $value = 0;
    for ($i = strlen($bytes) - 1; $i >= 0; $i--) {
        $value = ($value << 8) | ord($bytes[$i]);
    }
    return $value;
}

/** Read width/height out of the header bytes. Returns [w, h] or [null, null]. */
function fc365_upload_dimensions(string $data, string $kind): array
{
    $len = strlen($data);
    try {
        if ($kind === 'png') {
            if ($len < 24 || substr($data, 12, 4) !== 'IHDR') {
                return [null, null];
            }
            $u = unpack('N2', substr($data, 16, 8));
            return $u ? [$u[1], $u[2]] : [null, null];
        }
        if ($kind === 'gif') {
            if ($len < 10) {
                return [null, null];
            }
            $u = unpack('v2', substr($data, 6, 4));
            return $u ? [$u[1], $u[2]] : [null, null];
        }
        if ($kind === 'webp') {
            if ($len < 16) {
                return [null, null];
            }
            $chunk = substr($data, 12, 4);
            if ($chunk === 'VP8X') {
                if ($len < 30) {
                    return [null, null];
                }
                $w = fc365_le_uint(substr($data, 24, 3)) + 1;
                $h = fc365_le_uint(substr($data, 27, 3)) + 1;
                return [$w, $h];
            }
            if ($chunk === 'VP8 ') {
                if ($len < 30) {
                    return [null, null];
                }
                $u = unpack('v2', substr($data, 26, 4));
                return $u ? [$u[1], $u[2]] : [null, null];
            }
            if ($chunk === 'VP8L') {
                if ($len < 25) {
                    return [null, null];
                }
                $bits = fc365_le_uint(substr($data, 21, 4));
                return [($bits & 0x3FFF) + 1, (($bits >> 14) & 0x3FFF) + 1];
            }
            return [null, null];
        }
        if ($kind === 'jpg') {
            $i = 2;
            $end = $len;
            while ($i + 9 < $end) {
                if (ord($data[$i]) !== 0xFF) {
                    $i++;
                    continue;
                }
                $marker = ord($data[$i + 1]);
                if ($marker === 0xD8 || $marker === 0x01 || ($marker >= 0xD0 && $marker <= 0xD7)) {
                    $i += 2;
                    continue;
                }
                $lu = unpack('n', substr($data, $i + 2, 2));
                if (!$lu) {
                    return [null, null];
                }
                $length = $lu[1];
                // SOF0..SOF15, minus the DHT/JPG/DAC markers that share the range.
                if ($marker >= 0xC0 && $marker <= 0xCF && !in_array($marker, [0xC4, 0xC8, 0xCC], true)) {
                    $hw = unpack('n2', substr($data, $i + 5, 4));
                    if (!$hw) {
                        return [null, null];
                    }
                    return [$hw[2], $hw[1]]; // stream order is height,width; we return width,height
                }
                $i += 2 + $length;
            }
            return [null, null];
        }
    } catch (\Throwable $e) {
        return [null, null];
    }
    return [null, null];
}

// -------------------------------------------------------------- svg scrub
define('FC365_SVG_BANNED', [
    '<script', '<foreignobject', '<!entity', 'javascript:', '<use', '<handler', '<set',
]);

/** A blocklist, and blocklists leak -- see the residual-risk note in docs/php-admin.md. */
function fc365_upload_check_svg(string $data): void
{
    $low = strtolower($data);
    foreach (FC365_SVG_BANNED as $token) {
        if (str_contains($low, $token)) {
            throw new UploadError(
                415,
                'bad_image',
                "That SVG contains $token, which is not allowed in an uploaded logo."
            );
        }
    }
    if (preg_match('~\son[a-zA-Z]+\s*=~', $low)) {
        throw new UploadError(415, 'bad_image', "That SVG carries an event handler attribute (on...=).");
    }
    if (preg_match_all('~(?:xlink:)?href\s*=\s*(["\'])(.*?)\1~i', $data, $matches)) {
        foreach ($matches[2] as $target) {
            $target = strtolower(trim($target));
            if ($target !== '' && !str_starts_with($target, '#')) {
                throw new UploadError(
                    415,
                    'bad_image',
                    'That SVG links off-origin; only same-document #refs are allowed.'
                );
            }
        }
    }

    // DOMDocument, LIBXML_NONET only -- never LIBXML_NOENT / LIBXML_DTDLOAD /
    // LIBXML_DTDATTR, which would ask libxml to resolve/substitute entities
    // (the classic XXE surface Python's xml.etree.ElementTree does not
    // share). This is a PHP-specific hardening the Python version did not
    // need -- see architecture section 7.4.
    $priorUseErrors = libxml_use_internal_errors(true);
    libxml_clear_errors();
    $dom = new DOMDocument();
    $ok = @$dom->loadXML($data, LIBXML_NONET);
    $errors = libxml_get_errors();
    libxml_clear_errors();
    libxml_use_internal_errors($priorUseErrors);

    if (!$ok || $dom->documentElement === null) {
        $detail = $errors[0]->message ?? 'unknown parse error';
        throw new UploadError(415, 'bad_image', 'That SVG is not well-formed XML: ' . trim($detail));
    }
    $tag = strtolower($dom->documentElement->localName ?? $dom->documentElement->nodeName);
    if ($tag !== 'svg') {
        throw new UploadError(415, 'bad_image', "That file's root element is <$tag>, not <svg>.");
    }
}

// ------------------------------------------------------------- filenames
/** slug(basename)[:60] restricted to [a-z0-9-], empty -> img, + sniffed extension. */
function fc365_upload_safe_name($filename, string $extension): string
{
    $base = basename((string) ($filename ?? ''));
    $dot = strrpos($base, '.');
    if ($dot !== false) {
        $base = substr($base, 0, $dot);
    }
    $name = trim(substr(fc365_slug($base), 0, 60), '-');
    if ($name === '') {
        $name = 'img';
    }
    return "$name.$extension";
}

function fc365_upload_unique_path(string $directory, string $name): string
{
    $dot = strrpos($name, '.');
    $stem = substr($name, 0, $dot);
    $ext = substr($name, $dot + 1);
    $candidate = $name;
    $counter = 1;
    while (file_exists($directory . '/' . $candidate)) {
        $counter++;
        $candidate = "$stem-$counter.$ext";
    }
    return $candidate;
}

// ---------------------------------------------------------------- upload
/** Returns [path, bytes, width, height]. Throws UploadError. */
function fc365_store_upload($folder, $filename, $b64): array
{
    // 1. Dict whitelist. Never build a path by concatenating user input.
    $relDir = is_string($folder) ? (FC365_IMAGE_FOLDERS[$folder] ?? null) : null;
    if ($relDir === null) {
        $shown = is_string($folder) ? $folder : json_encode($folder);
        throw new UploadError(400, 'bad_folder', "Unknown image folder '$shown'.");
    }
    $directory = FC365_PUBLIC_ROOT . '/' . $relDir;
    if (!is_dir($directory)) {
        throw new UploadError(400, 'bad_folder', "The $folder folder does not exist on disk.");
    }

    if (!is_string($b64) || trim($b64) === '') {
        throw new UploadError(400, 'empty_file', 'The uploaded file is empty.');
    }
    $payload = trim($b64);
    if (str_starts_with($payload, 'data:')) {
        $commaAt = strpos($payload, ',');
        $payload = $commaAt === false ? '' : substr($payload, $commaAt + 1);
    }
    $data = base64_decode($payload, true);
    if ($data === false) {
        throw new UploadError(400, 'bad_request', "'data' must be base64 with no data: prefix.");
    }
    if ($data === '') {
        throw new UploadError(400, 'empty_file', 'The uploaded file is empty.');
    }
    if (strlen($data) > FC365_MAX_UPLOAD_BYTES) {
        throw new UploadError(
            413,
            'too_large',
            sprintf(
                'That image is %.1f MB; the limit is %d MB.',
                strlen($data) / 1048576.0,
                intdiv(FC365_MAX_UPLOAD_BYTES, 1048576)
            )
        );
    }

    // 4. Magic sniff, and the claimed extension must agree with it.
    $kind = fc365_upload_sniff($data);
    if ($kind === null) {
        throw new UploadError(415, 'bad_image', 'File content is not a valid JPEG/PNG/WEBP/GIF.');
    }
    $claimed = fc365_upload_claimed_extension($filename);
    if ($claimed !== null && $claimed !== $kind) {
        throw new UploadError(
            415,
            'bad_image',
            "That file is named .$claimed but its contents are " . strtoupper($kind) . '.'
        );
    }

    // 5. SVG only into the two logo folders, and only after the scrub.
    if ($kind === 'svg') {
        if (!in_array($folder, FC365_SVG_FOLDERS, true)) {
            throw new UploadError(415, 'bad_image', 'SVG is only accepted into the brand and brands folders.');
        }
        fc365_upload_check_svg($data);
        $width = $height = null;
    } else {
        // 6. Dimensions from the header bytes.
        [$width, $height] = fc365_upload_dimensions($data, $kind);
        if ($width && $height && ($width > FC365_MAX_IMAGE_PX || $height > FC365_MAX_IMAGE_PX)) {
            throw new UploadError(
                415,
                'bad_image',
                "That image is {$width}x{$height}; the limit is " . FC365_MAX_IMAGE_PX . ' px on either axis.'
            );
        }
    }

    // 7. Regenerate the name from the sniffed type.
    $name = fc365_upload_safe_name($filename, $kind === 'jpg' ? 'jpg' : $kind);

    // 8. Python's BoundedSemaphore(2) upload concurrency cap is deliberately
    // dropped here -- meaningless across independent PHP-FPM worker
    // processes; pm.max_children is the hosting-layer equivalent. See
    // architecture section 7.6.
    $name = fc365_upload_unique_path($directory, $name);

    // Belt and braces containment check. The architecture doc's own example
    // (section 7.5) calls realpath() on the FINAL path and checks the
    // result starts with the resolved directory -- that works in Python
    // because os.path.realpath() resolves a path lexically even when the
    // final component does not exist yet. PHP's realpath() does not share
    // that behaviour: it returns false for ANY path whose target does not
    // already exist on disk, which a brand-new upload never does before
    // this write. Ported as literally shown, every single upload would
    // fail this check. The fix used here: resolve realpath() on the
    // DIRECTORY (which does exist) once, and confirm $name -- which this
    // function generated itself via fc365_upload_safe_name()/
    // fc365_upload_unique_path(), restricted to [a-z0-9-] plus one dot and
    // a known extension -- contains no path separator or ".." segment, so
    // concatenating it onto the resolved directory cannot escape it. This
    // is flagged in the final report as a deviation from the architecture
    // doc's literal snippet, not a silent one.
    $realDir = realpath($directory);
    if (
        $realDir === false
        || $name === '' || $name === '.' || $name === '..'
        || str_contains($name, '/') || str_contains($name, '\\')
    ) {
        throw new UploadError(400, 'bad_path', 'Refusing to write outside the image folder.');
    }
    $final = $realDir . DIRECTORY_SEPARATOR . $name;
    $fp = fopen($final, 'wb');
    if ($fp === false) {
        throw new UploadError(500, 'internal_error', 'Could not write the uploaded file.');
    }
    fwrite($fp, $data);
    fflush($fp);
    fclose($fp);

    return [
        'path' => "$relDir/$name",
        'bytes' => strlen($data),
        'width' => $width,
        'height' => $height,
    ];
}

// --------------------------------------------------------------- listing
/** image path -> ["product:bwd-513-lq", "hero:0", ...] across the whole document. */
function fc365_upload_used_by(array $doc): array
{
    $index = [];
    $mark = function ($path, $label) use (&$index) {
        if (is_string($path) && $path !== '') {
            if (!isset($index[$path])) {
                $index[$path] = [];
            }
            if (!in_array($label, $index[$path], true)) {
                $index[$path][] = $label;
            }
        }
    };

    foreach ((fc365_is_list($doc['products'] ?? null) ? $doc['products'] : []) as $product) {
        if (!fc365_is_dict($product)) {
            continue;
        }
        $label = 'product:' . ($product['id'] ?? '?');
        $mark($product['image'] ?? null, $label);
        foreach ((fc365_is_list($product['gallery'] ?? null) ? $product['gallery'] : []) as $item) {
            $mark($item, $label);
        }
    }
    foreach ((fc365_is_list($doc['categories'] ?? null) ? $doc['categories'] : []) as $cat) {
        if (fc365_is_dict($cat)) {
            $mark($cat['image'] ?? null, 'category:' . ($cat['slug'] ?? '?'));
        }
    }
    foreach ((fc365_is_list($doc['series'] ?? null) ? $doc['series'] : []) as $i => $entry) {
        if (fc365_is_dict($entry)) {
            $mark($entry['image'] ?? null, 'series:' . ($entry['slug'] ?? $i));
        }
    }
    foreach ((fc365_is_list($doc['hero'] ?? null) ? $doc['hero'] : []) as $i => $slide) {
        if (fc365_is_dict($slide)) {
            $mark($slide['image'] ?? null, "hero:$i");
        }
    }
    foreach ((fc365_is_list($doc['clients'] ?? null) ? $doc['clients'] : []) as $client) {
        if (fc365_is_dict($client)) {
            $mark($client['image'] ?? null, 'client:' . ($client['name'] ?? '?'));
        }
    }
    foreach ((fc365_is_list($doc['brands'] ?? null) ? $doc['brands'] : []) as $brand) {
        if (fc365_is_dict($brand)) {
            $mark($brand['logo'] ?? null, 'brand:' . ($brand['slug'] ?? '?'));
        }
    }
    foreach ((fc365_is_list($doc['menu'] ?? null) ? $doc['menu'] : []) as $node) {
        if (fc365_is_dict($node) && fc365_is_dict($node['promo'] ?? null)) {
            $mark($node['promo']['image'] ?? null, 'menu:' . fc365_slug((string) ($node['label'] ?? '')));
        }
    }
    return $index;
}

function fc365_upload_list_images($folder, array $doc): array
{
    $relDir = is_string($folder) ? (FC365_IMAGE_FOLDERS[$folder] ?? null) : null;
    if ($relDir === null) {
        $shown = is_string($folder) ? $folder : json_encode($folder);
        throw new UploadError(400, 'bad_folder', "Unknown image folder '$shown'.");
    }
    $directory = FC365_PUBLIC_ROOT . '/' . $relDir;
    $index = fc365_upload_used_by($doc);
    $out = [];
    if (!is_dir($directory)) {
        return $out;
    }
    $names = scandir($directory) ?: [];
    sort($names, SORT_STRING);
    foreach ($names as $name) {
        $full = $directory . '/' . $name;
        if (!is_file($full)) {
            continue;
        }
        $dot = strrpos($name, '.');
        $ext = $dot === false ? '' : strtolower(substr($name, $dot + 1));
        if (!in_array($ext, FC365_IMAGE_EXTENSIONS, true)) {
            continue;
        }
        $rel = "$relDir/$name";
        $stat = @stat($full);
        if ($stat === false) {
            continue;
        }
        $out[] = [
            'path' => $rel,
            'bytes' => $stat['size'],
            'mtime' => fc365_iso(new DateTimeImmutable('@' . $stat['mtime'])),
            'usedBy' => $index[$rel] ?? [],
        ];
    }
    return $out;
}

/** Map a validated assets/img/<folder>/<name> onto disk. Throws UploadError. */
function fc365_upload_resolve_image_path(string $relPath): string
{
    if ($relPath === '') {
        throw new UploadError(400, 'bad_path', 'A path is required.');
    }
    $parts = explode('/', $relPath);
    if (count($parts) !== 4 || $parts[0] !== 'assets' || $parts[1] !== 'img') {
        throw new UploadError(400, 'bad_path', 'The path must look like assets/img/<folder>/<name>.');
    }
    [, , $folder, $name] = $parts;
    $relDir = FC365_IMAGE_FOLDERS[$folder] ?? null;
    if ($relDir === null) {
        throw new UploadError(400, 'bad_path', "Unknown image folder '$folder'.");
    }
    if ($name === '' || $name === '.' || $name === '..' || str_contains($name, '/') || str_contains($name, '\\')) {
        throw new UploadError(400, 'bad_path', 'That is not a file name.');
    }
    $dot = strrpos($name, '.');
    $ext = $dot === false ? '' : strtolower(substr($name, $dot + 1));
    if (!in_array($ext, FC365_IMAGE_EXTENSIONS, true)) {
        throw new UploadError(400, 'bad_path', 'That is not an image file.');
    }
    $directory = realpath(FC365_PUBLIC_ROOT . '/' . $relDir);
    if ($directory === false) {
        throw new UploadError(400, 'bad_path', 'Refusing to touch a file outside the image folder.');
    }
    // $name has already been confirmed free of "/", "\\", "." and ".." above,
    // so it cannot escape $directory once concatenated. Deliberately NOT
    // realpath()'d here before existence is known: PHP's realpath() returns
    // false for a path that does not exist, which would misreport a
    // legitimately-named-but-already-deleted file as 400 bad_path instead
    // of the contract's 404 not_found (see the containment-check note in
    // fc365_store_upload() for the same PHP-vs-Python realpath() gap). If
    // the target DOES exist, resolve it now as a genuine belt-and-braces
    // confirmation that it really did land inside $directory (e.g. guards
    // against a symlink placed inside the image folder by some other means).
    $full = $directory . DIRECTORY_SEPARATOR . $name;
    if (file_exists($full)) {
        $resolved = realpath($full);
        if ($resolved === false || !str_starts_with($resolved, $directory . DIRECTORY_SEPARATOR)) {
            throw new UploadError(400, 'bad_path', 'Refusing to touch a file outside the image folder.');
        }
        return $resolved;
    }
    return $full;
}

function fc365_upload_delete_image(string $relPath, array $doc): void
{
    $full = fc365_upload_resolve_image_path($relPath);
    if (!is_file($full)) {
        throw new UploadError(404, 'not_found', 'No such image.');
    }
    $users = fc365_upload_used_by($doc)[$relPath] ?? [];
    if ($users) {
        throw new UploadError(
            409,
            'in_use',
            'That image is still used by ' . count($users) . ' place(s): ' . implode(', ', $users) . '.',
            ['usedBy' => $users]
        );
    }
    unlink($full);
}
