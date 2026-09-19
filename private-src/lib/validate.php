<?php

// No declare(strict_types=1) in this codebase — see the note in config.php.
// This file in particular receives raw json_decode() output at every layer,
// where "is this actually the type we expect" is precisely the question
// being answered, not an assumption we get to make via a type hint.

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/render.php';

/**
 * Every rule in docs/api-admin.md section 7. Port of server/validate.py.
 *
 * Pure functions, no I/O except the "does this image exist on disk" check,
 * which is a stat() and nothing more. fc365_validate_document() NORMALISES
 * IN PLACE (via PHP references) -- it strips, NFC-folds and drops
 * null-valued optional keys -- and then raises ValidationError if anything
 * is still wrong.
 *
 * The single most important rule in this file is the ban on "<" and ">" in
 * free text. Every renderer in this codebase concatenates data straight into
 * innerHTML with no escaping. That is safe while a developer writes data.js
 * by hand; the moment an admin form can write it, "<img src=x onerror=...>"
 * in a product name is stored XSS for every visitor of the live site.
 *
 * PHP-specific note on mutation: Python dicts/lists are reference types, so
 * `owner[key] = value` inside a helper mutates the caller's structure for
 * free. PHP arrays are value types, so every helper below that needs to
 * normalise a value in place takes its container by reference (`array
 * &$owner`) and every call site threads that reference through
 * (`foreach ($x as &$item)`, passing `$doc[$key]` directly, etc.) so the
 * mutation reaches all the way back up to the top-level document array
 * fc365_validate_document() was called with.
 */

class ValidationError extends Exception
{
    /** @var array<string,string> JSON pointers (relative to the request body) to messages. */
    public array $fields;

    public function __construct(array $fields, ?string $message = null)
    {
        $this->fields = $fields;
        parent::__construct($message ?? fc365_validation_first_message($fields));
    }
}

function fc365_validation_first_message(array $fields): string
{
    if (!$fields) {
        return 'Validation failed.';
    }
    $keys = array_map('strval', array_keys($fields));
    sort($keys, SORT_STRING);
    $key = $keys[0];
    return "$key: {$fields[$key]}";
}

// ---------------------------------------------------------------- regexes
define('FC365_RE_PRODUCT_ID', '~^[a-z0-9][a-z0-9-]{1,63}$~');
define('FC365_RE_SKU', '~^[A-Za-z0-9./ -]+$~');
define('FC365_RE_SUB', '~^[a-z0-9-]{1,60}$~');
define('FC365_RE_SLUG40', '~^[a-z0-9-]{1,40}$~');
define('FC365_RE_BRAND_SLUG', '~^[a-z0-9-]+$~');
define('FC365_RE_OPTION_KEY', '~^[A-Za-z][A-Za-z0-9 ]*$~');
define('FC365_RE_YEAR', '~^\d{4}$~');
define('FC365_RE_PHONE', '~^0\d{9,10}$~');
define('FC365_RE_PHONE_INTL', '~^\+?\d{10,15}$~');
define('FC365_RE_WHATSAPP', '~^\d{10,15}$~');
define('FC365_RE_EMAIL', '~^[^@\s]{1,64}@[A-Za-z0-9.-]{1,190}\.[A-Za-z]{2,24}$~');
define('FC365_RE_SERIES_KEY', '~[?&]series=(\w+)~');

define('FC365_RE_IMAGE', '~^assets/img/(brand|brands|hero|category|product|client)/[a-z0-9._-]+\.(jpg|jpeg|png|webp|gif|svg)$~');

// href forms. Deliberately a whitelist -- javascript:, data: and vbscript:
// are not on it, and neither is anything else.
define('FC365_RE_HREF_PAGE', '~^[A-Za-z0-9][A-Za-z0-9._-]*\.html(\?[^\s<>"\'\\\\]*)?(#[A-Za-z0-9_.-]*)?$~');
define('FC365_RE_HREF_ANCHOR', '~^#[A-Za-z0-9_.-]*$~');
define('FC365_RE_HREF_TEL', '~^tel:\+?\d{6,20}$~');
define('FC365_RE_HREF_MAILTO', '~^mailto:[^@\s]{1,64}@[A-Za-z0-9.-]{1,190}\.[A-Za-z]{2,24}$~');
define('FC365_RE_HREF_ABS', '~^https?://[A-Za-z0-9.-]{1,253}(:\d{1,5})?(/[^\s<>"\'\\\\]*)?$~');
define('FC365_HREF_PATTERNS', [
    FC365_RE_HREF_PAGE, FC365_RE_HREF_ANCHOR, FC365_RE_HREF_TEL, FC365_RE_HREF_MAILTO, FC365_RE_HREF_ABS,
]);

define('FC365_BAD_SCHEMES', ['javascript:', 'data:', 'vbscript:', 'file:', 'blob:']);

// C0 controls plus DEL. Forbidden everywhere: render.php places its
// shared-list markers on U+0001 and relies on real content never containing one.
define('FC365_RE_CONTROL', '~[\x00-\x1f\x7f]~');

// ------------------------------------------------------------- primitives
/** Collects field errors and warnings while walking the document. */
final class FC365ValidationContext
{
    /** @var array<string,string> */
    public array $fields = [];
    /** @var list<string> */
    public array $warnings = [];
    private string $root;

    public function __construct(string $root = '')
    {
        $this->root = $root;
    }

    public function err(string $pointer, string $message): void
    {
        $key = $this->root . $pointer;
        if (!array_key_exists($key, $this->fields)) {
            $this->fields[$key] = $message;
        }
    }

    public function warn(string $message): void
    {
        if (!in_array($message, $this->warnings, true)) {
            $this->warnings[] = $message;
        }
    }
}

/**
 * NFC-normalise and strip. Used on every string that reaches disk.
 *
 * NFC folding needs ext-intl's Normalizer class, which is NOT in the
 * architecture doc's list of depended-upon extensions (only ext-dom/
 * ext-libxml are called out there). This is a real, newly-introduced
 * platform dependency this port adds; see docs/php-admin.md and the final
 * report for the flag. Degrades gracefully (trim-only, no NFC-fold) if the
 * class is unavailable rather than fatal-erroring the whole request.
 *
 * PHP's trim() only strips ASCII whitespace by default; Python's str.strip()
 * also strips Unicode space separators. The explicit character class below
 * closes that gap so the two behave the same on real-world Bengali/English
 * admin input.
 */
function fc365_norm(string $value): string
{
    if (class_exists('Normalizer')) {
        $normalized = \Normalizer::normalize($value, \Normalizer::FORM_C);
        if ($normalized !== false) {
            $value = $normalized;
        }
    }
    $ws = '\x{0009}-\x{000D}\x{0020}\x{0085}\x{00A0}\x{1680}\x{2000}-\x{200A}'
        . '\x{2028}\x{2029}\x{202F}\x{205F}\x{3000}\x{FEFF}';
    $trimmed = preg_replace("/^[$ws]+|[$ws]+\$/u", '', $value);
    return $trimmed ?? $value;
}

/** Validate and normalise owner[key] in place. Returns the value or null. */
function fc365_v_string(
    $ctx,
    array &$owner,
    string $key,
    string $pointer,
    bool $required = false,
    int $minlen = 0,
    ?int $maxlen = null,
    ?string $pattern = null,
    ?string $patternMsg = null,
    bool $allowEmpty = false
): ?string {
    if (!array_key_exists($key, $owner)) {
        if ($required) {
            $ctx->err($pointer, "$key is required");
        }
        return null;
    }
    $value = $owner[$key];
    if (!is_string($value)) {
        $ctx->err($pointer, "$key must be text");
        return null;
    }
    $value = fc365_norm($value);
    $owner[$key] = $value;

    if (preg_match(FC365_RE_CONTROL, $value)) {
        $ctx->err($pointer, 'control characters are not allowed');
        return null;
    }
    if (str_contains($value, '<') || str_contains($value, '>')) {
        // The load-bearing rule. See the module docstring.
        $ctx->err($pointer, '< and > are not allowed');
        return null;
    }
    if ($value === '' && !$allowEmpty) {
        if ($required || $minlen) {
            $ctx->err($pointer, "$key must not be empty");
            return null;
        }
        return $value;
    }
    $len = mb_strlen($value, 'UTF-8');
    if ($minlen && $len < $minlen) {
        $ctx->err($pointer, "$key must be at least $minlen characters");
        return null;
    }
    if ($maxlen !== null && $len > $maxlen) {
        $ctx->err($pointer, "$key must be at most $maxlen characters (got $len)");
        return null;
    }
    if ($pattern !== null && $value !== '' && !preg_match($pattern, $value)) {
        $ctx->err($pointer, $patternMsg ?? "$key is not in the expected format");
        return null;
    }
    return $value;
}

function fc365_v_bool($ctx, array &$owner, string $key, string $pointer): ?bool
{
    if (!array_key_exists($key, $owner)) {
        return null;
    }
    if (!is_bool($owner[$key])) {
        $ctx->err($pointer, "$key must be true or false");
        return null;
    }
    return $owner[$key];
}

function fc365_v_int($ctx, array &$owner, string $key, string $pointer, int $low, int $high): ?int
{
    if (!array_key_exists($key, $owner)) {
        return null;
    }
    $value = $owner[$key];
    if (is_bool($value) || !is_int($value)) {
        $ctx->err($pointer, "$key must be a whole number");
        return null;
    }
    if (!($low <= $value && $value <= $high)) {
        $ctx->err($pointer, "$key must be between $low and $high");
        return null;
    }
    return $value;
}

/** Assumes the caller already confirmed $key exists in $owner. */
function fc365_v_money($ctx, array &$owner, string $key, string $pointer)
{
    $value = $owner[$key];
    if (is_bool($value) || !(is_int($value) || is_float($value))) {
        $ctx->err($pointer, "$key must be a number");
        return null;
    }
    if (is_float($value) && (is_nan($value) || is_infinite($value))) {
        $ctx->err($pointer, "$key must be a real number");
        return null;
    }
    if (!($value > 0 && $value <= 100000000)) {
        $ctx->err($pointer, "$key must be greater than 0 and at most 100000000");
        return null;
    }
    return $value;
}

/** Default deny. A field added later cannot slip past the <> rule unvalidated. */
function fc365_v_keys($ctx, $owner, string $pointer, array $allowed): bool
{
    if (!fc365_is_dict($owner)) {
        $ctx->err($pointer, 'expected an object');
        return false;
    }
    foreach (array_keys($owner) as $key) {
        if (!in_array($key, $allowed, true)) {
            $sub = $pointer !== '' ? "$pointer/$key" : (string) $key;
            $ctx->err($sub, "unknown field '$key'");
        }
    }
    return true;
}

/** Delete null-valued keys so a form can post every input every time. */
function fc365_drop_nulls(&$owner, array $extraEmpty = []): void
{
    if (!fc365_is_dict($owner)) {
        return;
    }
    foreach (array_keys($owner) as $key) {
        if ($owner[$key] === null) {
            unset($owner[$key]);
        } elseif (in_array($key, $extraEmpty, true) && $owner[$key] === '') {
            unset($owner[$key]);
        }
    }
}

function fc365_v_href($ctx, array &$owner, string $key, string $pointer, bool $required = false): ?string
{
    $value = fc365_v_string($ctx, $owner, $key, $pointer, $required, 0, 300, null, null, !$required);
    if ($value === null) {
        return null;
    }
    if ($value === '') {
        return $value;
    }
    $low = mb_strtolower($value, 'UTF-8');
    $lowStripped = str_replace([' ', "\t"], '', $low);
    foreach (FC365_BAD_SCHEMES as $scheme) {
        if (str_starts_with($lowStripped, $scheme)) {
            $ctx->err($pointer, 'the ' . rtrim($scheme, ':') . ' scheme is not allowed in a link');
            return null;
        }
    }
    foreach (FC365_HREF_PATTERNS as $rx) {
        if (preg_match($rx, $value)) {
            return $value;
        }
    }
    $ctx->err($pointer, 'link must be a .html page, a #anchor, tel:, mailto: or an http(s):// address');
    return null;
}

function fc365_v_image($ctx, array &$owner, string $key, string $pointer, bool $required = false): ?string
{
    $value = fc365_v_string($ctx, $owner, $key, $pointer, $required, 0, 200, null, null, !$required);
    if ($value === null) {
        return null;
    }
    if ($value === '') {
        return $value;
    }
    if (!preg_match(FC365_RE_IMAGE, $value)) {
        // The regex bans quotes, parens, whitespace and backslashes on
        // purpose: menu[].promo.image is interpolated into an inline CSS
        // url(...) in components.js:megaHTML.
        $ctx->err(
            $pointer,
            'image must look like assets/img/<folder>/<name>.<ext> with folder one of brand, brands, '
            . 'hero, category, product, client and a lowercase name'
        );
        return null;
    }
    if (!is_file(FC365_PUBLIC_ROOT . '/' . $value)) {
        $ctx->err($pointer, "no such file on disk: $value");
        return null;
    }
    return $value;
}

function fc365_v_string_list(
    $ctx,
    array &$owner,
    string $key,
    string $pointer,
    int $minlen,
    int $maxlen,
    int $itemMin,
    int $itemMax
): ?array {
    $value = $owner[$key] ?? null;
    if (!fc365_is_list($value)) {
        $ctx->err($pointer, "$key must be a list");
        return null;
    }
    $count = count($value);
    if (!($minlen <= $count && $count <= $maxlen)) {
        $ctx->err($pointer, "$key must hold between $minlen and $maxlen entries (got $count)");
        return null;
    }
    $out = [];
    foreach ($value as $i => $raw) {
        $holder = ['v' => $raw];
        $got = fc365_v_string($ctx, $holder, 'v', "$pointer/$i", true, $itemMin, $itemMax);
        $value[$i] = $holder['v'];
        $out[] = $got;
    }
    $owner[$key] = $value;
    return $out;
}

// ------------------------------------------------------------ shared refs
function fc365_shared_ref_key($value): ?string
{
    if (is_string($value) && str_starts_with($value, FC365_SHARED_REF_PREFIX)) {
        return substr($value, strlen(FC365_SHARED_REF_PREFIX));
    }
    return null;
}

/** Return [values, isReference] for a field that may be a shared list ref. */
function fc365_v_resolve_list($ctx, $owner, $key, string $pointer, array $doc): array
{
    $value = is_array($owner) ? ($owner[$key] ?? null) : null;
    $ref = fc365_shared_ref_key($value);
    if ($ref !== null) {
        if (!array_key_exists($ref, FC365_SHARED_LISTS)) {
            $ctx->err($pointer, "'$value' is not a known shared list; the only one is '@bedSizes'");
            return [null, true];
        }
        $shared = $doc[$ref] ?? null;
        if (!fc365_is_list($shared)) {
            $ctx->err($pointer, "shared list '$ref' is missing from the document");
            return [null, true];
        }
        return [array_values($shared), true];
    }
    return [null, false];
}

// ------------------------------------------------------------------ site
define('FC365_OFFICE_KEYS', ['label', 'street', 'floor', 'area', 'address', 'hotline', 'email']);
define('FC365_SITE_KEYS', [
    'name', 'tagline', 'legalName', 'year', 'currency', 'phone', 'phoneIntl', 'whatsapp', 'email', 'office', 'socials',
]);
define('FC365_SOCIAL_KEYS', ['label', 'href', 'icon']);

function fc365_validate_site($ctx, &$site, string $pointer = ''): void
{
    fc365_drop_nulls($site);
    if (!fc365_v_keys($ctx, $site, $pointer, FC365_SITE_KEYS)) {
        return;
    }
    $p = fn($k) => $pointer !== '' ? "$pointer/$k" : $k;

    fc365_v_string($ctx, $site, 'name', $p('name'), true, 1, 60);
    fc365_v_string($ctx, $site, 'tagline', $p('tagline'), false, 0, 120);
    fc365_v_string($ctx, $site, 'legalName', $p('legalName'), false, 0, 60);
    fc365_v_string($ctx, $site, 'year', $p('year'), true, 0, null, FC365_RE_YEAR, 'year must be four digits');
    fc365_v_string($ctx, $site, 'currency', $p('currency'), true, 1, 3);
    fc365_v_string(
        $ctx, $site, 'phone', $p('phone'), true, 0, null,
        FC365_RE_PHONE, 'phone must be a local number like 01XXXXXXXXX'
    );
    fc365_v_string(
        $ctx, $site, 'phoneIntl', $p('phoneIntl'), true, 0, null,
        FC365_RE_PHONE_INTL, 'phoneIntl must be 10-15 digits, optionally led by +'
    );
    fc365_v_string(
        $ctx, $site, 'whatsapp', $p('whatsapp'), true, 0, null,
        FC365_RE_WHATSAPP, 'whatsapp must be 10-15 digits with no + and no spaces'
    );
    fc365_v_string(
        $ctx, $site, 'email', $p('email'), true, 0, 254,
        FC365_RE_EMAIL, 'email does not look like an address'
    );

    if (array_key_exists('office', $site)) {
        fc365_drop_nulls($site['office']);
        if (fc365_v_keys($ctx, $site['office'], $p('office'), FC365_OFFICE_KEYS)) {
            foreach (FC365_OFFICE_KEYS as $key) {
                fc365_v_string($ctx, $site['office'], $key, $p('office') . '/' . $key, false, 0, 160);
            }
            if (empty($site['office']['address'])) {
                $ctx->err($p('office') . '/address', 'office address is required');
            }
        }
    }

    if (array_key_exists('socials', $site)) {
        if (!fc365_is_list($site['socials'])) {
            $ctx->err($p('socials'), 'socials must be a list');
        } elseif (count($site['socials']) > 6) {
            $ctx->err($p('socials'), 'at most 6 social links');
        } else {
            foreach ($site['socials'] as $i => &$soc) {
                $sp = $p('socials') . '/' . $i;
                fc365_drop_nulls($soc);
                if (!fc365_v_keys($ctx, $soc, $sp, FC365_SOCIAL_KEYS)) {
                    continue;
                }
                fc365_v_string($ctx, $soc, 'label', $sp . '/label', true, 1, 24);
                fc365_v_href($ctx, $soc, 'href', $sp . '/href', true);
                $icon = fc365_v_string($ctx, $soc, 'icon', $sp . '/icon', true, 0, 24);
                if ($icon && !in_array($icon, FC365_ICON_KEYS, true)) {
                    // components.js falls back to ICONS.box, so this degrades.
                    $ctx->warn(
                        "site.socials[$i] uses icon '$icon', which is not in components.js ICONS; "
                        . "it will render as the fallback box"
                    );
                }
            }
            unset($soc);
        }
    }
}

define('FC365_DEMO_KEYS', ['email', 'password', 'name']);

function fc365_validate_demo_user($ctx, &$user, string $pointer = ''): void
{
    fc365_drop_nulls($user);
    if (!fc365_v_keys($ctx, $user, $pointer, FC365_DEMO_KEYS)) {
        return;
    }
    $p = fn($k) => $pointer !== '' ? "$pointer/$k" : $k;
    fc365_v_string(
        $ctx, $user, 'email', $p('email'), true, 0, 254,
        FC365_RE_EMAIL, 'email does not look like an address'
    );
    fc365_v_string($ctx, $user, 'password', $p('password'), true, 4, 100);
    fc365_v_string($ctx, $user, 'name', $p('name'), true, 1, 60);
}

// ------------------------------------------------------------------ menu
define('FC365_MENU_KEYS', ['label', 'href', 'cols', 'alignRight', 'groups', 'promo']);
define('FC365_GROUP_KEYS', ['title', 'items']);
define('FC365_LINK_KEYS', ['label', 'href']);
define('FC365_PROMO_KEYS', ['title', 'text', 'href', 'image']);

function fc365_validate_menu($ctx, &$menu, string $pointer = 'items'): void
{
    if (!fc365_is_list($menu)) {
        $ctx->err($pointer, 'menu must be a list');
        return;
    }
    if (count($menu) > FC365_MAX_MENU_TOP) {
        $ctx->err($pointer, 'at most ' . FC365_MAX_MENU_TOP . ' top-level menu items');
    }
    $seen = [];
    foreach ($menu as $i => &$node) {
        $np = "$pointer/$i";
        fc365_drop_nulls($node);
        if (!fc365_v_keys($ctx, $node, $np, FC365_MENU_KEYS)) {
            continue;
        }
        $label = fc365_v_string($ctx, $node, 'label', "$np/label", true, 1, 24);
        fc365_v_href($ctx, $node, 'href', "$np/href", true);
        fc365_v_int($ctx, $node, 'cols', "$np/cols", 1, 4);
        fc365_v_bool($ctx, $node, 'alignRight', "$np/alignRight");

        if ($label) {
            // components.js writes data-nav="<slug>" and main.js queries it;
            // two labels that slug the same silently break the active-nav
            // highlight and the header search category select.
            $key = fc365_slug($label);
            if ($key === '') {
                $ctx->err("$np/label", 'label must contain at least one letter or digit');
            } elseif (array_key_exists($key, $seen)) {
                [$seenIndex, $seenLabel] = $seen[$key];
                $ctx->err(
                    "$np/label",
                    "label slugs to '$key', the same as item $seenIndex ('$seenLabel'); "
                    . "top-level menu slugs must be unique"
                );
            } else {
                $seen[$key] = [$i, $label];
            }
        }

        if (array_key_exists('groups', $node)) {
            if (!fc365_is_list($node['groups'])) {
                $ctx->err("$np/groups", 'groups must be a list');
            } elseif (count($node['groups']) > FC365_MAX_MENU_GROUPS) {
                $ctx->err("$np/groups", 'at most ' . FC365_MAX_MENU_GROUPS . ' groups');
            } else {
                foreach ($node['groups'] as $g => &$group) {
                    $gp = "$np/groups/$g";
                    fc365_drop_nulls($group);
                    if (!fc365_v_keys($ctx, $group, $gp, FC365_GROUP_KEYS)) {
                        continue;
                    }
                    fc365_v_string($ctx, $group, 'title', "$gp/title", true, 1, 40);
                    if (!array_key_exists('items', $group) || !fc365_is_list($group['items'])) {
                        $ctx->err("$gp/items", 'items must be a list');
                        continue;
                    }
                    if (count($group['items']) > FC365_MAX_MENU_LINKS) {
                        $ctx->err("$gp/items", 'at most ' . FC365_MAX_MENU_LINKS . ' links in a group');
                        continue;
                    }
                    foreach ($group['items'] as $li => &$link) {
                        $lp = "$gp/items/$li";
                        fc365_drop_nulls($link);
                        if (!fc365_is_dict($link)) {
                            $ctx->err($lp, 'expected a {label, href} object');
                            continue;
                        }
                        // Depth is fixed at exactly three: item -> group -> link.
                        if (array_key_exists('items', $link) || array_key_exists('groups', $link)) {
                            $ctx->err(
                                $lp,
                                'the menu is exactly three levels deep; a link cannot have children'
                            );
                            continue;
                        }
                        if (!fc365_v_keys($ctx, $link, $lp, FC365_LINK_KEYS)) {
                            continue;
                        }
                        fc365_v_string($ctx, $link, 'label', "$lp/label", true, 1, 60);
                        fc365_v_href($ctx, $link, 'href', "$lp/href", true);
                    }
                    unset($link);
                }
                unset($group);
            }
        }

        if (array_key_exists('promo', $node)) {
            $pp = "$np/promo";
            fc365_drop_nulls($node['promo']);
            if (fc365_v_keys($ctx, $node['promo'], $pp, FC365_PROMO_KEYS)) {
                fc365_v_string($ctx, $node['promo'], 'title', "$pp/title", true, 1, 40);
                fc365_v_string($ctx, $node['promo'], 'text', "$pp/text", false, 0, 80);
                fc365_v_href($ctx, $node['promo'], 'href', "$pp/href", true);
                fc365_v_image($ctx, $node['promo'], 'image', "$pp/image", true);
            }
        }
    }
    unset($node);
}

// ------------------------------------------------- simple array entities
define('FC365_HERO_KEYS', ['title', 'text', 'cta', 'href', 'image', 'align']);
define('FC365_CATEGORY_KEYS', ['label', 'slug', 'image']);
define('FC365_SERIES_KEYS', ['slug', 'eyebrow', 'title', 'text', 'cta', 'href', 'image']);
define('FC365_BRAND_KEYS', ['name', 'slug', 'category', 'categoryLabel', 'logo']);
define('FC365_CLIENT_KEYS', ['name', 'image']);
define('FC365_FOOTER_KEYS', ['title', 'items']);

function fc365_v_unique($ctx, array $values, callable $pointerFor, string $field, string $what): void
{
    $seen = [];
    foreach ($values as $i => $value) {
        if ($value === null) {
            continue;
        }
        if (array_key_exists($value, $seen)) {
            $ctx->err(
                $pointerFor($i) . '/' . $field,
                "duplicate $what '$value' (already used at index {$seen[$value]})"
            );
        } else {
            $seen[$value] = $i;
        }
    }
}

function fc365_validate_hero($ctx, &$hero, string $pointer = 'items'): void
{
    if (!fc365_is_list($hero)) {
        $ctx->err($pointer, 'hero must be a list');
        return;
    }
    $count = count($hero);
    if (!($count >= 1 && $count <= 8)) {
        $ctx->err($pointer, 'between 1 and 8 hero slides');
    }
    foreach ($hero as $i => &$slide) {
        $sp = "$pointer/$i";
        fc365_drop_nulls($slide);
        if (!fc365_v_keys($ctx, $slide, $sp, FC365_HERO_KEYS)) {
            continue;
        }
        fc365_v_string($ctx, $slide, 'title', "$sp/title", true, 1, 60);
        fc365_v_string($ctx, $slide, 'text', "$sp/text", false, 0, 120);
        fc365_v_string($ctx, $slide, 'cta', "$sp/cta", false, 0, 24);
        fc365_v_href($ctx, $slide, 'href', "$sp/href", true);
        fc365_v_image($ctx, $slide, 'image', "$sp/image", true);
        $align = fc365_v_string($ctx, $slide, 'align', "$sp/align", false, 0, 10);
        if ($align && !in_array($align, ['left', 'center', 'right'], true)) {
            $ctx->err("$sp/align", 'align must be left, center or right');
        }
    }
    unset($slide);
}

function fc365_validate_categories($ctx, &$cats, string $pointer = 'items'): void
{
    if (!fc365_is_list($cats)) {
        $ctx->err($pointer, 'categories must be a list');
        return;
    }
    $count = count($cats);
    if (!($count >= 1 && $count <= 40)) {
        $ctx->err($pointer, 'between 1 and 40 categories');
    }
    $slugs = [];
    foreach ($cats as $i => &$cat) {
        $cp = "$pointer/$i";
        fc365_drop_nulls($cat);
        if (!fc365_v_keys($ctx, $cat, $cp, FC365_CATEGORY_KEYS)) {
            $slugs[] = null;
            continue;
        }
        fc365_v_string($ctx, $cat, 'label', "$cp/label", true, 1, 40);
        $slugs[] = fc365_v_string(
            $ctx, $cat, 'slug', "$cp/slug", true, 0, null,
            FC365_RE_SLUG40, 'slug must be lowercase letters, digits and dashes'
        );
        fc365_v_image($ctx, $cat, 'image', "$cp/image", true);
    }
    unset($cat);
    fc365_v_unique($ctx, $slugs, fn($i) => "$pointer/$i", 'slug', 'category slug');
}

function fc365_validate_series($ctx, &$series, string $pointer = 'items'): void
{
    if (!fc365_is_list($series)) {
        $ctx->err($pointer, 'series must be a list');
        return;
    }
    $count = count($series);
    if (!($count >= 1 && $count <= 6)) {
        $ctx->err($pointer, 'between 1 and 6 series');
    }
    $slugs = [];
    foreach ($series as $i => &$entry) {
        $sp = "$pointer/$i";
        fc365_drop_nulls($entry);
        if (!fc365_v_keys($ctx, $entry, $sp, FC365_SERIES_KEYS)) {
            $slugs[] = null;
            continue;
        }
        $key = fc365_v_string(
            $ctx, $entry, 'slug', "$sp/slug", true, 0, null,
            FC365_RE_SLUG40, 'slug must be lowercase letters, digits and dashes'
        );
        $slugs[] = $key;
        fc365_v_string($ctx, $entry, 'eyebrow', "$sp/eyebrow", false, 0, 40);
        fc365_v_string($ctx, $entry, 'title', "$sp/title", true, 1, 80);
        fc365_v_string($ctx, $entry, 'text', "$sp/text", false, 0, 200);
        fc365_v_string($ctx, $entry, 'cta', "$sp/cta", false, 0, 40);
        $href = fc365_v_href($ctx, $entry, 'href', "$sp/href", true);
        fc365_v_image($ctx, $entry, 'image', "$sp/image", true);
        if ($key && $href) {
            if (preg_match(FC365_RE_SERIES_KEY, $href, $m) && $m[1] !== $key) {
                // shop.js reads ?series= off the URL; a mismatch means the
                // CTA lands on a filter that shows nothing.
                $ctx->warn(
                    "series[$i] slug is '$key' but its link filters on '{$m[1]}'; "
                    . "the Explore button will not match this series"
                );
            }
        }
    }
    unset($entry);
    fc365_v_unique($ctx, $slugs, fn($i) => "$pointer/$i", 'slug', 'series slug');
}

function fc365_validate_brands($ctx, &$brands, string $pointer = 'items'): void
{
    if (!fc365_is_list($brands)) {
        $ctx->err($pointer, 'brands must be a list');
        return;
    }
    if (count($brands) > 200) {
        $ctx->err($pointer, 'at most 200 brands');
    }
    $slugs = [];
    foreach ($brands as $i => &$brand) {
        $bp = "$pointer/$i";
        fc365_drop_nulls($brand);
        if (!fc365_v_keys($ctx, $brand, $bp, FC365_BRAND_KEYS)) {
            $slugs[] = null;
            continue;
        }
        fc365_v_string($ctx, $brand, 'name', "$bp/name", true, 1, 40);
        $slugs[] = fc365_v_string(
            $ctx, $brand, 'slug', "$bp/slug", true, 0, 40,
            FC365_RE_BRAND_SLUG, 'slug must be lowercase letters, digits and dashes'
        );
        fc365_v_string($ctx, $brand, 'category', "$bp/category", false, 0, 40);
        fc365_v_string($ctx, $brand, 'categoryLabel', "$bp/categoryLabel", false, 0, 40);
        fc365_v_image($ctx, $brand, 'logo', "$bp/logo", true);
    }
    unset($brand);
    fc365_v_unique($ctx, $slugs, fn($i) => "$pointer/$i", 'slug', 'brand slug');
}

function fc365_validate_clients($ctx, &$clients, string $pointer = 'items'): void
{
    if (!fc365_is_list($clients)) {
        $ctx->err($pointer, 'clients must be a list');
        return;
    }
    $count = count($clients);
    if (!($count >= 1 && $count <= 200)) {
        $ctx->err($pointer, 'between 1 and 200 clients');
    }
    foreach ($clients as $i => &$client) {
        $cp = "$pointer/$i";
        fc365_drop_nulls($client);
        if (!fc365_v_keys($ctx, $client, $cp, FC365_CLIENT_KEYS)) {
            continue;
        }
        fc365_v_string($ctx, $client, 'name', "$cp/name", true, 1, 60);
        fc365_v_image($ctx, $client, 'image', "$cp/image", true);
    }
    unset($client);
}

function fc365_validate_footer_links($ctx, &$columns, string $pointer = 'items'): void
{
    if (!fc365_is_list($columns)) {
        $ctx->err($pointer, 'footerLinks must be a list');
        return;
    }
    $count = count($columns);
    if (!($count >= 1 && $count <= 4)) {
        $ctx->err($pointer, 'between 1 and 4 footer columns (the footer grid holds 4)');
    }
    foreach ($columns as $i => &$column) {
        $cp = "$pointer/$i";
        fc365_drop_nulls($column);
        if (!fc365_v_keys($ctx, $column, $cp, FC365_FOOTER_KEYS)) {
            continue;
        }
        fc365_v_string($ctx, $column, 'title', "$cp/title", true, 1, 40);
        if (!array_key_exists('items', $column) || !fc365_is_list($column['items'])) {
            $ctx->err("$cp/items", 'items must be a list');
            continue;
        }
        $n = count($column['items']);
        if (!($n >= 1 && $n <= 12)) {
            $ctx->err("$cp/items", 'between 1 and 12 links in a footer column');
            continue;
        }
        foreach ($column['items'] as $li => &$link) {
            $lp = "$cp/items/$li";
            fc365_drop_nulls($link);
            if (!fc365_v_keys($ctx, $link, $lp, FC365_LINK_KEYS)) {
                continue;
            }
            fc365_v_string($ctx, $link, 'label', "$lp/label", true, 1, 60);
            fc365_v_href($ctx, $link, 'href', "$lp/href", true);
        }
        unset($link);
    }
    unset($column);
}

function fc365_validate_bed_sizes($ctx, &$values, string $pointer = 'items'): void
{
    if (!fc365_is_list($values)) {
        $ctx->err($pointer, 'bedSizes must be a list');
        return;
    }
    if (count($values) > FC365_MAX_BED_SIZES) {
        $ctx->err($pointer, 'at most ' . FC365_MAX_BED_SIZES . ' entries');
        return;
    }
    $holder = ['bedSizes' => $values];
    fc365_v_string_list($ctx, $holder, 'bedSizes', $pointer, 0, FC365_MAX_BED_SIZES, 1, 40);
    $values = $holder['bedSizes'];
}

// -------------------------------------------------------------- products
define('FC365_PRODUCT_KEYS', [
    'id', 'sku', 'name', 'category', 'categoryLabel', 'sub', 'series', 'brand',
    'price', 'priceMin', 'priceMax', 'image', 'gallery', 'variable', 'badge',
    'options', 'swatches', 'short', 'material', 'dimensions', 'warranty',
]);
define('FC365_PRICE_KEYS', ['price', 'priceMin', 'priceMax']);

/** One product. Reference checks (category/series/brand) live in fc365_check_references(). */
function fc365_validate_product($ctx, &$product, string $pointer, array $doc): ?string
{
    fc365_drop_nulls($product, FC365_PRICE_KEYS);
    if (!fc365_v_keys($ctx, $product, $pointer, FC365_PRODUCT_KEYS)) {
        return null;
    }

    $pid = fc365_v_string(
        $ctx, $product, 'id', "$pointer/id", true, 0, null, FC365_RE_PRODUCT_ID,
        'id must be lowercase letters, digits and dashes, 2-64 characters, starting with a letter or digit'
    );
    fc365_v_string($ctx, $product, 'name', "$pointer/name", true, 2, 120);
    fc365_v_string(
        $ctx, $product, 'sku', "$pointer/sku", true, 1, 40, FC365_RE_SKU,
        'sku may hold letters, digits, dots, slashes, spaces and dashes'
    );
    fc365_v_string($ctx, $product, 'category', "$pointer/category", true, 0, 40);
    fc365_v_string($ctx, $product, 'categoryLabel', "$pointer/categoryLabel", true, 1, 40);
    fc365_v_string(
        $ctx, $product, 'sub', "$pointer/sub", false, 0, null,
        FC365_RE_SUB, 'sub must be lowercase letters, digits and dashes'
    );
    fc365_v_string($ctx, $product, 'series', "$pointer/series", false, 0, 40);
    fc365_v_string($ctx, $product, 'brand', "$pointer/brand", false, 0, 40);
    fc365_v_string($ctx, $product, 'badge', "$pointer/badge", false, 0, 12);
    fc365_v_string($ctx, $product, 'short', "$pointer/short", false, 0, 600);
    fc365_v_string($ctx, $product, 'material', "$pointer/material", false, 0, 200);
    fc365_v_string($ctx, $product, 'dimensions', "$pointer/dimensions", false, 0, 120);
    fc365_v_string($ctx, $product, 'warranty', "$pointer/warranty", false, 0, 120);
    fc365_v_bool($ctx, $product, 'variable', "$pointer/variable");

    fc365_validate_price($ctx, $product, $pointer);
    fc365_validate_images($ctx, $product, $pointer);
    fc365_validate_options($ctx, $product, $pointer, $doc);
    return $pid;
}

/**
 * Exactly one shape: price alone, or priceMin and priceMax together.
 *
 * components.js:priceHTML keys purely off (priceMin != null && priceMax !=
 * null), while cart.js charges `price`. A product holding both shows a
 * range on the card and charges the fixed price at checkout, so the two
 * shapes are exclusive.
 */
function fc365_validate_price($ctx, array &$product, string $pointer): void
{
    $hasSingle = array_key_exists('price', $product);
    $hasMin = array_key_exists('priceMin', $product);
    $hasMax = array_key_exists('priceMax', $product);

    if ($hasSingle && ($hasMin || $hasMax)) {
        $ctx->err(
            "$pointer/price",
            'a product has either a single price or a priceMin/priceMax range, never both'
        );
        return;
    }
    if ($hasSingle) {
        fc365_v_money($ctx, $product, 'price', "$pointer/price");
        return;
    }
    if ($hasMin !== $hasMax) {
        $missing = $hasMin ? 'priceMax' : 'priceMin';
        $ctx->err("$pointer/$missing", "$missing is required when the other half of the range is set");
        return;
    }
    if (!$hasMin) {
        $ctx->err($pointer . '/price', 'a price is required: either price, or priceMin and priceMax');
        return;
    }
    $low = fc365_v_money($ctx, $product, 'priceMin', "$pointer/priceMin");
    $high = fc365_v_money($ctx, $product, 'priceMax', "$pointer/priceMax");
    if ($low !== null && $high !== null && $low >= $high) {
        $ctx->err("$pointer/priceMin", 'priceMin must be less than priceMax');
    }
}

/** image is gallery[0]. Every shipped product already satisfies this. */
function fc365_validate_images($ctx, array &$product, string $pointer): void
{
    if (array_key_exists('gallery', $product)) {
        if (!fc365_is_list($product['gallery'])) {
            $ctx->err("$pointer/gallery", 'gallery must be a list of image paths');
            return;
        }
        $n = count($product['gallery']);
        if (!($n >= 1 && $n <= FC365_MAX_GALLERY)) {
            $ctx->err(
                "$pointer/gallery",
                'gallery holds between 1 and ' . FC365_MAX_GALLERY . " images (got $n)"
            );
            return;
        }
        foreach ($product['gallery'] as $i => &$g) {
            $holder = ['v' => $g];
            fc365_v_image($ctx, $holder, 'v', "$pointer/gallery/$i", true);
            $g = $holder['v'];
        }
        unset($g);
        // The gallery strip's first tile IS the main image, so derive it
        // when the form did not send one.
        if (!array_key_exists('image', $product) && $product['gallery']) {
            $product['image'] = $product['gallery'][0];
        }
    }

    $image = fc365_v_image($ctx, $product, 'image', "$pointer/image", true);
    if (
        $image !== null && $image !== ''
        && array_key_exists('gallery', $product)
        && fc365_is_list($product['gallery']) && $product['gallery']
        && $image !== $product['gallery'][0]
    ) {
        $ctx->err(
            "$pointer/image",
            'image must equal gallery[0] (the main image); reorder the gallery to change which photo is main'
        );
    }
}

function fc365_validate_options($ctx, array &$product, string $pointer, array $doc): void
{
    $resolvedValues = [];
    if (array_key_exists('options', $product)) {
        if (!fc365_is_dict($product['options'])) {
            $ctx->err("$pointer/options", 'options must be an object of name -> list');
            return;
        }
        if (count($product['options']) > FC365_MAX_OPTIONS) {
            $ctx->err("$pointer/options", 'at most ' . FC365_MAX_OPTIONS . ' option groups');
            return;
        }
        $seenSlugs = [];
        foreach (array_keys($product['options']) as $rawKey) {
            // json_decode(..., true) turns a numeric-looking JSON object key
            // into a PHP int array key; force it back to the string Python's
            // json.loads would always have handed validate.py.
            $key = (string) $rawKey;
            $kp = "$pointer/options/$key";
            $len = mb_strlen($key, 'UTF-8');
            if (!($len >= 1 && $len <= 24)) {
                $ctx->err($kp, 'option name must be 1-24 characters');
                continue;
            }
            if (!preg_match(FC365_RE_OPTION_KEY, $key)) {
                $ctx->err($kp, 'option name must start with a letter and hold only letters, digits and spaces');
                continue;
            }
            // product.js builds id="opt-"+slug(key); a collision would
            // produce two elements with the same id and the label would
            // point at the wrong one.
            $keySlug = fc365_slug($key);
            if ($keySlug === '') {
                $ctx->err($kp, 'option name must contain a letter or digit');
                continue;
            }
            if (array_key_exists($keySlug, $seenSlugs)) {
                $ctx->err($kp, "option name collides with '{$seenSlugs[$keySlug]}' once slugged ('$keySlug')");
                continue;
            }
            $seenSlugs[$keySlug] = $key;

            [$values, $isRef] = fc365_v_resolve_list($ctx, $product['options'], $rawKey, $kp, $doc);
            if ($isRef) {
                if ($values === null) {
                    continue;
                }
            } else {
                $holder = ['v' => $product['options'][$rawKey]];
                $values = fc365_v_string_list($ctx, $holder, 'v', $kp, 1, FC365_MAX_OPTION_VALUES, 1, 40);
                $product['options'][$rawKey] = $holder['v'];
                if ($values === null) {
                    continue;
                }
            }
            foreach ($values as $value) {
                if ($value) {
                    $resolvedValues[$value] = true;
                }
            }
        }
    }

    if (!array_key_exists('swatches', $product)) {
        return;
    }
    $sp = "$pointer/swatches";
    [$values, $isRef] = fc365_v_resolve_list($ctx, $product, 'swatches', $sp, $doc);
    if ($isRef) {
        if ($values === null) {
            return;
        }
    } else {
        $values = fc365_v_string_list($ctx, $product, 'swatches', $sp, 1, FC365_MAX_SWATCHES, 1, 40);
        if ($values === null) {
            return;
        }
    }
    if (count($values) > FC365_MAX_SWATCHES) {
        $ctx->err($sp, 'at most ' . FC365_MAX_SWATCHES . ' swatches');
        return;
    }
    foreach ($values as $i => $value) {
        if ($value && !array_key_exists($value, $resolvedValues)) {
            // shop.js filters against swatches while product.js renders the
            // select from options; a mismatch silently makes the product
            // unfilterable.
            $errPointer = $isRef ? $sp : "$sp/$i";
            $ctx->err(
                $errPointer,
                "swatch '$value' does not appear in any options list, so the shop filter "
                . "would never match this product"
            );
        }
    }
}

function fc365_validate_products($ctx, &$products, string $pointer, array $doc): void
{
    if (!fc365_is_list($products)) {
        $ctx->err($pointer, 'products must be a list');
        return;
    }
    $ids = [];
    foreach ($products as $i => &$product) {
        $ids[] = fc365_validate_product($ctx, $product, "$pointer/$i", $doc);
    }
    unset($product);
    fc365_v_unique($ctx, $ids, fn($i) => "$pointer/$i", 'id', 'product id');
}

// ------------------------------------------------------- whole document
function fc365_validate_collection_dispatch($ctx, string $collection, &$value, string $pointer, array $doc): void
{
    switch ($collection) {
        case 'site':
            fc365_validate_site($ctx, $value, $pointer);
            break;
        case 'demoUser':
            fc365_validate_demo_user($ctx, $value, $pointer);
            break;
        case 'menu':
            fc365_validate_menu($ctx, $value, $pointer);
            break;
        case 'hero':
            fc365_validate_hero($ctx, $value, $pointer);
            break;
        case 'categories':
            fc365_validate_categories($ctx, $value, $pointer);
            break;
        case 'series':
            fc365_validate_series($ctx, $value, $pointer);
            break;
        case 'brands':
            fc365_validate_brands($ctx, $value, $pointer);
            break;
        case 'clients':
            fc365_validate_clients($ctx, $value, $pointer);
            break;
        case 'footerLinks':
            fc365_validate_footer_links($ctx, $value, $pointer);
            break;
        case 'bedSizes':
            fc365_validate_bed_sizes($ctx, $value, $pointer);
            break;
        case 'products':
            fc365_validate_products($ctx, $value, $pointer, $doc);
            break;
        default:
            throw new ValidationError([$pointer => 'unknown collection'], 'Unknown collection.');
    }
}

/** Validate one collection in isolation. Returns warnings, raises ValidationError. */
function fc365_validate_collection(string $collection, &$value, array $doc, string $pointer): array
{
    if (!in_array($collection, FC365_COLLECTIONS, true)) {
        throw new ValidationError([$pointer => 'unknown collection'], 'Unknown collection.');
    }
    $ctx = new FC365ValidationContext();
    fc365_validate_collection_dispatch($ctx, $collection, $value, $pointer, $doc);
    if ($ctx->fields) {
        throw new ValidationError($ctx->fields);
    }
    return $ctx->warnings;
}

/** The whole document. Normalises in place (via references). Raises ValidationError. */
function fc365_validate_document(array &$doc, string $root = ''): array
{
    $ctx = new FC365ValidationContext($root);

    $allowed = array_merge(['_meta'], FC365_COLLECTIONS);
    foreach (array_keys($doc) as $key) {
        if (!in_array($key, $allowed, true)) {
            $ctx->err((string) $key, "unknown top-level key '$key'");
        }
    }
    foreach (FC365_COLLECTIONS as $key) {
        if (!array_key_exists($key, $doc)) {
            $ctx->err($key, "missing top-level key '$key'");
        }
    }
    if ($ctx->fields) {
        throw new ValidationError($ctx->fields);
    }

    // bedSizes first: products resolve @bedSizes against it.
    fc365_validate_bed_sizes($ctx, $doc['bedSizes'], 'bedSizes');
    foreach (FC365_COLLECTIONS as $key) {
        if ($key === 'bedSizes') {
            continue;
        }
        fc365_validate_collection_dispatch($ctx, $key, $doc[$key], $key, $doc);
    }

    if ($ctx->fields) {
        throw new ValidationError($ctx->fields);
    }
    return $ctx->warnings;
}

// ------------------------------------------------------------ references
function fc365_series_keys(array $doc): array
{
    $out = [];
    foreach ((fc365_is_list($doc['series'] ?? null) ? $doc['series'] : []) as $s) {
        if (fc365_is_dict($s) && !empty($s['slug'])) {
            $out[] = $s['slug'];
        }
    }
    return $out;
}

function fc365_category_slugs(array $doc): array
{
    $out = [];
    foreach ((fc365_is_list($doc['categories'] ?? null) ? $doc['categories'] : []) as $c) {
        if (fc365_is_dict($c) && !empty($c['slug'])) {
            $out[] = $c['slug'];
        }
    }
    return $out;
}

function fc365_menu_slugs(array $doc): array
{
    $out = [];
    foreach ((fc365_is_list($doc['menu'] ?? null) ? $doc['menu'] : []) as $node) {
        if (fc365_is_dict($node) && !empty($node['label'])) {
            $key = fc365_slug($node['label']);
            if ($key !== '') {
                $out[] = $key;
            }
        }
    }
    return $out;
}

function fc365_brand_slugs(array $doc): array
{
    $out = [];
    foreach ((fc365_is_list($doc['brands'] ?? null) ? $doc['brands'] : []) as $b) {
        if (fc365_is_dict($b) && !empty($b['slug'])) {
            $out[] = $b['slug'];
        }
    }
    return $out;
}

/**
 * Find products left pointing at something that is not there.
 *
 * Returns ["category" => [pid => value], "series" => [...], "brand" =>
 * [...], "bedSizes" => [pid => "swatches"]].
 *
 * Kept out of fc365_validate_document() on purpose. The same dangling
 * reference is a 400 when the products themselves are being written and a
 * 409 in_use when a categories/series/menu write is what orphaned them.
 */
function fc365_check_references(array $doc): array
{
    $knownCategories = array_merge(fc365_category_slugs($doc), fc365_menu_slugs($doc));
    $knownSeries = fc365_series_keys($doc);
    $knownBrands = fc365_brand_slugs($doc);
    $bedSizes = fc365_is_list($doc['bedSizes'] ?? null) ? $doc['bedSizes'] : [];

    $out = ['category' => [], 'series' => [], 'brand' => [], 'bedSizes' => []];
    foreach ((fc365_is_list($doc['products'] ?? null) ? $doc['products'] : []) as $product) {
        if (!fc365_is_dict($product)) {
            continue;
        }
        $pid = $product['id'] ?? '?';
        $category = $product['category'] ?? null;
        if ($category && !in_array($category, $knownCategories, true)) {
            $out['category'][$pid] = $category;
        }
        $series = $product['series'] ?? null;
        if ($series && !in_array($series, $knownSeries, true)) {
            $out['series'][$pid] = $series;
        }
        $brand = $product['brand'] ?? null;
        if ($brand && !in_array($brand, $knownBrands, true)) {
            $out['brand'][$pid] = $brand;
        }
        if (!$bedSizes) {
            $refs = [];
            if (fc365_shared_ref_key($product['swatches'] ?? null) === 'bedSizes') {
                $refs[] = 'swatches';
            }
            $options = $product['options'] ?? null;
            if (fc365_is_dict($options)) {
                foreach ($options as $key => $value) {
                    if (fc365_shared_ref_key($value) === 'bedSizes') {
                        $refs[] = 'options.' . $key;
                    }
                }
            }
            if ($refs) {
                $out['bedSizes'][$pid] = implode(', ', $refs);
            }
        }
    }
    return $out;
}

/** The human strings for the `warnings` array of a write response. */
function fc365_reference_warnings(array $refs): array
{
    $out = [];
    $brand = $refs['brand'] ?? [];
    ksort($brand);
    foreach ($brand as $pid => $value) {
        $out[] = "product $pid references brand '$value', which is not in brands; "
            . "product.js tolerates this and renders no brand line";
    }
    $category = $refs['category'] ?? [];
    ksort($category);
    foreach ($category as $pid => $value) {
        $out[] = "product $pid references category '$value', which no longer exists; "
            . "it will not appear under any category filter";
    }
    $series = $refs['series'] ?? [];
    ksort($series);
    foreach ($series as $pid => $value) {
        $out[] = "product $pid references series '$value', which no longer exists; "
            . "it will not appear under any series filter";
    }
    $bedSizes = $refs['bedSizes'] ?? [];
    ksort($bedSizes);
    foreach ($bedSizes as $pid => $where) {
        $out[] = "product $pid still points at the shared bed-size list ($where), which is now empty";
    }
    return $out;
}
