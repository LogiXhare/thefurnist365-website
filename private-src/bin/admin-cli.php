#!/usr/bin/env php
<?php
/**
 * Furnist365 admin CLI. Port of serve.py's --set-admin-password/--rebuild/
 * --check subcommands, adapted for a tool that never runs on the production
 * box (there is no shell there) -- see docs/php-admin-architecture.md
 * section 5.3 and docs/php-admin.md.
 *
 * Usage:
 *   php private-src/bin/admin-cli.php --set-admin-password
 *   php private-src/bin/admin-cli.php --rebuild
 *   php private-src/bin/admin-cli.php --check
 *
 * Paths: FC365_PUBLIC_ROOT is always <repo>/site (this tool only ever runs
 * against a local checkout). FC365_PRIVATE_ROOT defaults to <repo>/.dev-private
 * (gitignored local sandbox) and can be pointed elsewhere with the
 * FC365_PRIVATE_ROOT environment variable -- the same mechanism
 * site/admin/api.php uses, so switching between local dev and "seed a file
 * to upload to production" never means editing this file or config.php.
 */

if (PHP_SAPI !== 'cli') {
    fwrite(STDERR, "This tool is meant to be run from the command line.\n");
    exit(1);
}

$fc365RepoRoot = dirname(__DIR__, 2);
define('FC365_PUBLIC_ROOT', $fc365RepoRoot . '/site');
$fc365PrivateRoot = getenv('FC365_PRIVATE_ROOT');
if ($fc365PrivateRoot === false || trim($fc365PrivateRoot) === '') {
    $fc365PrivateRoot = $fc365RepoRoot . '/.dev-private';
}
define('FC365_PRIVATE_ROOT', rtrim(trim($fc365PrivateRoot), '/\\'));
unset($fc365RepoRoot, $fc365PrivateRoot);

// dirname(__DIR__) from private-src/bin is private-src -- lib/ is its
// sibling, both in the repo checkout and (if this script is ever copied
// there) under private/furnist365/{lib,bin} in production.
require dirname(__DIR__) . '/lib/auth.php'; // pulls in config/render/validate/store transitively

function fc365_cli_prompt(string $label): string
{
    fwrite(STDOUT, $label);
    $line = fgets(STDIN);
    if ($line === false) {
        return '';
    }
    return rtrim($line, "\r\n");
}

function fc365_cmd_set_password(): int
{
    fwrite(STDOUT, "Set the Furnist365 admin password.\n");
    fwrite(STDOUT, "It is stored as a bcrypt hash in private/furnist365/admin.json.\n");
    fwrite(STDOUT, 'Minimum ' . FC365_MIN_PASSWORD_LENGTH . " characters.\n");
    fwrite(STDOUT, "Note: PHP has no portable getpass() equivalent, so input below is NOT masked --\n");
    fwrite(STDOUT, "this runs on your own machine, the same exposure as typing any other local secret.\n\n");

    $first = fc365_cli_prompt('New admin password: ');
    $second = fc365_cli_prompt('Repeat it: ');
    if ($first === '' || $second === '') {
        fwrite(STDOUT, "aborted, nothing written\n");
        return 1;
    }
    if ($first !== $second) {
        fwrite(STDOUT, "those do not match; nothing written\n");
        return 1;
    }
    try {
        $path = fc365_auth_write_password($first);
    } catch (InvalidArgumentException $e) {
        fwrite(STDOUT, $e->getMessage() . "; nothing written\n");
        return 1;
    }
    fwrite(STDOUT, "\nwritten: $path\n");
    fwrite(STDOUT, "Upload this ONE file once over SFTP, directly into\n");
    fwrite(STDOUT, "private/furnist365/admin.json on the server. Rotating the password later\n");
    fwrite(STDOUT, "repeats these same steps.\n");
    return 0;
}

function fc365_cmd_rebuild(): int
{
    try {
        [$written, $current] = fc365_store_publish();
    } catch (StoreUnreadable $e) {
        fwrite(STDOUT, 'cannot rebuild: ' . $e->getMessage() . "\n");
        return 1;
    } catch (RenderError | StoreError $e) {
        fwrite(STDOUT, 'rebuild failed: ' . $e->getMessage() . "\n");
        return 1;
    }
    fwrite(STDOUT, "wrote assets/js/data.js ($written bytes) from site.json rev $current\n");
    return 0;
}

function fc365_cmd_check(): int
{
    try {
        $doc = fc365_store_get_doc();
    } catch (StoreUnreadable $e) {
        fwrite(STDOUT, 'FAIL ' . $e->getMessage() . "\n");
        return 1;
    }
    try {
        $warnings = fc365_validate_document($doc);
    } catch (ValidationError $e) {
        fwrite(STDOUT, 'FAIL site.json does not validate (' . count($e->fields) . " problem(s)):\n");
        $keys = array_keys($e->fields);
        sort($keys, SORT_STRING);
        foreach ($keys as $pointer) {
            fwrite(STDOUT, sprintf("  %-46s %s\n", $pointer, $e->fields[$pointer]));
        }
        return 1;
    }
    fwrite(STDOUT, 'OK   site.json rev ' . ($doc['_meta']['rev'] ?? 0) . " validates\n");
    foreach (FC365_COLLECTIONS as $key) {
        $value = $doc[$key] ?? null;
        $desc = fc365_is_list($value) ? (string) count($value) : '1 record';
        fwrite(STDOUT, sprintf("     %-12s %s\n", $key, $desc));
    }
    foreach ($warnings as $warning) {
        fwrite(STDOUT, "     warning: $warning\n");
    }
    return 0;
}

function fc365_cmd_help(): int
{
    fwrite(STDOUT, <<<'TXT'
Furnist365 admin CLI (local dev tool / one-time production seeding helper)

Usage:
    php private-src/bin/admin-cli.php --set-admin-password
        Prompts twice via STDIN, writes private/furnist365/admin.json locally.
        Upload that one file once over SFTP into the same path on the server.

    php private-src/bin/admin-cli.php --rebuild
        Regenerates assets/js/data.js from site.json without touching the JSON.

    php private-src/bin/admin-cli.php --check
        Validates site.json against every rule in docs/api-admin.md section 7
        and reports collection counts + any non-fatal warnings.

Paths:
    FC365_PUBLIC_ROOT  is always <repo>/site
    FC365_PRIVATE_ROOT defaults to <repo>/.dev-private (gitignored), or the
                       FC365_PRIVATE_ROOT environment variable if set.

See docs/php-admin.md for the full local-dev and deploy workflow.

TXT);
    return 0;
}

function fc365_cli_main(array $args): int
{
    $cmd = 'help';
    foreach ($args as $arg) {
        if ($arg === '--set-admin-password') {
            $cmd = 'password';
        } elseif ($arg === '--rebuild') {
            $cmd = 'rebuild';
        } elseif ($arg === '--check') {
            $cmd = 'check';
        } elseif ($arg === '-h' || $arg === '--help') {
            $cmd = 'help';
        }
    }
    switch ($cmd) {
        case 'password':
            return fc365_cmd_set_password();
        case 'rebuild':
            return fc365_cmd_rebuild();
        case 'check':
            return fc365_cmd_check();
        default:
            return fc365_cmd_help();
    }
}

exit(fc365_cli_main(array_slice($argv, 1)));
