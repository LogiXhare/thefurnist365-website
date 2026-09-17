# The Furnist 365 — thefurnist365.com

Storefront for The Furnist 365 (Home, Office and Hospital Solution).
Hosted on `earth.wetechi.com` (HestiaCP), user `sumon`, docroot `public_html`.

## What is in this repository

| Path | What it is |
|---|---|
| `site/` | Exactly what gets served at https://thefurnist365.com/ — copied into `public_html/` on deploy |
| `deploy/known_hosts` | Pinned SSH host key of `earth.wetechi.com`, so CI refuses to talk to any other server |
| `.github/workflows/deploy.yml` | Manual deploy over SFTP |

**Current state:** `site/` is a snapshot of the live site taken on 17 Sep 2026
(132 files). The editable source — `data/site.json`, the build step that
generates `site/assets/js/data.js`, and the admin panel — is not here yet and
will be added by the developer. Until then, do not hand-edit
`site/assets/js/data.js`: it is generated, and the next admin publish
overwrites it.

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
