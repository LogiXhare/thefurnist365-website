#!/usr/bin/env python3
"""data/site.json  ->  site/assets/js/data.js

Standalone build step, meant to run in CI (see .github/workflows/deploy.yml)
before the deploy sync, and locally via:

    python3 build/render_data_js.py

It is a self-contained copy of the render logic from the original Python
admin backend's `server/render.py` (see docs/api-admin.md for the full
contract that file implements) -- copied rather than imported because that
backend is a persistent daemon meant to run on a developer's own machine,
not something this repo runs, and this script needs no dependency on it.
If the two ever drift, this one and the contract doc are the ones that
matter for what actually ships.

The generated file must keep the exact contract the 11 storefront pages
already rely on: one blocking <script src> that has set window.FC_DATA by
the time components.js parses. Nothing here is async, nothing here fetches.
"""

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SITE_JSON = ROOT / "data" / "site.json"
DATA_JS = ROOT / "site" / "assets" / "js" / "data.js"


class RenderError(Exception):
    """The rendered data.js failed its own sanity check. Abort the build."""


# --------------------------------------------------------------- slug ----
SLUG_JS = """\
  function slug(str) {
    return String(str)
      .toLowerCase()
      .replace(/[\\u2019']/g, "")
      .replace(/&/g, "and")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }
"""

# ------------------------------------------------------ shared lists ----
# A shared list reference ("@bedSizes") has to come out of json.dumps as a
# bare JavaScript identifier, not a quoted string. The substitution is
# scoped to exactly the two fields that may ever hold one -- see
# _mark_shared_refs_in_products below and docs/api-admin.md section 7.1 for
# why an unscoped, blanket tree-walk version of this was a real bug.
SHARED_LISTS = {"bedSizes": "BED_SIZES"}
SHARED_REF_PREFIX = "@"

_MARK = "\u0001"


def _marker(js_name):
    return _MARK + js_name + _MARK


def _marker_json(js_name):
    return '"\\u0001' + js_name + '\\u0001"'


def _is_shared_ref(value):
    if isinstance(value, str) and value.startswith(SHARED_REF_PREFIX):
        key = value[len(SHARED_REF_PREFIX) :]
        if key in SHARED_LISTS:
            return key
    return None


def _mark_shared_refs_in_products(products):
    """Turn "@bedSizes" into the render marker, ONLY in products[].swatches
    and products[].options[*]. Nothing else in a product -- name, sku,
    short, badge, dimensions, anything -- is touched here.
    """
    out = []
    for product in products:
        if not isinstance(product, dict):
            out.append(product)
            continue
        product = dict(product)  # shallow copy; never mutate the caller's doc
        ref = _is_shared_ref(product.get("swatches"))
        if ref is not None:
            product["swatches"] = _marker(SHARED_LISTS[ref])
        options = product.get("options")
        if isinstance(options, dict):
            new_options = dict(options)
            for opt_key, opt_value in options.items():
                ref = _is_shared_ref(opt_value)
                if ref is not None:
                    new_options[opt_key] = _marker(SHARED_LISTS[ref])
            product["options"] = new_options
        out.append(product)
    return out


# ---------------------------------------------------------- emission ----
def _emit(value, indent="  "):
    """JSON for a JS literal: all-ASCII, <-escaped, shared refs de-quoted.

    ensure_ascii=True is deliberate: the data holds the taka sign,
    typographic apostrophes and Bengali text; an all-ASCII file cannot be
    corrupted by a charset mismatch between the script file and the
    document.
    """
    text = json.dumps(value, indent=2, ensure_ascii=True, sort_keys=False)

    # Kill a </script> break-out from any admin-entered string. The
    # validator in the admin backend rejects "<" outright; this is the
    # second line of defence.
    text = text.replace("<", "\\u003c")
    # Valid in JSON, illegal in a pre-ES2019 JS string literal.
    text = text.replace("\u2028", "\\u2028").replace("\u2029", "\\u2029")

    for js_name in SHARED_LISTS.values():
        text = text.replace(_marker_json(js_name), js_name)

    lines = text.split("\n")
    return ("\n" + indent).join(lines)


_BANNER = (
    "/* GENERATED FILE - do not edit. Source: data/site.json.\n"
    "   Regenerate: python3 build/render_data_js.py (CI does this on every deploy). */\n"
)

# (json key, JS var name, exported as)
_VARS = [
    ("site", "SITE", "site"),
    ("menu", "MENU", "menu"),
    ("hero", "HERO", "hero"),
    ("categories", "CATEGORIES", "categories"),
    ("series", "SERIES", "series"),
    ("bedSizes", "BED_SIZES", None),  # shared list: declared, never exported
    ("products", "PRODUCTS", "products"),
    ("brands", "BRANDS", "brands"),
    ("clients", "CLIENTS", "clients"),
    ("footerLinks", "FOOTER_LINKS", "footerLinks"),
    ("demoUser", "DEMO_USER", "demoUser"),
]

_DEFAULTS = {"site": {}, "demoUser": {}}


def build_js(doc):
    """Render the whole document. Raises RenderError if the result looks wrong."""
    meta = doc.get("_meta") or {}
    out = [_BANNER]
    out.append(
        "/* rev %s | %s */\n" % (meta.get("rev", "?"), meta.get("updatedAt", "?"))
    )
    out.append("(function (window) {\n")
    out.append('  "use strict";\n\n')
    out.append(SLUG_JS)
    out.append("\n")

    for key, js_name, _exported in _VARS:
        value = doc.get(key, _DEFAULTS.get(key, []))
        if key == "products":
            value = _mark_shared_refs_in_products(
                value if isinstance(value, list) else []
            )
        out.append("  var %s = %s;\n" % (js_name, _emit(value)))

    out.append("\n  window.FC_DATA = {\n    slug: slug,\n")
    exported = [(js, name) for _k, js, name in _VARS if name]
    for i, (js_name, name) in enumerate(exported):
        tail = "" if i == len(exported) - 1 else ","
        out.append("    %s: %s%s\n" % (name, js_name, tail))
    out.append("  };\n")
    out.append("})(window);\n")

    text = "".join(out)
    sanity_check(text)
    return text


def sanity_check(text):
    """Refuse to write a file that cannot possibly work. Raises RenderError."""
    if "window.FC_DATA" not in text:
        raise RenderError("rendered data.js does not assign window.FC_DATA")
    if not text.rstrip().endswith("})(window);"):
        raise RenderError("rendered data.js does not close its IIFE")
    if len(text.encode("utf-8")) < 2000:
        raise RenderError(
            "rendered data.js is only %d bytes - the document looks empty"
            % len(text.encode("utf-8"))
        )
    if "function slug(str)" not in text:
        raise RenderError("rendered data.js is missing the slug() helper")
    if "_meta" in text.split("(function (window)", 1)[-1]:
        raise RenderError("_meta leaked into the rendered data.js")
    for _key, js_name, name in _VARS:
        if ("var %s =" % js_name) not in text:
            raise RenderError("rendered data.js is missing var %s" % js_name)
        if name and ("%s: %s" % (name, js_name)) not in text:
            raise RenderError("rendered data.js does not export %s" % name)
    try:
        text.encode("ascii")
    except UnicodeEncodeError as exc:
        raise RenderError("rendered data.js is not pure ASCII: %s" % exc) from None
    return True


def main():
    if not SITE_JSON.is_file():
        print(
            "no data/site.json -- nothing to build, leaving site/assets/js/data.js as-is",
            file=sys.stderr,
        )
        return 0
    doc = json.loads(SITE_JSON.read_text(encoding="utf-8"))
    try:
        text = build_js(doc)
    except RenderError as exc:
        print("BUILD FAILED: %s" % exc, file=sys.stderr)
        return 1
    DATA_JS.parent.mkdir(parents=True, exist_ok=True)
    # write_bytes, not write_text: on Windows, text mode silently turns every
    # "\n" into "\r\n", which would make this build non-reproducible between
    # a developer's machine and the Linux CI runner. Encode once and write
    # the exact bytes everywhere.
    DATA_JS.write_bytes(text.encode("ascii"))
    print("wrote %s (%d bytes)" % (DATA_JS, len(text.encode("ascii"))))
    return 0


if __name__ == "__main__":
    sys.exit(main())
