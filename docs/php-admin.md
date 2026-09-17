# Furnist365 PHP admin — operations guide

Companion to `docs/php-admin-architecture.md` (the design) and
`docs/api-admin.md` (the frozen wire contract). This document is the "how
do I actually do X" reference for the PHP admin backend under
`private-src/` + `site/admin/api.php`.

---

## 1. Setting the admin password (no shell on production)

Production is SFTP-only shared hosting with no shell and no way to run an
interactive prompt. The password is therefore always set **locally**, then
uploaded once by hand:

1. On your own machine, from the repo root:

   ```
   php private-src/bin/admin-cli.php --set-admin-password
   ```

   You'll be prompted twice (input is not masked — PHP has no portable
   `getpass()` equivalent; this runs on your own machine, the same exposure
   as typing any other local secret). Minimum 10 characters.

   This writes `admin.json` **locally**, under whatever `FC365_PRIVATE_ROOT`
   currently resolves to (by default `.dev-private/admin.json` — see
   section 3). It does **not** touch production.

2. Upload that one file over SFTP, directly into:

   ```
   private/furnist365/admin.json
   ```

   on `earth.wetechi.com` (a sibling of `public_html/`, never inside it).

3. Restart nothing — PHP-FPM reads `admin.json` fresh on every request; there
   is no daemon to restart.

**Rotating the password later** repeats exactly these three steps. There is
no `POST /api/admin/change-password` endpoint — the frozen contract
(`docs/api-admin.md`) never defines one, since the already-built admin
frontend was never written to call one, and adding one would be scope creep
against "make PHP conform to the contract, never the reverse."

Until `admin.json` exists on the server, every `/api/admin/*` endpoint
except `POST /api/admin/bootstrap` answers `503 no_admin_password`.

---

## 2. How this deploys, end to end

### 2.1 The two-sync-step model

A push to `main` touching `site/**` runs `.github/workflows/deploy.yml`,
which now does **two** SFTP syncs against the same account, in this order:

1. **`private-src/` → `private/furnist365/`** (app code: `lib/`, `bin/`).
   `mirror --reverse`, **no `--delete`**. This directory also holds
   `site.json`, `admin.json`, `ratelimit.json`, `sessions/` and `backups/` —
   all server-authoritative runtime state this workflow must never see, let
   alone remove. Because the local source tree being mirrored
   (`private-src/`) contains only `lib/` and `bin/`, a non-delete mirror has
   no way to touch anything else in that directory even by accident — it can
   only create or update files under `private/furnist365/{lib,bin}/`.

2. **`site/` → `public_html/`** (everything web-reachable: the 11 storefront
   pages, their assets, and `admin/api.php` + the two `.htaccess` files).
   `mirror --reverse --delete`, same as before — **except** it now excludes
   two paths:

   ```
   assets/js/data.js
   assets/img/
   ```

   Both are **excluded from the delete-mirror**, not from the repo. See 2.2
   for why.

Both syncs reuse the exact same SSH key and pinned `known_hosts` already
prepared in the workflow — the second sync is one more `lftp mirror`
against a different remote path, not a new credential or a new trust
decision.

### 2.2 Why `data.js` and `assets/img/**` are excluded from the code sync

Once the admin panel is live, these two trees become **server-authoritative
forever**:

- `assets/js/data.js` is regenerated in place by every admin Save (and by
  `POST /api/admin/publish`). The repo's committed copy is frozen at
  whatever was true at go-live and is never touched by CI again.
- `assets/img/**` is where every admin-uploaded product/category/hero/etc.
  photo lands. Nobody commits these back to git.

`site/` → `public_html/` is a **delete-mirror**: without the exclude list,
the very next routine code deploy (e.g. a CSS fix) would silently revert
every live content edit back to the stale committed `data.js`, and delete
every image an admin has uploaded since the last commit. The exclude list is
what makes "ship a code change" and "the admin panel is live and being
edited" compatible at all. Do not remove it, and do not "clean up" the
repo's now-stale copies of `data.js`/`assets/img/**` later — they are a
deliberate historical snapshot, not drift.

### 2.3 What ships when

- **Code changes** (HTML/CSS/storefront JS, `admin/api.php`,
  `private-src/lib|bin`) deploy exactly as before: push to `main`, CI runs,
  live in ~30 seconds.
- **Content edits** (products, menu, site info, images) happen **only**
  through the live admin panel at `/admin/`, writing directly to
  `private/furnist365/site.json` on the server. They are never part of a git
  push and never touch this repository automatically.
- **`data/site.json`** (repo root) is downgraded, once live, to two manual
  roles: a local dev seed (section 3) and an occasional, human-triggered
  disaster-recovery snapshot (pull the live `site.json` over SFTP and commit
  it, periodically — never automated, see architecture section 2.5).

---

## 3. Local dev workflow

Local development never touches production and production never touches it.

1. Seed a local sandbox once:

   ```
   mkdir .dev-private
   ```

   (gitignored — see `.gitignore`). You do not need to manually copy
   `data/site.json` into it: the bootstrap flow (`admin/bootstrap.html`
   against the local PHP server) writes `.dev-private/site.json` for you the
   first time, the same way it always has. If you want to skip bootstrap
   during development, copy `data/site.json` to `.dev-private/site.json`
   by hand instead.

2. Run the built-in PHP server from the repo root, pointed at `site/`:

   ```
   php -S 127.0.0.1:5500 -t site
   ```

   `FC365_PUBLIC_ROOT` resolves to `site/` automatically (it's always
   `dirname(__DIR__)` from wherever `admin/api.php` actually is).
   `FC365_PRIVATE_ROOT` defaults to `<repo>/.dev-private` for both
   `site/admin/api.php` and `private-src/bin/admin-cli.php` — **no file
   needs editing** to get this default; it's the fallback when the
   `FC365_PRIVATE_ROOT` environment variable is unset.

3. To point either tool at a different local sandbox (e.g. to test against a
   downloaded copy of the real production `private/furnist365/`), set the
   environment variable before starting either one — never edit
   `config.php`, which has no hardcoded path to edit in the first place:

   ```
   FC365_PRIVATE_ROOT=/path/to/sandbox php -S 127.0.0.1:5500 -t site
   FC365_PRIVATE_ROOT=/path/to/sandbox php private-src/bin/admin-cli.php --check
   ```

4. Set a local admin password and open `http://127.0.0.1:5500/admin/`:

   ```
   php private-src/bin/admin-cli.php --set-admin-password
   ```

5. `php private-src/bin/admin-cli.php --check` validates whatever
   `site.json` your current `FC365_PRIVATE_ROOT` points at, without needing
   the web server running at all. `--rebuild` regenerates `data.js` from it
   the same way.

`data/site.json` and `.dev-private/` are never the same file and are never
synced automatically in either direction — see architecture section 2.5 for
why that's deliberate.

---

## 4. Known platform dependencies beyond the architecture doc's own list

`docs/php-admin-architecture.md` section 10.7 lists `ext-dom`/`ext-libxml`
(SVG sanitisation) and core `password_hash`/`flock`/`session_*` as this
design's only dependencies. Implementing `validate.php`'s "every string is
NFC-normalised" rule (`docs/api-admin.md` section 7) surfaced one more that
belongs in the same verification pass:

- **`ext-intl`** (the `Normalizer` class), for Unicode NFC folding. Not
  present on every PHP build. `validate.php`'s `fc365_norm()` checks
  `class_exists('Normalizer')` and degrades to trim-only (no NFC-fold) if
  it's missing, rather than fatal-erroring the whole request — but that is a
  narrow, real gap against the frozen contract's normalisation promise on a
  host that lacks it. Verify `intl` is loaded (`php -m`) during the same P-0
  host check that already verifies `dom`/`libxml`.

---

## 5. Residual risk carried over from the SVG scrubber

Both the Python and PHP versions scrub uploaded SVGs with a byte-level
blocklist (`<script`, `<foreignObject`, `<!ENTITY`, `javascript:`, `<use`,
`<handler`, `<set`, `on...=` attributes, off-origin `href`/`xlink:href`)
plus a well-formedness/root-element check. A blocklist is inherently
incomplete against a determined attacker crafting new SVG/XML tricks; the
mitigations that make this an acceptable residual risk are unchanged from
the Python design: SVG is only ever accepted into the `brand`/`brands`
folders (vendor/site logos, not arbitrary user content), and every `.svg`
response is served with `Content-Security-Policy: default-src 'none';
style-src 'unsafe-inline'` (configure this at the Apache/hosting layer for
static file responses, since PHP is not in the path for a plain static
`.svg` GET once uploaded).
