# The Furnist 365 — thefurnist365.com

Storefront for The Furnist 365 (Home, Office and Hospital Solution).
Hosted on `earth.wetechi.com` (HestiaCP), user `sumon`, docroot `public_html`.

## What is in this repository

| Path | What it is |
|---|---|
| `site/` | Exactly what gets served at https://thefurnist365.com/ — copied into `public_html/` on deploy |
| `data/site.json` | Single source of truth for site content (menu, products, prices, images, site info). Not deployed directly — `build/render_data_js.py` turns it into `site/assets/js/data.js`. |
| `build/render_data_js.py` | The build step. Runs automatically in CI before every deploy; also runnable locally (`python3 build/render_data_js.py`). |
| `docs/api-admin.md` | The admin API contract — every endpoint, request/response shape, and validation rule the admin panel implements. Language-agnostic; this is what any admin backend (the in-progress PHP one included) must match. |
| `deploy/known_hosts` | Pinned SSH host key of `earth.wetechi.com`, so CI refuses to talk to any other server |
| `.github/workflows/deploy.yml` | Deploy over SFTP: builds `data.js`, then mirrors `site/` to `public_html/` |

**Current state (2026-09-18):** `site/` matches the live site, now generated
from `data/site.json` rather than hand-maintained. **Do not hand-edit
`site/assets/js/data.js`** — it is generated, and the next build overwrites
it; edit `data/site.json` instead.

An admin/CMS panel (lets a non-developer edit products, prices, images and
the menu through a browser instead of editing `data/site.json` by hand)
exists and is fully built, but only as a **Python** backend so far — it runs
great on a developer's own machine, but this hosting account has no way to
run a persistent process, so it cannot go live here as-is. **A PHP port of
that same backend is in progress**, since PHP 8.3/PHP-FPM is available on
this account and needs no persistent process. It will land under
`site/admin/` (web-reachable, so PHP-FPM can serve it) with its runtime data
and admin credentials written to `private/` (outside `public_html/`, never
reachable by any URL) rather than committed to this repo. It has not been
pushed yet because it has not yet been through the same
review-and-security-audit pass as the Python version — that version found
and fixed a real critical vulnerability before it ever went live, so the
PHP port is getting the same treatment before it does either.

## How deploys happen

**Push to `main` that changes anything under `site/` deploys automatically.**
Edits to only the README, `deploy/` or the workflow file do not deploy.

To check before going live, or to restore the site from `main` at any time:

1. GitHub → **Actions** → **Deploy to thefurnist365.com** → **Run workflow**.
2. Leave **Dry run** ticked. The log lists every file that would be uploaded
   or deleted, and nothing on the server changes.
3. To force a full redeploy of `main`, run it again with **Dry run** unticked.

The deploy mirrors `site/` into `public_html/` **with `--delete`**: anything on
the server that is not in `site/` is removed. That is what makes a redeploy
restore the site exactly — and it means **files uploaded to the server by any
other route (File Manager, a separate pipeline) are deleted on the next
deploy.** This repository must be the only way files reach `public_html/`.

Suggested flow for bigger changes: work on a branch, open a pull request, run
the dry run if unsure, then merge to `main`.

## Server access rules

- **SFTP only** (port 22, account `sumon_deploy`, key authentication). FTP/FTPS
  is broken on this server by design — do not use it.
- After login you land in `/home/sumon/web/thefurnist365.com`. Upload into
  `public_html/` there (the workflow uses the absolute path
  `/home/sumon/web/thefurnist365.com/public_html/`). Files placed outside
  `public_html/` are not served.
- No shell access and no long-running processes. Dynamic features must be PHP
  (PHP 8.3 / PHP-FPM is available). Keep data files and credentials in the
  `private/` folder next to `public_html`, which PHP can reach and the web cannot.

## Repository secrets

| Secret | Value |
|---|---|
| `SSH_HOST` | `earth.wetechi.com` |
| `SSH_USER` | `sumon_deploy` |
| `SSH_PRIVATE_KEY` | CI-only ed25519 key `thefurnist365-website-ci` |
