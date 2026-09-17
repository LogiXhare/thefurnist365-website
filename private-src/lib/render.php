<?php

// No declare(strict_types=1) in this codebase — see the note in config.php.

require_once __DIR__ . '/config.php';

/**
 * private/furnist365/site.json (as a PHP array)  ->  assets/js/data.js text.
 *
 * Port of server/render.py. The generated file must keep the exact contract
 * the 11 storefront pages already rely on: one blocking <script src> that has
 * set window.FC_DATA by the time components.js parses. Nothing here is
 * async, nothing here fetches.
 *
 * This module also owns slug() twice — once as the JavaScript text copied
 * into every generated file, once as the PHP mirror used by the validator.
 * They sit side by side so they cannot drift apart unnoticed.
 */
class RenderError extends Exception
{
}

// --------------------------------------------------------------- slug ----
// Copied from the hand-written assets/js/data.js, with one change: the
// typographic apostrophe U+2019 is assembled at require-time from chr(92)
// (a literal backslash byte) plus the plain text "u2019", instead of being
// typed directly as a backslash-u2019 escape sequence in this source file.
// That is not a style choice: typing that exact 6-byte sequence through
// this project's editing pipeline was confirmed (by hexdump) to silently
// land on disk as the real U+2019 character instead of the literal ASCII
// escape text -- which would then fail fc365_render_sanity_check()'s
// pure-ASCII check on every single save. Building it from chr(92) never
// types anything that looks like an escape sequence, so there is nothing
// for any layer to "helpfully" reinterpret.
// define() (not const) is used for the heredoc/nowdoc bodies in this file
// deliberately: define() imposes no "compile-time constant expression"
// restriction, so there is no ambiguity about whether a nowdoc qualifies.
$fc365_slug_js_src = <<<'JS'
  function slug(str) {
    return String(str)
      .toLowerCase()
      .replace(/[__FC365_APOS_ESCAPE__']/g, "")
      .replace(/&/g, "and")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

JS;
define('FC365_SLUG_JS', str_replace('__FC365_APOS_ESCAPE__', chr(92) . 'u2019', $fc365_slug_js_src));
unset($fc365_slug_js_src);

/**
 * The PHP mirror of FC365_SLUG_JS. Must agree with it character for character.
 */
function fc365_slug(string $value): string
{
    $s = mb_strtolower($value, 'UTF-8');
    $s = preg_replace('/[\x{2019}\']/u', '', $s);
    $s = str_replace('&', 'and', $s);
    $s = preg_replace('/[^a-z0-9]+/u', '-', $s);
    $s = preg_replace('/^-+|-+$/', '', $s);
    return $s;
}

// ------------------------------------------------------ shared lists ----
// A shared list reference ("@bedSizes") has to come out of the JSON emission
// as a bare JavaScript identifier, not a quoted string. The substitution is
// done on a marker built from U+0001, which the validator forbids in real
// content, so a product field whose text happens to read "@bedSizes" can
// never be rewritten by accident.
const FC365_MARK = "\x01";

function fc365_render_marker(string $jsName): string
{
    return FC365_MARK . $jsName . FC365_MARK;
}

/** What json_encode(...) (without JSON_UNESCAPED_UNICODE) makes of the marker. */
function fc365_render_marker_json(string $jsName): string
{
    return '"\\u0001' . $jsName . '\\u0001"';
}

/** Return the shared list key if $value is a reference, else null. */
function fc365_is_shared_ref($value): ?string
{
    if (is_string($value) && str_starts_with($value, FC365_SHARED_REF_PREFIX)) {
        $key = substr($value, strlen(FC365_SHARED_REF_PREFIX));
        if (array_key_exists($key, FC365_SHARED_LISTS)) {
            return $key;
        }
    }
    return null;
}

/** Expand a shared list reference against $doc. Non-references pass through. */
function fc365_resolve_shared($value, array $doc)
{
    $key = fc365_is_shared_ref($value);
    if ($key === null) {
        return $value;
    }
    $listed = $doc[$key] ?? null;
    return fc365_is_list($listed) ? $listed : [];
}

/**
 * Turn "@bedSizes" into the render marker, ONLY in products[].swatches and
 * products[].options[*] — the exact two fields validate.php resolves a
 * shared list reference in. Nothing else in a product — name, sku, short,
 * badge, dimensions, anything — is even looked at here, let alone rewritten.
 *
 * This is deliberately NOT a blanket tree-walk applied to every collection's
 * whole value: a product `name` (or a hero title, a site field, anything)
 * set to the literal 8-character string "@bedSizes" would validate cleanly
 * (it has no "<"/">" in it) and then, under a blanket substitution, get
 * silently rewritten at render time into the bare JS identifier BED_SIZES
 * where a quoted string was expected. Scoping the substitution to the two
 * fields that are ever ALLOWED to be a reference closes that off completely.
 */
function fc365_mark_shared_refs_in_products(array $products): array
{
    $out = [];
    foreach ($products as $product) {
        if (!fc365_is_dict($product)) {
            $out[] = $product;
            continue;
        }
        // PHP arrays are value types: assigning/mutating $product here never
        // mutates the caller's array element.
        $ref = fc365_is_shared_ref($product['swatches'] ?? null);
        if ($ref !== null) {
            $product['swatches'] = fc365_render_marker(FC365_SHARED_LISTS[$ref]);
        }
        if (isset($product['options']) && fc365_is_dict($product['options'])) {
            $newOptions = $product['options'];
            foreach ($product['options'] as $optKey => $optValue) {
                $ref2 = fc365_is_shared_ref($optValue);
                if ($ref2 !== null) {
                    $newOptions[$optKey] = fc365_render_marker(FC365_SHARED_LISTS[$ref2]);
                }
            }
            $product['options'] = $newOptions;
        }
        $out[] = $product;
    }
    return $out;
}

// ---------------------------------------------------------- emission ----
/**
 * JSON for a JS literal: all-ASCII, <-escaped, shared refs de-quoted.
 *
 * $value must already have any shared-list references turned into render
 * markers by the caller (see fc365_mark_shared_refs_in_products) — this
 * function does not walk the tree looking for "@bedSizes" itself.
 *
 * No JSON_UNESCAPED_UNICODE is deliberate (the equivalent of Python's
 * ensure_ascii=True): the data holds the taka sign, typographic apostrophes
 * and Bengali text; an all-ASCII file cannot be corrupted by a charset
 * mismatch between the script file and the document. JSON_UNESCAPED_SLASHES
 * keeps image paths readable (assets/img/... instead of assets\/img\/...);
 * it has no effect on correctness either way since \/ and / are the same
 * character once parsed.
 */
function fc365_render_emit($value, string $indent = '  '): string
{
    $text = json_encode(
        $value,
        JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR
    );

    // Kill a </script> break-out from any admin-entered string. The
    // validator rejects "<" outright; this is the second line of defence.
    $text = str_replace('<', '\\u003c', $text);
    // Valid in JSON, illegal in a pre-ES2019 JS string literal. ensure_ascii
    // (the lack of JSON_UNESCAPED_UNICODE above) has already escaped these
    // as   /  ; this replace is belt and braces for the rare case
    // they appear unescaped.
    $text = str_replace(["\xe2\x80\xa8", "\xe2\x80\xa9"], ['\\u2028', '\\u2029'], $text);

    foreach (FC365_SHARED_LISTS as $jsName) {
        $text = str_replace(fc365_render_marker_json($jsName), $jsName, $text);
    }

    $lines = explode("\n", $text);
    return implode("\n" . $indent, $lines);
}

// Pure ASCII, like everything else this module emits — sanity_check() enforces it.
define('FC365_RENDER_BANNER', <<<'TXT'
/* GENERATED FILE - do not edit. Source: private/furnist365/site.json.
   Regenerate: press Publish in /admin/, or php private-src/bin/admin-cli.php --rebuild.
   Hand edits are lost the next time an admin presses Save. */

TXT);

// (json key, JS var name, exported as)
const FC365_RENDER_VARS = [
    ['site', 'SITE', 'site'],
    ['menu', 'MENU', 'menu'],
    ['hero', 'HERO', 'hero'],
    ['categories', 'CATEGORIES', 'categories'],
    ['series', 'SERIES', 'series'],
    ['bedSizes', 'BED_SIZES', null], // shared list: declared, never exported
    ['products', 'PRODUCTS', 'products'],
    ['brands', 'BRANDS', 'brands'],
    ['clients', 'CLIENTS', 'clients'],
    ['footerLinks', 'FOOTER_LINKS', 'footerLinks'],
    ['demoUser', 'DEMO_USER', 'demoUser'],
];

const FC365_RENDER_DEFAULTS = ['site' => [], 'demoUser' => []];

/** Render the whole document. Raises RenderError if the result looks wrong. */
function fc365_build_js(array $doc): string
{
    $meta = $doc['_meta'] ?? [];
    $out = [FC365_RENDER_BANNER];
    $out[] = sprintf(
        "/* rev %s | %s */\n",
        (string) ($meta['rev'] ?? '?'),
        (string) ($meta['updatedAt'] ?? '?')
    );
    $out[] = "(function (window) {\n";
    $out[] = "  \"use strict\";\n\n";
    $out[] = FC365_SLUG_JS;
    $out[] = "\n";

    foreach (FC365_RENDER_VARS as [$key, $jsName, $exportedAs]) {
        $value = $doc[$key] ?? (FC365_RENDER_DEFAULTS[$key] ?? []);
        if ($key === 'products') {
            $value = fc365_mark_shared_refs_in_products(fc365_is_list($value) ? $value : []);
        }
        $out[] = sprintf("  var %s = %s;\n", $jsName, fc365_render_emit($value));
    }

    $out[] = "\n  window.FC_DATA = {\n    slug: slug,\n";
    $exported = array_values(array_filter(
        array_map(fn($row) => $row[2] !== null ? [$row[1], $row[2]] : null, FC365_RENDER_VARS)
    ));
    $count = count($exported);
    foreach ($exported as $i => [$jsName, $name]) {
        $tail = ($i === $count - 1) ? '' : ',';
        $out[] = sprintf("    %s: %s%s\n", $name, $jsName, $tail);
    }
    $out[] = "  };\n";
    $out[] = "})(window);\n";

    $text = implode('', $out);
    fc365_render_sanity_check($text);
    return $text;
}

/** Refuse to swap in a file that cannot possibly work. Raises RenderError. */
function fc365_render_sanity_check(string $text): bool
{
    if (!str_contains($text, 'window.FC_DATA')) {
        throw new RenderError('rendered data.js does not assign window.FC_DATA');
    }
    if (!str_ends_with(rtrim($text), '})(window);')) {
        throw new RenderError('rendered data.js does not close its IIFE');
    }
    if (strlen($text) < 2000) {
        throw new RenderError(sprintf(
            'rendered data.js is only %d bytes - the document looks empty',
            strlen($text)
        ));
    }
    if (!str_contains($text, 'function slug(str)')) {
        throw new RenderError('rendered data.js is missing the slug() helper');
    }
    $afterIife = explode('(function (window)', $text, 2)[1] ?? '';
    if (str_contains($afterIife, '_meta')) {
        throw new RenderError('_meta leaked into the rendered data.js');
    }
    foreach (FC365_RENDER_VARS as [$key, $jsName, $name]) {
        if (!str_contains($text, "var $jsName =")) {
            throw new RenderError("rendered data.js is missing var $jsName");
        }
        if ($name !== null && !str_contains($text, "$name: $jsName")) {
            throw new RenderError("rendered data.js does not export $name");
        }
    }
    if (preg_match('/[^\x00-\x7F]/', $text)) {
        throw new RenderError('rendered data.js is not pure ASCII');
    }
    return true;
}
