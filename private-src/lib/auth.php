<?php

// No declare(strict_types=1) -- see the note in config.php.

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/store.php'; // for fc365_iso()/fc365_utc_now()

/**
 * Password hashing, native PHP sessions, cookie handling, login rate limit.
 * Port of server/auth.py, restructured for a per-request (PHP-FPM) process
 * model instead of a long-lived daemon with in-memory state -- see
 * docs/php-admin-architecture.md section 5.
 *
 * There is no default password and no password in the repo. Until
 *   php private-src/bin/admin-cli.php --set-admin-password
 * has been run (locally) and its private/furnist365/admin.json uploaded by
 * hand, fc365_auth_has_password() is false and every /api/admin/* endpoint
 * except bootstrap answers 503. The admin panel is inert until a human
 * deliberately turns it on.
 *
 * The customer demo login (site.demoUser) shares nothing with this. It is
 * plain data compared client-side by auth.js; the admin password is never
 * sent to the browser in any form, and the only thing that unlocks
 * /api/admin/* is the fc_admin session cookie, which is HttpOnly.
 */

class RateLimited extends Exception
{
}

// -------------------------------------------------------------- sessions
/**
 * Idempotent: safe to call at the top of every request. session_name()/
 * session_set_cookie_params()/session_save_path() MUST all run before
 * session_start(), and PHP refuses to change them once a session is active,
 * hence the guard.
 */
function fc365_auth_start_session(): void
{
    if (session_status() === PHP_SESSION_ACTIVE) {
        return;
    }
    fc365_ensure_private_dir(FC365_SESSIONS_DIR);
    session_name(FC365_SESSION_COOKIE);
    // secure is derived from THIS request, never a startup flag -- there is
    // no such thing as "the server's --https flag" in a per-request
    // PHP-FPM world. See architecture section 5.1.
    $secure = !empty($_SERVER['HTTPS']) && strtolower((string) $_SERVER['HTTPS']) !== 'off';
    session_set_cookie_params([
        'lifetime' => 0, // session cookie; the 8h TTL is enforced in $_SESSION, not the cookie
        'path' => '/',
        'httponly' => true,
        'samesite' => 'Strict',
        'secure' => $secure,
    ]);
    session_save_path(FC365_SESSIONS_DIR);
    session_start();
}

/**
 * On successful login: mark the session authenticated, set the sliding 8h
 * expiry, and regenerate the session id (fixation defence). Returns the
 * unix timestamp the session expires at.
 */
function fc365_auth_create_session(): int
{
    fc365_auth_start_session();
    $expiresAt = time() + FC365_SESSION_TTL;
    $_SESSION['admin'] = true;
    $_SESSION['expires_at'] = $expiresAt;
    session_regenerate_id(true);
    return $expiresAt;
}

/**
 * Returns the (slid-forward) expiry timestamp if the current request carries
 * a valid, unexpired admin session, or null otherwise. Mirrors
 * server/auth.py's check_session(): sliding the TTL forward on every
 * authenticated request, per the contract ("8 hours, slid forward on every
 * authenticated request").
 */
function fc365_auth_check_session(): ?int
{
    fc365_auth_start_session();
    $expiresAt = $_SESSION['expires_at'] ?? null;
    if (empty($_SESSION['admin']) || $expiresAt === null || time() > (int) $expiresAt) {
        $_SESSION = [];
        if (session_status() === PHP_SESSION_ACTIVE) {
            session_destroy();
        }
        return null;
    }
    $expiresAt = time() + FC365_SESSION_TTL;
    $_SESSION['expires_at'] = $expiresAt;
    return $expiresAt;
}

/** Emits the exact `Set-Cookie: fc_admin=; ...; Max-Age=0` the contract documents. */
function fc365_auth_clear_cookie_header(): void
{
    $secure = !empty($_SERVER['HTTPS']) && strtolower((string) $_SERVER['HTTPS']) !== 'off';
    $value = FC365_SESSION_COOKIE . '=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0';
    if ($secure) {
        $value .= '; Secure';
    }
    header('Set-Cookie: ' . $value, false);
}

/** POST /api/admin/logout: a session is not required, so this must not throw. */
function fc365_auth_destroy_session(): void
{
    fc365_auth_start_session();
    $_SESSION = [];
    if (session_status() === PHP_SESSION_ACTIVE) {
        session_destroy();
    }
    fc365_auth_clear_cookie_header();
}

// -------------------------------------------------------------- password
function fc365_auth_has_password(): bool
{
    return is_file(FC365_ADMIN_JSON);
}

/** Reads private/furnist365/admin.json. Returns null on any failure. */
function fc365_auth_read_admin_record(): ?array
{
    $text = @file_get_contents(FC365_ADMIN_JSON);
    if ($text === false) {
        return null;
    }
    $record = json_decode($text, true);
    if (!is_array($record) || !isset($record['hash']) || !is_string($record['hash'])) {
        return null;
    }
    return $record;
}

/**
 * password_verify() is already timing-safe internally for the hash compare
 * itself; no manual hash_equals() is needed here. Always runs the full
 * bcrypt verification when a record exists, so a wrong password costs the
 * same as a right one.
 */
function fc365_auth_verify_password(string $password): bool
{
    if ($password === '') {
        return false;
    }
    $record = fc365_auth_read_admin_record();
    if ($record === null) {
        return false;
    }
    return password_verify($password, $record['hash']);
}

/**
 * Writes private/furnist365/admin.json with mode 0600. Used only by
 * private-src/bin/admin-cli.php --set-admin-password (never reachable from
 * any HTTP endpoint -- the frozen contract has no change-password route).
 * password_hash() with PASSWORD_BCRYPT pinned explicitly, cost 12 -- see
 * docs/php-admin-architecture.md section 5.2 for why not PASSWORD_DEFAULT.
 */
function fc365_auth_write_password(string $password): string
{
    if (mb_strlen($password, 'UTF-8') < FC365_MIN_PASSWORD_LENGTH) {
        throw new InvalidArgumentException(
            'the admin password must be at least ' . FC365_MIN_PASSWORD_LENGTH . ' characters'
        );
    }
    fc365_ensure_private_dir(dirname(FC365_ADMIN_JSON));
    $hash = password_hash($password, PASSWORD_BCRYPT, ['cost' => FC365_BCRYPT_COST]);
    if ($hash === false) {
        throw new RuntimeException('password_hash() failed');
    }
    $record = ['hash' => $hash, 'createdAt' => fc365_iso(fc365_utc_now())];
    $text = json_encode($record, JSON_PRETTY_PRINT) . "\n";

    $tmp = FC365_ADMIN_JSON . '.tmp';
    $fp = fopen($tmp, 'wb');
    if ($fp === false) {
        throw new RuntimeException("could not open $tmp for writing");
    }
    fwrite($fp, $text);
    fflush($fp);
    fclose($fp);
    // Set the restrictive mode before the rename makes the final name visible.
    @chmod($tmp, 0600);
    if (!rename($tmp, FC365_ADMIN_JSON)) {
        @unlink($tmp);
        throw new RuntimeException('could not write admin.json');
    }
    @chmod(FC365_ADMIN_JSON, 0600);
    return FC365_ADMIN_JSON;
}

// --------------------------------------------------------------- CSRF/Origin
/** SameSite=Strict is layer one; this is layer two. See docs/api-admin.md section 0. */
function fc365_auth_csrf_ok(): bool
{
    return ($_SERVER['HTTP_X_FC_ADMIN'] ?? null) === '1';
}

function fc365_auth_origin_ok(): bool
{
    $origin = $_SERVER['HTTP_ORIGIN'] ?? null;
    if (!$origin) {
        return true; // a same-origin GET often sends none
    }
    $host = strtolower(trim((string) ($_SERVER['HTTP_HOST'] ?? '')));
    $parts = explode('://', $origin, 2);
    $netloc = strtolower(rtrim(trim((string) end($parts)), '/'));
    return $host !== '' && $netloc === $host;
}

// ------------------------------------------------------------ rate limit
/**
 * Runs check -> password_verify -> record as ONE critical section under a
 * single GLOBAL flock. Deliberate, doc-justified deviation from the
 * Python per-IP lock -- see docs/php-admin-architecture.md section 5.5 and
 * docs/php-admin.md: a single lock means at most one bcrypt verification
 * runs at a time regardless of source IP, a strictly stronger mitigation
 * against a parallel-attempt CPU-burn race than a per-IP lock, at
 * negligible cost for a 1-2-admin tool, without an unbounded-file-growth
 * surface (one lock file per attacking IP).
 *
 * Returns true if $password is correct (clearing this peer's failure
 * count); false if it is wrong (recording a failure for this peer). Throws
 * RateLimited if this peer is currently blocked -- checked and thrown from
 * INSIDE the lock, before password_verify() ever runs, so a blocked peer
 * never costs a bcrypt verification either.
 */
function fc365_auth_attempt_login(string $peerIp, string $password): bool
{
    fc365_ensure_private_dir(FC365_PRIVATE_ROOT);
    $fp = fopen(FC365_RATE_LOCK_FILE, 'c+');
    if ($fp === false) {
        throw new RuntimeException('could not open the rate-limit lock file');
    }
    try {
        if (!flock($fp, LOCK_EX)) {
            throw new RuntimeException('could not acquire the rate-limit lock');
        }
        try {
            $state = [];
            $raw = @file_get_contents(FC365_RATE_FILE);
            if ($raw !== false) {
                $decoded = json_decode($raw, true);
                if (is_array($decoded)) {
                    $state = $decoded;
                }
            }
            $now = time();
            $existing = is_array($state[$peerIp] ?? null) ? $state[$peerIp] : [];
            $hits = array_values(array_filter($existing, fn($t) => ($now - (int) $t) < FC365_LOGIN_WINDOW));

            if (count($hits) >= FC365_LOGIN_MAX_FAILURES) {
                throw new RateLimited();
            }

            // Runs the full bcrypt verify -- see fc365_auth_verify_password()
            // -- and, thanks to the flock held for this whole function, only
            // one such run across ALL peers is ever in flight at once.
            $ok = fc365_auth_verify_password($password);

            if (!$ok) {
                $hits[] = $now;
                $state[$peerIp] = $hits;
            } else {
                unset($state[$peerIp]);
            }

            $text = json_encode($state);
            $tmp = FC365_RATE_FILE . '.tmp';
            file_put_contents($tmp, $text === false ? '{}' : $text);
            rename($tmp, FC365_RATE_FILE);

            return $ok;
        } finally {
            flock($fp, LOCK_UN);
        }
    } finally {
        fclose($fp);
    }
}

// ------------------------------------------------------------ bootstrap
function fc365_auth_peer_is_loopback(?string $ip): bool
{
    if ($ip === null || $ip === '') {
        return false;
    }
    if (in_array($ip, ['127.0.0.1', '::1', '::ffff:127.0.0.1'], true)) {
        return true;
    }
    return str_starts_with($ip, '127.');
}
