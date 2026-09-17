<?php

/**
 * Paths, caps and whitelists. No I/O, no state — require this from anywhere.
 *
 * Deliberately NOT declare(strict_types=1): every value flowing through this
 * codebase originates from json_decode() of an admin-supplied request body,
 * where PHP's own array-key coercion (a JSON object key that looks like an
 * integer becomes an int array key) and general "could be anything" input
 * shapes are the normal case, not the exception. Strict types would turn an
 * ordinary type mismatch a validator is SUPPOSED to catch and turn into a
 * clean 400 into an uncaught TypeError (500) instead. Every function in
 * these files does its own explicit is_string()/is_array()/is_int() checks,
 * which is the real type safety mechanism here — see validate.php.
 *
 * Port of server/config.py. The one structural difference from the Python
 * version: there is no long-lived process, so FC365_PUBLIC_ROOT and
 * FC365_PRIVATE_ROOT are not derived here — they must already be `define()`d
 * by the caller (site/admin/api.php in production, or a local dev bootstrap)
 * before this file is required. See docs/php-admin-architecture.md section 2.6.
 */

if (!defined('FC365_PUBLIC_ROOT') || !defined('FC365_PRIVATE_ROOT')) {
    throw new RuntimeException(
        'FC365_PUBLIC_ROOT and FC365_PRIVATE_ROOT must be defined before config.php is loaded.'
    );
}

// ---------------------------------------------------------------- paths
// Everything under private/ (or the local .dev-private/ sandbox).
define('FC365_SITE_JSON', FC365_PRIVATE_ROOT . '/site.json');
define('FC365_ADMIN_JSON', FC365_PRIVATE_ROOT . '/admin.json');
// Dedicated lock files, never the data files themselves — see store.php.
define('FC365_SITE_JSON_LOCK', FC365_PRIVATE_ROOT . '/site.json.lock');
define('FC365_RATE_FILE', FC365_PRIVATE_ROOT . '/ratelimit.json');
define('FC365_RATE_LOCK_FILE', FC365_PRIVATE_ROOT . '/ratelimit.json.lock');
define('FC365_BACKUP_DIR', FC365_PRIVATE_ROOT . '/backups');
define('FC365_SESSIONS_DIR', FC365_PRIVATE_ROOT . '/sessions');

// Everything under public_html/ (or the local site/ docroot).
define('FC365_DATA_JS', FC365_PUBLIC_ROOT . '/assets/js/data.js');
define('FC365_IMG_ROOT', FC365_PUBLIC_ROOT . '/assets/img');

// ------------------------------------------------- image folder whitelist
// A dict lookup, never string concatenation: "brand" (the site's own logo)
// and "brands" (vendor wordmarks) are different directories and must stay so.
define('FC365_IMAGE_FOLDERS', [
    'product'  => 'assets/img/product',
    'category' => 'assets/img/category',
    'hero'     => 'assets/img/hero',
    'client'   => 'assets/img/client',
    'brands'   => 'assets/img/brands',
    'brand'    => 'assets/img/brand',
]);
// Order matters only for the meta endpoint's stable output.
define('FC365_IMAGE_FOLDER_NAMES', ['product', 'category', 'hero', 'client', 'brands', 'brand']);

// SVG is only ever accepted into the two logo folders.
define('FC365_SVG_FOLDERS', ['brands', 'brand']);

define('FC365_IMAGE_EXTENSIONS', ['jpg', 'jpeg', 'png', 'webp', 'gif', 'svg']);

// ------------------------------------------------------------ collections
// The whitelist for /api/admin/data/{collection}. Never reflected into a path.
define('FC365_COLLECTIONS', [
    'site',
    'menu',
    'hero',
    'categories',
    'series',
    'products',
    'brands',
    'clients',
    'footerLinks',
    'bedSizes',
    'demoUser',
]);
// Collections that are a single object rather than an array.
define('FC365_SINGLETONS', ['site', 'demoUser']);

// The ten keys JSON.stringify(window.FC_DATA) must produce at bootstrap.
define('FC365_BOOTSTRAP_KEYS', [
    'site',
    'menu',
    'hero',
    'categories',
    'series',
    'products',
    'brands',
    'clients',
    'footerLinks',
    'demoUser',
]);

// Shared lists: top-level array keys that products may point at by reference.
// "@bedSizes" in products[].swatches / products[].options[k] means "the
// bedSizes array"; render.php expands it back to the bare identifier BED_SIZES.
define('FC365_SHARED_LISTS', ['bedSizes' => 'BED_SIZES']);
define('FC365_SHARED_REF_PREFIX', '@');

define('FC365_SCHEMA_VERSION', 1);

// ----------------------------------------------------------------- limits
define('FC365_MAX_UPLOAD_BYTES', 6 * 1024 * 1024); // decoded image
define('FC365_MAX_UPLOAD_BODY', 8 * 1024 * 1024);  // base64 inflates by ~33%
define('FC365_MAX_JSON_BODY', 2 * 1024 * 1024);    // every other endpoint
define('FC365_MAX_IMAGE_PX', 6000);

define('FC365_BACKUP_KEEP', 50);

define('FC365_MAX_GALLERY', 12);
define('FC365_MAX_OPTIONS', 6);
define('FC365_MAX_OPTION_VALUES', 20);
define('FC365_MAX_SWATCHES', 8);
define('FC365_MAX_MENU_TOP', 12);
define('FC365_MAX_MENU_GROUPS', 8);
define('FC365_MAX_MENU_LINKS', 20);
define('FC365_MAX_BED_SIZES', 20);

// --------------------------------------------------------------- sessions
define('FC365_SESSION_COOKIE', 'fc_admin');
define('FC365_SESSION_TTL', 8 * 3600);
define('FC365_MIN_PASSWORD_LENGTH', 10);
// password_hash() cost factor. Pinned explicitly (see auth.php) rather than
// left at whatever PASSWORD_BCRYPT's own internal default happens to be.
define('FC365_BCRYPT_COST', 12);

// These two MUST agree — see the long comment in the original config.py this
// ports. LOGIN_WINDOW is the sliding window the rate limiter counts failures
// in; LOGIN_RETRY_AFTER is the number the 429 body / Retry-After header /
// front-end countdown all promise. Keeping them equal makes "wait N seconds
// and you are unblocked" exactly true, not "usually" true.
define('FC365_LOGIN_MAX_FAILURES', 5);
define('FC365_LOGIN_WINDOW', 5 * 60);
define('FC365_LOGIN_RETRY_AFTER', 5 * 60);

define('FC365_CSRF_HEADER', 'X-FC-Admin');

// ------------------------------------------------------------- icon keys
// The key set of ICONS in assets/js/components.js. An icon outside this list
// is a warning, not an error: components.js falls back to ICONS.box. Keep in
// step with components.js by hand.
define('FC365_ICON_KEYS', [
    'search', 'user', 'heart', 'cart', 'compare', 'caret', 'burger', 'close',
    'phone', 'mail', 'pin', 'pdf', 'store', 'eye', 'arrowUp', 'arrowLeft',
    'arrowRight', 'whatsapp', 'facebook', 'instagram', 'youtube', 'linkedin', 'box',
]);

/** The `limits` block of GET /api/admin/meta. */
function fc365_limits(): array
{
    return [
        'uploadBytes'    => FC365_MAX_UPLOAD_BYTES,
        'maxGallery'     => FC365_MAX_GALLERY,
        'maxOptions'     => FC365_MAX_OPTIONS,
        'maxSwatches'    => FC365_MAX_SWATCHES,
        'maxImagePx'     => FC365_MAX_IMAGE_PX,
        'maxMenuTop'     => FC365_MAX_MENU_TOP,
        'maxMenuGroups'  => FC365_MAX_MENU_GROUPS,
        'maxMenuLinks'   => FC365_MAX_MENU_LINKS,
    ];
}

/**
 * mkdir a private-side directory with 0700 if it does not exist yet, and
 * (re)harden it to 0700 even if it already existed.
 *
 * The re-harden-on-every-call part matters for FC365_PRIVATE_ROOT itself:
 * per the documented SFTP migration (docs/php-admin.md), that top-level
 * directory is typically created by hand, over SFTP, before admin.json is
 * ever uploaded to it -- and an SFTP client's default mkdir mode is
 * commonly something looser than 0700 (e.g. 0755), which would let other
 * tenants on the same shared host `ls` filenames (never contents --
 * admin.json/site.json are written with their own explicit chmod
 * regardless) inside it. Since this directory already exists by the time
 * any of this code runs, the `if (!is_dir())` branch above would never fire
 * for it and so never fix a loose mode left over from that manual step --
 * chmod is cheap and idempotent, so just always confirm it on every call.
 */
function fc365_ensure_private_dir(string $path): void
{
    if (!is_dir($path)) {
        if (!@mkdir($path, 0700, true) && !is_dir($path)) {
            throw new RuntimeException("Could not create directory: $path");
        }
    }
    @chmod($path, 0700);
}

/**
 * True if $value is a JSON array (a PHP list), tolerating the fact that an
 * empty JSON array `[]` and an empty JSON object `{}` are both decoded by
 * json_decode(..., true) into the same PHP `[]` and are therefore
 * indistinguishable. Rejects a genuine JSON object with string/non-sequential
 * keys, matching Python's `isinstance(value, list)`.
 */
function fc365_is_list($value): bool
{
    return is_array($value) && ($value === [] || array_is_list($value));
}

/**
 * True if $value is a JSON object (a PHP dict-shaped array), with the same
 * empty-container tolerance as fc365_is_list(). Rejects a genuine JSON array
 * of two or more elements, matching Python's `isinstance(value, dict)`.
 */
function fc365_is_dict($value): bool
{
    return is_array($value) && ($value === [] || !array_is_list($value));
}
