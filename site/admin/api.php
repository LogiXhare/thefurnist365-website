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
// In a git checkout run locally, this file sits at the same relative depth
// (<repo>/site/admin/api.php), so dirname(__DIR__, 2) resolves to <repo>
// instead -- used below to auto-detect "am I running from a checkout" so
// local dev needs no manual code-copying step (see the FC365_LIB_ROOT block).
define('FC365_PUBLIC_ROOT', dirname(__DIR__));
$fc365AboveWebRoot = dirname(__DIR__, 2);

// This file is the only thing that CAN tell "production" and "a local
// checkout" apart, so it decides once, here, and every other lib/*.php file
// just uses the two constants this produces -- see config.php.
//
// private-src/lib/config.php is a marker that exists ONLY in a git
// checkout: production's deploy pipeline ships site/ to public_html/ and
// private-src/{lib,bin} to private/furnist365/{lib,bin} (two separate SFTP
// targets, see .github/workflows/deploy.yml) -- it never places a
// "private-src" directory next to public_html/ on the server. So this
// check is false in production by construction, not by convention.
$fc365PrivateSrcLib = $fc365AboveWebRoot . '/private-src/lib';
$fc365IsCheckout = is_file($fc365PrivateSrcLib . '/config.php');

// ---- Runtime DATA root: site.json, admin.json, ratelimit.json, sessions/,
// backups/, tmp/. Production has no reliable way to set a process
// environment variable per PHP-FPM pool on shared hosting, so production
// MUST work from the plain fallback below with zero configuration. A local
// checkout defaults to a gitignored .dev-private/ sandbox instead (matching
// docs/php-admin.md) -- both defaults can still be overridden explicitly
// with FC365_PRIVATE_ROOT, e.g. to point local dev at a downloaded copy of
// the real production private/furnist365/.
$fc365PrivateRoot = $fc365IsCheckout
    ? ($fc365AboveWebRoot . '/.dev-private')
    : ($fc365AboveWebRoot . '/private/furnist365');
$fc365PrivateOverride = getenv('FC365_PRIVATE_ROOT');
if ($fc365PrivateOverride !== false && trim($fc365PrivateOverride) !== '') {
    $fc365PrivateRoot = rtrim(trim($fc365PrivateOverride), '/\\');
}
define('FC365_PRIVATE_ROOT', $fc365PrivateRoot);

// ---- Application CODE root (lib/). In production, CI syncs
// private-src/{lib,bin} INTO the same directory FC365_PRIVATE_ROOT points
// at (private/furnist365/), so code and data live together there -- the
// fallback below reproduces exactly that layout. In a checkout, lib/ lives
// at private-src/lib instead and is loaded from there DIRECTLY: never
// copied into .dev-private/, so there is only ever one copy of the code on
// a developer's machine and nothing to keep in sync. Overridable with
// FC365_LIB_ROOT for the rare case of testing the production-style combined
// layout locally.
$fc365LibRoot = $fc365IsCheckout ? $fc365PrivateSrcLib : (FC365_PRIVATE_ROOT . '/lib');
$fc365LibOverride = getenv('FC365_LIB_ROOT');
if ($fc365LibOverride !== false && trim($fc365LibOverride) !== '') {
    $fc365LibRoot = rtrim(trim($fc365LibOverride), '/\\');
}
define('FC365_LIB_ROOT', $fc365LibRoot);
unset(
    $fc365AboveWebRoot,
    $fc365PrivateSrcLib,
    $fc365IsCheckout,
    $fc365PrivateRoot,
    $fc365PrivateOverride,
    $fc365LibRoot,
    $fc365LibOverride
);

require FC365_LIB_ROOT . '/api.php';

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
