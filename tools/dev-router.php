<?php

/**
 * Local-dev-only router for PHP's built-in server (`php -S`).
 *
 * Unlike Apache, `php -S` never reads .htaccess, so site/.htaccess's
 *   RewriteRule ^api/admin/(.*)$ admin/api.php [QSA,L]
 * has no effect under the built-in server: every /api/admin/* request would
 * otherwise 404 even though the application code is completely correct.
 * This file reproduces just that one rewrite rule for local testing.
 *
 * Deliberately kept OUTSIDE site/, on purpose: site/ is delete-mirrored
 * verbatim into public_html/ on every deploy (see .github/workflows/deploy.yml
 * and README.md), and this whole design's one hard rule is that exactly ONE
 * PHP file is ever web-reachable (site/admin/api.php). A router script
 * living inside site/ would become a second, completely unprotected
 * web-reachable PHP file the moment it shipped -- site/admin/.htaccess's
 * "deny every .php except api.php" rule does not even cover the site/ root,
 * only site/admin/. Keeping this file in tools/ (never synced anywhere)
 * makes that mistake structurally impossible instead of relying on nobody
 * moving it later.
 *
 * Usage, from the repo root (see docs/php-admin.md section 3):
 *
 *   FC365_PRIVATE_ROOT="/absolute/path/to/.dev-private" \
 *     php -S 127.0.0.1:5500 -t site tools/dev-router.php
 *
 * (FC365_PRIVATE_ROOT is optional -- site/admin/api.php already defaults to
 * <repo>/.dev-private when run from a checkout; set it explicitly only to
 * point at a different sandbox.)
 */

$docRoot = $_SERVER['DOCUMENT_ROOT'] ?? (dirname(__DIR__) . '/site');
$path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH);
if (!is_string($path) || $path === '') {
    $path = '/';
}

// Mirrors site/.htaccess's RewriteRule ^api/admin/(.*)$ admin/api.php [QSA,L]
// exactly: everything under /api/admin/ (and /api/admin itself) goes to the
// one front controller, with the query string left untouched (PHP's
// built-in server already parses $_GET/$_SERVER['QUERY_STRING'] from the
// original request, same as an internal Apache rewrite would).
if (preg_match('#^/api/admin(/.*)?$#', $path)) {
    require $docRoot . '/admin/api.php';
    return true;
}

// Any other path that is a real, existing file: let the built-in server
// serve it natively as a plain static file, exactly like Apache would for
// anything the rewrite rule doesn't match.
$candidate = $docRoot . $path;
if ($path !== '/' && is_file($candidate)) {
    return false;
}

// Everything else (directory requests, unknown paths): fall through to the
// built-in server's own default handling (its normal index/404 behaviour).
return false;
