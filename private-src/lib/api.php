<?php

// No declare(strict_types=1) -- see the note in config.php.

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/store.php';
require_once __DIR__ . '/render.php';
require_once __DIR__ . '/auth.php';
require_once __DIR__ . '/validate.php';
require_once __DIR__ . '/uploads.php';

/**
 * Routing and the JSON envelope for /api/admin/*. Port of server/api.py.
 *
 * site/admin/api.php (the one web-reachable file) hands this module a
 * Request and gets back a Response. Nothing in here touches
 * $_SERVER/php://input directly except through that Request object, so the
 * dispatch/validation logic is the same regardless of how the glue file
 * assembled the request.
 *
 * The contract this implements is docs/api-admin.md. If the two disagree,
 * the doc is the bug report.
 */

const FC365_API_PREFIX = '/api/admin';

function fc365_iso_epoch(int $epoch): string
{
    return fc365_iso(new DateTimeImmutable('@' . $epoch));
}

final class Request
{
    public string $method;
    public string $path; // no query string
    /** @var array<string,string> first value wins */
    public array $query;
    public string $body; // raw bytes, already size-capped by the glue file
    public string $peerIp;

    public function __construct(string $method, string $path, array $query, string $body, string $peerIp)
    {
        $this->method = $method;
        $this->path = $path;
        $this->query = $query;
        $this->body = $body;
        $this->peerIp = $peerIp;
    }

    public function json(): array
    {
        if ($this->body === '') {
            return [];
        }
        $parsed = json_decode($this->body, true);
        if (json_last_error() !== JSON_ERROR_NONE) {
            throw new ApiError(400, 'bad_json', 'The request body is not valid JSON.');
        }
        if (!fc365_is_dict($parsed)) {
            throw new ApiError(400, 'bad_json', 'The request body must be a JSON object.');
        }
        return $parsed;
    }
}

final class Response
{
    public int $status;
    /** @var array|null */
    public $payload;
    /** @var list<array{0:string,1:string}> */
    public array $headers;

    public function __construct(int $status, $payload = null, array $headers = [])
    {
        $this->status = $status;
        $this->payload = $payload;
        $this->headers = $headers;
    }

    public function bodyText(): string
    {
        if ($this->payload === null) {
            return '';
        }
        $json = json_encode($this->payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        return $json === false ? '' : $json . "\n";
    }
}

final class ApiError extends Exception
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

    public function toResponse(): Response
    {
        $payload = array_merge(['error' => $this->error, 'message' => $this->getMessage()], $this->extra);
        $headers = [];
        if ($this->status === 429) {
            $headers[] = ['Retry-After', (string) FC365_LOGIN_RETRY_AFTER];
        }
        return new Response($this->status, $payload, $headers);
    }
}

// --------------------------------------------------------------- helpers
function fc365_require_csrf(): void
{
    // SameSite=Strict is layer one; this is layer two. docs/api-admin.md section 0.
    if (!fc365_auth_csrf_ok()) {
        throw new ApiError(403, 'csrf_required', 'This endpoint requires the ' . FC365_CSRF_HEADER . ': 1 header.');
    }
}

function fc365_require_origin(): void
{
    if (!fc365_auth_origin_ok()) {
        throw new ApiError(403, 'bad_origin', 'Cross-origin requests are not accepted.');
    }
}

/** Returns the session's (slid-forward) expiry epoch, or throws 401. */
function fc365_require_session(): int
{
    $expiresAt = fc365_auth_check_session();
    if ($expiresAt === null) {
        throw new ApiError(401, 'unauthorized', 'Sign in to the admin panel first.');
    }
    return $expiresAt;
}

/**
 * A fresh copy of the current document, or a clean 503. Deliberately does
 * NOT forward the underlying StoreUnreadable message to the client (a
 * stricter reading of "never leak raw exception text" than the ported
 * Python, which passed str(exc) straight through) -- see the final report.
 */
function fc365_doc(): array
{
    try {
        return fc365_store_get_doc();
    } catch (StoreUnreadable $e) {
        error_log('[fc365] store_unreadable: ' . $e->getMessage());
        throw new ApiError(503, 'store_unreadable', 'The content file cannot be read right now. Check the server log.');
    }
}

function fc365_rev_from(array $payload, string $name = 'rev'): int
{
    if (!array_key_exists($name, $payload)) {
        throw new ApiError(400, 'bad_request', "Body must carry the '$name' you last read, for conflict detection.");
    }
    $value = $payload[$name];
    if (is_int($value)) {
        return $value;
    }
    if (is_float($value) && floor($value) === $value) {
        return (int) $value;
    }
    if (is_string($value) && preg_match('~^-?\d+$~', trim($value))) {
        return (int) trim($value);
    }
    throw new ApiError(400, 'bad_request', "'$name' must be a whole number.");
}

/**
 * Rewrite document-relative validation pointers ("categories/3/slug") into
 * pointers into the REQUEST BODY the admin form actually posted
 * ("items/3/slug", or "item/slug" for a singleton or a single-record route).
 */
function fc365_remapper(string $collection, bool $singleton = false, ?int $index = null): callable
{
    $prefix = "$collection/";
    return function (string $pointer) use ($collection, $prefix, $singleton, $index): string {
        if ($pointer === $collection) {
            return $singleton ? 'item' : 'items';
        }
        if (!str_starts_with($pointer, $prefix)) {
            return $pointer;
        }
        $rest = substr($pointer, strlen($prefix));
        if ($singleton) {
            return "item/$rest";
        }
        if ($index !== null) {
            $parts = explode('/', $rest, 2);
            $head = $parts[0];
            $tail = $parts[1] ?? '';
            if ($head !== '' && ctype_digit($head) && (int) $head === $index) {
                return $tail !== '' ? "item/$tail" : 'item';
            }
        }
        return "items/$rest";
    };
}

/**
 * Calls fc365_store_mutate() and translates its exceptions into ApiError
 * shapes. $holder is a plain array the caller's $applyFn stashes two things
 * into as it runs (both under the lock, against the fresh doc):
 *   $holder['remap']    the pointer-remap function for THIS write, if any
 *   $holder['warnings'] the reference-guard warnings for THIS write, if any
 * Any ApiError $applyFn throws directly (duplicate_id, not_found, the
 * products in_use 400, etc.) is not caught here and simply propagates.
 *
 * $successExtra may be a plain array (known BEFORE the mutation runs, e.g.
 * the product id from the request body) or a callable(array $holder): array
 * invoked AFTER the mutation completes, for fields that depend on what
 * $applyFn computed (e.g. DELETE product's orphanedImages -- see the note
 * on fc365_h_delete_product() for why this must be evaluated after, not
 * before, the mutation).
 */
function fc365_run_mutation(int $rev, callable $applyFn, array &$holder, $successExtra = null, int $status = 200): Response
{
    try {
        [$newRev, $saveWarnings] = fc365_store_mutate($rev, $applyFn);
    } catch (StaleRev $e) {
        throw new ApiError(
            409,
            'stale_rev',
            'Another tab saved since you loaded this. Reload before saving.',
            ['rev' => $e->current]
        );
    } catch (ValidationError $e) {
        $remap = $holder['remap'] ?? null;
        $fields = $e->fields;
        $message = $e->getMessage();
        if ($remap !== null) {
            $remapped = [];
            foreach ($fields as $pointer => $text) {
                $remapped[$remap($pointer)] = $text;
            }
            $fields = $remapped;
            $message = fc365_validation_first_message($fields);
        }
        throw new ApiError(400, 'validation_failed', $message, ['fields' => $fields]);
    } catch (RenderError $e) {
        throw new ApiError(
            500,
            'render_failed',
            'The generated data.js failed its sanity check, so nothing was saved: ' . $e->getMessage()
        );
    } catch (StoreError $e) {
        error_log('[fc365] store error: ' . $e->getMessage());
        throw new ApiError(500, 'internal_error', 'The save could not be completed. Check the server log.');
    } catch (StoreUnreadable $e) {
        error_log('[fc365] store_unreadable: ' . $e->getMessage());
        throw new ApiError(503, 'store_unreadable', 'The content file cannot be read right now. Check the server log.');
    }

    $payload = [
        'ok' => true,
        'rev' => $newRev,
        'warnings' => fc365_merge($saveWarnings, $holder['warnings'] ?? []),
    ];
    if (is_callable($successExtra)) {
        $payload = array_merge($payload, $successExtra($holder));
    } elseif (is_array($successExtra)) {
        $payload = array_merge($payload, $successExtra);
    }
    return new Response($status, $payload);
}

/** Reference breakages that this write introduces, ignoring pre-existing ones. */
function fc365_added_refs(array $before, array $after): array
{
    $out = [];
    foreach ($after as $kind => $rows) {
        $old = $before[$kind] ?? [];
        $new = [];
        foreach ($rows as $pid => $value) {
            if (($old[$pid] ?? null) !== $value) {
                $new[$pid] = $value;
            }
        }
        if ($new) {
            $out[$kind] = $new;
        }
    }
    return $out;
}

define('FC365_REF_LABEL', ['category' => 'category', 'series' => 'series', 'bedSizes' => 'bed-size list']);

/**
 * Turn a dangling reference into a 400, a 409 or a warning, per the
 * contract. $beforeRefs is fc365_check_references() ALREADY COMPUTED
 * against the pre-mutation doc (the caller does this inside $applyFn,
 * before mutating, so both snapshots come from the one fresh, lock-held
 * read).
 */
function fc365_guard_references(array $beforeRefs, array $doc, string $collection, bool $force, ?callable $remap = null): array
{
    $after = fc365_check_references($doc);
    $added = fc365_added_refs($beforeRefs, $after);

    if ($collection === 'products') {
        // The products themselves are being written: name the offending index.
        $fields = [];
        $ids = [];
        foreach ((fc365_is_list($doc['products'] ?? null) ? $doc['products'] : []) as $p) {
            $ids[] = fc365_is_dict($p) ? ($p['id'] ?? null) : null;
        }
        foreach (['category', 'series'] as $kind) {
            foreach (($added[$kind] ?? []) as $pid => $value) {
                $idx = array_search($pid, $ids, true);
                $pointer = $idx !== false ? "products/$idx/$kind" : "products/$kind";
                if ($remap !== null) {
                    $pointer = $remap($pointer);
                }
                $fields[$pointer] = "'$value' is not a known $kind";
            }
        }
        if ($fields) {
            throw new ApiError(
                400,
                'validation_failed',
                'This product points at something that does not exist.',
                ['fields' => $fields]
            );
        }
        return fc365_reference_warnings($after);
    }

    if (!$force) {
        foreach (['category', 'series', 'bedSizes'] as $kind) {
            $rows = $added[$kind] ?? [];
            if (!$rows) {
                continue;
            }
            $values = array_values(array_unique(array_values($rows)));
            sort($values, SORT_STRING);
            $referencedBy = array_map('strval', array_keys($rows));
            sort($referencedBy, SORT_STRING);
            throw new ApiError(
                409,
                'in_use',
                count($rows) . ' product(s) still use that ' . FC365_REF_LABEL[$kind] . '. Add ?force=1 to save anyway.',
                ['kind' => $kind, 'values' => $values, 'referencedBy' => $referencedBy]
            );
        }
    }
    return fc365_reference_warnings($after);
}

// ------------------------------------------------------------------ auth
function fc365_h_login(Request $request): Response
{
    fc365_require_csrf();
    fc365_require_origin();
    if (!fc365_auth_has_password()) {
        throw new ApiError(503, 'no_admin_password', 'run: php private-src/bin/admin-cli.php --set-admin-password');
    }
    $payload = $request->json();
    $password = $payload['password'] ?? null;
    if (!is_string($password) || $password === '') {
        throw new ApiError(400, 'bad_request', 'password is required.');
    }

    try {
        $ok = fc365_auth_attempt_login($request->peerIp, $password);
    } catch (RateLimited $e) {
        throw new ApiError(
            429,
            'rate_limited',
            'Too many failed attempts. Try again in ' . intdiv(FC365_LOGIN_RETRY_AFTER, 60) . ' minutes.'
        );
    }
    if (!$ok) {
        throw new ApiError(401, 'bad_password', 'That password is not correct.');
    }

    $expiresAt = fc365_auth_create_session();
    return new Response(200, ['ok' => true, 'expiresAt' => fc365_iso_epoch($expiresAt)]);
}

function fc365_h_logout(Request $request): Response
{
    fc365_require_csrf();
    fc365_require_origin();
    fc365_auth_destroy_session();
    return new Response(204, null);
}

function fc365_h_session_status(Request $request): Response
{
    if (!fc365_auth_has_password()) {
        throw new ApiError(503, 'no_admin_password', 'run: php private-src/bin/admin-cli.php --set-admin-password');
    }
    $expiresAt = fc365_auth_check_session();
    if ($expiresAt === null) {
        return new Response(200, ['authenticated' => false]);
    }
    return new Response(200, ['authenticated' => true, 'expiresAt' => fc365_iso_epoch($expiresAt)]);
}

function fc365_h_meta(Request $request): Response
{
    $doc = fc365_doc();
    $sharedLists = [];
    foreach (array_keys(FC365_SHARED_LISTS) as $key) {
        $sharedLists[$key] = $doc[$key] ?? [];
    }
    return new Response(200, [
        'rev' => (int) ($doc['_meta']['rev'] ?? 0),
        'iconKeys' => array_values(FC365_ICON_KEYS),
        'imageFolders' => array_values(FC365_IMAGE_FOLDER_NAMES),
        'collections' => array_values(FC365_COLLECTIONS),
        'seriesKeys' => fc365_series_keys($doc),
        'categorySlugs' => fc365_category_slugs($doc),
        'menuSlugs' => fc365_menu_slugs($doc),
        'brandSlugs' => fc365_brand_slugs($doc),
        'sharedLists' => $sharedLists,
        'limits' => fc365_limits(),
    ]);
}

// ------------------------------------------------------------ data reads
function fc365_h_get_all(Request $request): Response
{
    return new Response(200, fc365_doc());
}

function fc365_h_get_collection(Request $request, string $collection): Response
{
    if (!in_array($collection, FC365_COLLECTIONS, true)) {
        throw new ApiError(404, 'not_found', "Unknown collection '$collection'.");
    }
    $doc = fc365_doc();
    $body = ['rev' => (int) ($doc['_meta']['rev'] ?? 0)];
    if (in_array($collection, FC365_SINGLETONS, true)) {
        $body['item'] = $doc[$collection] ?? [];
    } else {
        $body['items'] = $doc[$collection] ?? [];
    }
    return new Response(200, $body);
}

// ----------------------------------------------------------- data writes
function fc365_h_put_collection(Request $request, string $collection): Response
{
    if (!in_array($collection, FC365_COLLECTIONS, true)) {
        throw new ApiError(404, 'not_found', "Unknown collection '$collection'.");
    }
    $payload = $request->json();
    $given = fc365_rev_from($payload);

    $isSingleton = in_array($collection, FC365_SINGLETONS, true);
    if ($isSingleton) {
        if (!array_key_exists('item', $payload) || !fc365_is_dict($payload['item'])) {
            throw new ApiError(400, 'bad_request', "Body must contain 'item' (an object) for $collection.");
        }
        $value = $payload['item'];
    } else {
        if (!array_key_exists('items', $payload) || !fc365_is_list($payload['items'])) {
            throw new ApiError(400, 'bad_request', "Body must contain 'items' (an array) for $collection.");
        }
        $value = $payload['items'];
    }

    $force = ($request->query['force'] ?? null) === '1';
    $remap = fc365_remapper($collection, $isSingleton);
    $holder = ['remap' => $remap];

    $applyFn = function (array $doc) use ($collection, $value, $force, $remap, &$holder): array {
        $beforeRefs = fc365_check_references($doc);
        $doc[$collection] = $value;
        $holder['warnings'] = fc365_guard_references($beforeRefs, $doc, $collection, $force, $remap);
        return $doc;
    };

    return fc365_run_mutation($given, $applyFn, $holder);
}

function fc365_merge(...$lists): array
{
    $out = [];
    foreach ($lists as $group) {
        foreach (($group ?? []) as $item) {
            if (!in_array($item, $out, true)) {
                $out[] = $item;
            }
        }
    }
    return $out;
}

function fc365_product_index(array $doc, string $pid): int
{
    foreach ((fc365_is_list($doc['products'] ?? null) ? $doc['products'] : []) as $i => $product) {
        if (fc365_is_dict($product) && ($product['id'] ?? null) === $pid) {
            return $i;
        }
    }
    return -1;
}

function fc365_h_post_product(Request $request): Response
{
    $payload = $request->json();
    $given = fc365_rev_from($payload);
    $item = $payload['item'] ?? null;
    if (!fc365_is_dict($item)) {
        throw new ApiError(400, 'bad_request', "Body must contain 'item' (an object).");
    }
    $index = $payload['index'] ?? null;
    if ($index !== null) {
        if (is_int($index)) {
            // ok as-is
        } elseif (is_string($index) && preg_match('~^-?\d+$~', trim($index))) {
            $index = (int) trim($index);
        } else {
            throw new ApiError(400, 'bad_request', "'index' must be a whole number.");
        }
    }

    $holder = [];
    $applyFn = function (array $doc) use ($item, $index, &$holder): array {
        $pid = $item['id'] ?? null;
        if (is_string($pid) && fc365_product_index($doc, $pid) >= 0) {
            // Checked HERE, against the doc this call just loaded under the
            // lock, not a copy read earlier -- two concurrent creates of
            // the same new id can no longer both slip past this check.
            throw new ApiError(400, 'duplicate_id', "A product with id '$pid' already exists.");
        }
        $products = fc365_is_list($doc['products'] ?? null) ? $doc['products'] : [];
        $beforeRefs = fc365_check_references($doc);
        if ($index === null) {
            $products[] = $item;
            $insIndex = count($products) - 1;
        } else {
            $insIndex = max(0, min($index, count($products)));
            array_splice($products, $insIndex, 0, [$item]);
        }
        $doc['products'] = $products;
        $remap = fc365_remapper('products', false, $insIndex);
        $holder['remap'] = $remap;
        $holder['warnings'] = fc365_guard_references($beforeRefs, $doc, 'products', false, $remap);
        return $doc;
    };

    return fc365_run_mutation($given, $applyFn, $holder, ['id' => $item['id'] ?? null], 201);
}

function fc365_h_put_product(Request $request, string $pid): Response
{
    $payload = $request->json();
    $given = fc365_rev_from($payload);
    $item = $payload['item'] ?? null;
    if (!fc365_is_dict($item)) {
        throw new ApiError(400, 'bad_request', "Body must contain 'item' (an object).");
    }
    if (($item['id'] ?? null) !== $pid) {
        // id is the product.html?id= URL key AND the localStorage cart/
        // wishlist key. Pure request-shape check, no doc state involved, so
        // it can run before the lock.
        throw new ApiError(400, 'id_immutable', 'A product id cannot be changed after it is created.');
    }

    $holder = [];
    $applyFn = function (array $doc) use ($item, $pid, &$holder): array {
        $index = fc365_product_index($doc, $pid);
        if ($index < 0) {
            throw new ApiError(404, 'not_found', "No product with id '$pid'.");
        }
        $beforeRefs = fc365_check_references($doc);
        $doc['products'][$index] = $item;
        $remap = fc365_remapper('products', false, $index);
        $holder['remap'] = $remap;
        $holder['warnings'] = fc365_guard_references($beforeRefs, $doc, 'products', false, $remap);
        return $doc;
    };

    return fc365_run_mutation($given, $applyFn, $holder, ['id' => $pid]);
}

function fc365_h_delete_product(Request $request, string $pid): Response
{
    $givenRaw = $request->query['rev'] ?? null;
    if ($givenRaw === null) {
        throw new ApiError(400, 'bad_request', 'Pass ?rev= the revision you last read.');
    }
    if (!preg_match('~^-?\d+$~', trim($givenRaw))) {
        throw new ApiError(400, 'bad_request', "'rev' must be a whole number.");
    }
    $given = (int) trim($givenRaw);

    $holder = [];
    $applyFn = function (array $doc) use ($pid, &$holder): array {
        $index = fc365_product_index($doc, $pid);
        if ($index < 0) {
            throw new ApiError(404, 'not_found', "No product with id '$pid'.");
        }
        $beforeRefs = fc365_check_references($doc);
        $removed = $doc['products'][$index];
        array_splice($doc['products'], $index, 1);

        $mine = [];
        if (is_string($removed['image'] ?? null)) {
            $mine[$removed['image']] = true;
        }
        foreach ((fc365_is_list($removed['gallery'] ?? null) ? $removed['gallery'] : []) as $path) {
            if (is_string($path)) {
                $mine[$path] = true;
            }
        }
        $stillUsed = fc365_upload_used_by($doc);
        $orphaned = [];
        foreach (array_keys($mine) as $path) {
            if (!array_key_exists($path, $stillUsed)) {
                $orphaned[] = $path;
            }
        }
        sort($orphaned, SORT_STRING);
        $holder['orphaned'] = $orphaned;

        $remap = fc365_remapper('products');
        $holder['remap'] = $remap;
        $holder['warnings'] = fc365_guard_references($beforeRefs, $doc, 'products', true, $remap);
        return $doc;
    };

    // orphanedImages is read from $holder via a callback invoked AFTER the
    // mutation completes, deliberately -- the Python reference implementation
    // computes `success_extra={"orphanedImages": holder.get("orphaned", [])}`
    // as a call ARGUMENT, which Python evaluates before store.mutate() (and
    // therefore apply_fn) ever runs, so holder is always still empty at that
    // point and the Python server as written always answers `[]` regardless
    // of what was actually orphaned -- contradicting the non-empty example
    // docs/api-admin.md itself documents for this response. Fixed here by
    // reading $holder only after fc365_store_mutate() returns.
    return fc365_run_mutation($given, $applyFn, $holder, fn($h) => ['orphanedImages' => $h['orphaned'] ?? []]);
}

// --------------------------------------------------------------- images
function fc365_h_upload(Request $request): Response
{
    $payload = $request->json();
    $result = fc365_store_upload($payload['folder'] ?? null, $payload['filename'] ?? null, $payload['data'] ?? null);
    $result['ok'] = true;
    return new Response(201, $result);
}

function fc365_h_list_images(Request $request): Response
{
    $folder = $request->query['folder'] ?? null;
    return new Response(200, ['folder' => $folder, 'items' => fc365_upload_list_images($folder, fc365_doc())]);
}

function fc365_h_delete_image(Request $request): Response
{
    $path = $request->query['path'] ?? null;
    fc365_upload_delete_image((string) $path, fc365_doc());
    return new Response(200, ['ok' => true, 'path' => $path]);
}

// ---------------------------------------------------------- maintenance
function fc365_h_publish(Request $request): Response
{
    try {
        [$written, $current] = fc365_store_publish();
    } catch (RenderError $e) {
        throw new ApiError(500, 'render_failed', $e->getMessage());
    } catch (StoreError $e) {
        error_log('[fc365] store error: ' . $e->getMessage());
        throw new ApiError(500, 'internal_error', 'The publish could not be completed. Check the server log.');
    } catch (StoreUnreadable $e) {
        error_log('[fc365] store_unreadable: ' . $e->getMessage());
        throw new ApiError(503, 'store_unreadable', 'The content file cannot be read right now. Check the server log.');
    }
    return new Response(200, ['ok' => true, 'bytes' => $written, 'rev' => $current]);
}

function fc365_h_backups(Request $request): Response
{
    return new Response(200, ['items' => fc365_list_backups()]);
}

function fc365_h_restore(Request $request): Response
{
    $payload = $request->json();
    $filename = $payload['file'] ?? null;
    if (!is_string($filename) || $filename === '') {
        throw new ApiError(400, 'bad_request', "'file' is required.");
    }
    try {
        [$newRev, $warnings] = fc365_store_restore($filename);
    } catch (BackupNotFound $e) {
        throw new ApiError(404, 'not_found', 'No such backup.');
    } catch (ValidationError $e) {
        throw new ApiError(
            400,
            'validation_failed',
            'That backup no longer validates: ' . $e->getMessage(),
            ['fields' => $e->fields]
        );
    } catch (RenderError $e) {
        throw new ApiError(500, 'render_failed', $e->getMessage());
    } catch (StoreError $e) {
        error_log('[fc365] store error: ' . $e->getMessage());
        throw new ApiError(500, 'internal_error', 'The restore could not be completed. Check the server log.');
    }
    return new Response(200, ['ok' => true, 'rev' => $newRev, 'warnings' => $warnings]);
}

// ------------------------------------------------------------ bootstrap
/**
 * One shot. No session, loopback only, only while site.json is absent.
 * See docs/php-admin-architecture.md section 5.7: this can only ever
 * succeed against the local PHP dev server, by construction, since real
 * production traffic can never arrive with a loopback REMOTE_ADDR.
 */
function fc365_h_bootstrap(Request $request): Response
{
    fc365_require_csrf();
    if (!fc365_auth_peer_is_loopback($request->peerIp)) {
        throw new ApiError(403, 'not_loopback', 'Bootstrap is only accepted from the local machine.');
    }
    if (fc365_store_exists()) {
        throw new ApiError(409, 'already_bootstrapped', 'site.json already exists.');
    }

    $payload = $request->json();
    $data = $payload['data'] ?? null;
    if (!fc365_is_dict($data)) {
        throw new ApiError(400, 'bad_request', 'Body must be {"data": JSON.parse(JSON.stringify(window.FC_DATA))}.');
    }

    $expected = FC365_BOOTSTRAP_KEYS;
    $got = array_keys($data);
    $missing = array_values(array_diff($expected, $got));
    $unexpected = array_values(array_diff($got, $expected));
    if ($missing || $unexpected) {
        sort($missing, SORT_STRING);
        sort($unexpected, SORT_STRING);
        throw new ApiError(400, 'bad_request', sprintf(
            'Unexpected keys: %s. Missing keys: %s.',
            $unexpected ? implode(', ', $unexpected) : 'none',
            $missing ? implode(', ', $missing) : 'none'
        ));
    }

    $doc = ['_meta' => ['schema' => FC365_SCHEMA_VERSION, 'rev' => 0]];
    foreach (FC365_BOOTSTRAP_KEYS as $key) {
        $doc[$key] = $data[$key];
    }
    $normalised = fc365_normalise_seed($doc);

    try {
        [$newRev, $warnings] = fc365_store_save_locked($doc);
    } catch (ValidationError $e) {
        $fields = [];
        foreach ($e->fields as $k => $v) {
            $fields["data/$k"] = $v;
        }
        throw new ApiError(400, 'validation_failed', 'The seed did not validate: ' . $e->getMessage(), ['fields' => $fields]);
    } catch (RenderError $e) {
        throw new ApiError(500, 'render_failed', $e->getMessage());
    } catch (StoreError $e) {
        error_log('[fc365] store error: ' . $e->getMessage());
        throw new ApiError(500, 'internal_error', 'The seed could not be saved. Check the server log.');
    }
    return new Response(200, ['ok' => true, 'rev' => $newRev, 'warnings' => $warnings, 'normalised' => $normalised]);
}

/**
 * Rebuild what JSON.stringify flattened. Deterministic and lossless.
 *
 * 1. bedSizes: data.js declares it once and two products point at that same
 *    array. JSON.stringify has already copied it, so factor it back out --
 *    every array deep-equal to the first product's `swatches` becomes the
 *    shared reference "@bedSizes".
 * 2. series[].slug: additive, derived from ?series= in the entry's own
 *    href. href itself is left byte-identical.
 */
function fc365_normalise_seed(array &$doc): array
{
    $products = fc365_is_list($doc['products'] ?? null) ? $doc['products'] : [];

    $shared = [];
    foreach ($products as $product) {
        if (fc365_is_dict($product) && fc365_is_list($product['swatches'] ?? null)) {
            $shared = array_values($product['swatches']);
            break;
        }
    }
    $doc['bedSizes'] = $shared;

    $ref = FC365_SHARED_REF_PREFIX . 'bedSizes';
    $swapped = 0;
    if ($shared) {
        foreach ($products as &$product) {
            if (!fc365_is_dict($product)) {
                continue;
            }
            if (($product['swatches'] ?? null) === $shared) {
                $product['swatches'] = $ref;
                $swapped++;
            }
            if (fc365_is_dict($product['options'] ?? null)) {
                foreach (array_keys($product['options']) as $key) {
                    if ($product['options'][$key] === $shared) {
                        $product['options'][$key] = $ref;
                        $swapped++;
                    }
                }
            }
        }
        unset($product);
        $doc['products'] = $products;
    }

    $keys = [];
    $series = fc365_is_list($doc['series'] ?? null) ? $doc['series'] : [];
    foreach ($series as &$entry) {
        if (!fc365_is_dict($entry)) {
            continue;
        }
        $href = (string) ($entry['href'] ?? '');
        $key = null;
        if (preg_match(FC365_RE_SERIES_KEY, $href, $m)) {
            $key = $m[1];
        } else {
            $key = fc365_slug((string) ($entry['eyebrow'] ?? ''));
            if ($key === '') {
                $key = fc365_slug((string) ($entry['title'] ?? ''));
            }
        }
        $entry['slug'] = $key;
        $keys[] = $key;
    }
    unset($entry);
    $doc['series'] = $series;

    return ['bedSizes' => $shared, 'sharedListRefs' => $swapped, 'seriesSlugs' => $keys];
}

// ---------------------------------------------------------------- router
/** The single entry point. Always returns a Response, never throws. */
function fc365_handle(Request $request): Response
{
    try {
        return fc365_dispatch($request);
    } catch (ApiError $e) {
        return $e->toResponse();
    } catch (UploadError $e) {
        $payload = array_merge(['error' => $e->error, 'message' => $e->getMessage()], $e->extra);
        if ($e->error === 'too_large') {
            $payload['limit'] = FC365_MAX_UPLOAD_BYTES;
        }
        return new Response($e->status, $payload);
    } catch (ValidationError $e) {
        return new Response(400, ['error' => 'validation_failed', 'message' => $e->getMessage(), 'fields' => $e->fields]);
    } catch (StoreUnreadable $e) {
        error_log('[fc365] store_unreadable: ' . $e->getMessage());
        return new Response(503, [
            'error' => 'store_unreadable',
            'message' => 'The content file cannot be read right now. Check the server log.',
        ]);
    } catch (\Throwable $e) {
        // Every KNOWN failure mode is caught by name above with a message
        // written to be shown to a client. This is the one path left for a
        // bug: some exception/error type nobody anticipated. Log the full
        // detail server-side only; the client never sees more than a fixed,
        // generic message -- never raw exception text or a filesystem path.
        error_log('[fc365] internal_error: ' . $e->getMessage() . "\n" . $e->getTraceAsString());
        return new Response(500, [
            'error' => 'internal_error',
            'message' => 'An unexpected error occurred. Check the server log.',
        ]);
    }
}

// Endpoints that work before anyone has set an admin password.
define('FC365_NO_PASSWORD_OK', [['POST', '/bootstrap']]);
// Endpoints that need no session.
define('FC365_NO_SESSION', [
    ['GET', '/session'], ['POST', '/login'], ['POST', '/logout'], ['POST', '/bootstrap'],
]);
// The one endpoint that needs no X-FC-Admin header.
define('FC365_NO_CSRF', [['GET', '/session']]);

function fc365_key_in(array $list, string $method, string $tail): bool
{
    foreach ($list as [$m, $t]) {
        if ($m === $method && $t === $tail) {
            return true;
        }
    }
    return false;
}

function fc365_dispatch(Request $request): Response
{
    // Session bootstrap runs for every request -- see auth.php. Idempotent.
    fc365_auth_start_session();

    if (!str_starts_with($request->path, FC365_API_PREFIX)) {
        throw new ApiError(404, 'not_found', 'No such endpoint.');
    }
    $tail = substr($request->path, strlen(FC365_API_PREFIX));
    if ($tail === '') {
        $tail = '/';
    }
    if (!str_starts_with($tail, '/')) {
        throw new ApiError(404, 'not_found', 'No such endpoint.');
    }

    if ($request->method === 'OPTIONS') {
        // No CORS headers are ever emitted, so a preflight must fail.
        throw new ApiError(403, 'bad_origin', 'Cross-origin requests are not accepted.');
    }

    if (!fc365_key_in(FC365_NO_PASSWORD_OK, $request->method, $tail) && !fc365_auth_has_password()) {
        throw new ApiError(503, 'no_admin_password', 'run: php private-src/bin/admin-cli.php --set-admin-password');
    }

    if (!fc365_key_in(FC365_NO_CSRF, $request->method, $tail)) {
        fc365_require_csrf();
        fc365_require_origin();
    }

    if ($tail === '/session' && $request->method === 'GET') {
        return fc365_h_session_status($request);
    }
    if ($tail === '/login' && $request->method === 'POST') {
        return fc365_h_login($request);
    }
    if ($tail === '/logout' && $request->method === 'POST') {
        return fc365_h_logout($request);
    }
    if ($tail === '/bootstrap' && $request->method === 'POST') {
        return fc365_h_bootstrap($request);
    }

    if (!fc365_key_in(FC365_NO_SESSION, $request->method, $tail)) {
        fc365_require_session();
    }

    if ($tail === '/meta' && $request->method === 'GET') {
        return fc365_h_meta($request);
    }
    if ($tail === '/data') {
        if ($request->method === 'GET') {
            return fc365_h_get_all($request);
        }
        throw new ApiError(405, 'method_not_allowed', 'Use GET on /data.');
    }
    if ($tail === '/publish' && $request->method === 'POST') {
        return fc365_h_publish($request);
    }
    if ($tail === '/backups' && $request->method === 'GET') {
        return fc365_h_backups($request);
    }
    if ($tail === '/restore' && $request->method === 'POST') {
        return fc365_h_restore($request);
    }
    if ($tail === '/upload' && $request->method === 'POST') {
        return fc365_h_upload($request);
    }
    if ($tail === '/images') {
        if ($request->method === 'GET') {
            return fc365_h_list_images($request);
        }
        if ($request->method === 'DELETE') {
            return fc365_h_delete_image($request);
        }
        throw new ApiError(405, 'method_not_allowed', 'Use GET or DELETE on /images.');
    }

    if (str_starts_with($tail, '/data/')) {
        $parts = array_values(array_filter(explode('/', substr($tail, strlen('/data/'))), fn($p) => $p !== ''));
        if (count($parts) === 1) {
            $collection = $parts[0];
            if ($request->method === 'GET') {
                return fc365_h_get_collection($request, $collection);
            }
            if ($request->method === 'PUT') {
                return fc365_h_put_collection($request, $collection);
            }
            if ($request->method === 'POST' && $collection === 'products') {
                return fc365_h_post_product($request);
            }
            throw new ApiError(405, 'method_not_allowed', "{$request->method} is not allowed on that collection.");
        }
        if (count($parts) === 2 && $parts[0] === 'products') {
            $pid = $parts[1];
            if ($request->method === 'PUT') {
                return fc365_h_put_product($request, $pid);
            }
            if ($request->method === 'DELETE') {
                return fc365_h_delete_product($request, $pid);
            }
            throw new ApiError(405, 'method_not_allowed', "{$request->method} is not allowed on a single product.");
        }
    }

    throw new ApiError(404, 'not_found', 'No such endpoint.');
}
