<?php

/**
 * The ONE web-reachable PHP file in this entire application.
 *
 * Every other piece of logic (config/store/render/auth/validate/uploads/
 * routing) lives under private-src/lib/ + private-src/bin/, deployed to
 * private/furnist365/ -- a sibling of public_html/, never a descendant of
 * it. That directory split IS the fix for the Python version's Critical
 * finding (a URL reaching a secrets file): it is structurally impossible
 * for any URL to reach those files, not policed by a blocklist. See
 * docs/php-admin-architecture.md sections 2 and 8.
 *
 * Reached via the /api/admin/* rewrite in ../.htaccess (this file's parent
 * directory's parent, i.e. the site/public_html root).
 */

// Must be the very first thing that runs, before any include: no raw PHP
// warning/notice from anywhere in the include chain can leak into the
// response body ahead of lib/api.php's own catch-all error handler even
// getting a chance to run. Errors are still logged (log_errors stays on);
// they are just never displayed.
ini_set('display_errors', '0');
ini_set('log_errors', '1');
error_reporting(E_ALL);

// dirname(__DIR__) from this file's own directory (public_html/admin) is
// public_html; dirname(__DIR__, 2) is one level above that -- the domain
// home, where private/ lives as a sibling. See architecture section 2.6.
define('FC365_PUBLIC_ROOT', dirname(__DIR__));
$fc365PrivateRoot = dirname(__DIR__, 2) . '/private/furnist365';

// Local-dev-only override: point FC365_PRIVATE_ROOT at a gitignored
// .dev-private/ sandbox instead of ever editing this file or hardcoding a
// second path in config.php. Set the FC365_PRIVATE_ROOT environment
// variable before starting `php -S 127.0.0.1:5500 -t site` for local
// development; see docs/php-admin.md. Unset in production, where this is a
// no-op and the line above (the real prod path) is what takes effect.
$fc365DevOverride = getenv('FC365_PRIVATE_ROOT');
if ($fc365DevOverride !== false && trim($fc365DevOverride) !== '') {
    $fc365PrivateRoot = rtrim(trim($fc365DevOverride), '/\\');
}
define('FC365_PRIVATE_ROOT', $fc365PrivateRoot);
unset($fc365PrivateRoot, $fc365DevOverride);

require FC365_PRIVATE_ROOT . '/lib/api.php';

// ---------------------------------------------------------------- request
/** Mirrors urllib.parse.parse_qs(keep_blank_values=True)[...][0]: first value wins. */
function fc365_parse_query(string $queryString): array
{
    $query = [];
    if ($queryString === '') {
        return $query;
    }
    foreach (explode('&', $queryString) as $pair) {
        if ($pair === '') {
            continue;
        }
        $eq = strpos($pair, '=');
        if ($eq === false) {
            $key = urldecode($pair);
            $value = '';
        } else {
            $key = urldecode(substr($pair, 0, $eq));
            $value = urldecode(substr($pair, $eq + 1));
        }
        if (!array_key_exists($key, $query)) {
            $query[$key] = $value;
        }
    }
    return $query;
}

function fc365_emit(Response $response): void
{
    http_response_code($response->status);
    // Every response carries this -- docs/api-admin.md section 0.
    header('Cache-Control: no-store, max-age=0');
    foreach ($response->headers as [$name, $value]) {
        header("$name: $value", false);
    }
    $body = $response->bodyText();
    if ($body !== '') {
        header('Content-Type: application/json; charset=utf-8');
    }
    if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'HEAD') {
        echo $body;
    }
}

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH);
if (!is_string($path) || $path === '') {
    $path = '/';
}
$query = fc365_parse_query($_SERVER['QUERY_STRING'] ?? '');
$peerIp = (string) ($_SERVER['REMOTE_ADDR'] ?? '');

// Content-Length is checked BEFORE the body is read, on every mutating
// method -- architecture section 7.2 / docs/api-admin.md section 0. A
// missing header is treated as an empty body (matching the ported Python's
// `int(headers.get("Content-Length") or 0)`); a PRESENT but non-numeric
// header is the only case that is itself a 400.
$body = '';
if (in_array($method, ['POST', 'PUT', 'PATCH'], true)) {
    $cap = ($path === FC365_API_PREFIX . '/upload') ? FC365_MAX_UPLOAD_BODY : FC365_MAX_JSON_BODY;
    $lengthHeader = $_SERVER['CONTENT_LENGTH'] ?? null;
    if ($lengthHeader === null || trim((string) $lengthHeader) === '') {
        $length = 0;
    } elseif (preg_match('~^\d+$~', trim((string) $lengthHeader))) {
        $length = (int) trim((string) $lengthHeader);
    } else {
        $length = -1;
    }
    if ($length < 0) {
        fc365_emit(new Response(400, ['error' => 'bad_request', 'message' => 'Content-Length is not a number.']));
        exit;
    }
    if ($length > $cap) {
        fc365_emit(new Response(413, [
            'error' => 'too_large',
            'message' => "That request is $length bytes; the limit is $cap.",
            'limit' => $cap,
        ]));
        exit;
    }
    if ($length > 0) {
        $raw = file_get_contents('php://input');
        $body = $raw === false ? '' : $raw;
    }
}

$request = new Request($method, $path, $query, $body, $peerIp);
fc365_emit(fc365_handle($request));
