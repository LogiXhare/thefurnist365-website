# Furnist365 Admin API — frozen contract

Version 1 · base path `/api/admin` · implemented by `server/api.py`, dispatched from `serve.py`.

This document is the contract between the backend and the admin front end. It is derived from §5
and §7 of the approved architecture. Where this document and the architecture differ in wording,
**this document is what the server actually does**.

Everything below is stdlib-only Python on the server and plain `fetch()` on the client. No
framework, no build step.

### Amendments to the architecture, agreed 2026-09-16

Five findings from the UX designer's read of `data.js` changed the shape of the stored document.
They are folded into the rules below; this is the summary.

1. **`bedSizes` is an eleventh collection.** `data.js` today defines `var BED_SIZES` once and two
   products point at it *by reference*; `window.FC_DATA` never exports it. Inlining it, as the
   architecture said, would turn one shared list into N independent copies and silently destroy
   "edit bed sizes once, it changes everywhere". Instead `bedSizes` is a real top-level key in
   `data/site.json`, a real `var BED_SIZES = [...]` in the generated `data.js` (still not exported),
   and products point at it with the **shared-list reference** `"@bedSizes"` — see §7.1.
2. **`variable` is a display hint, never a price shape.** Unchanged from the architecture, now with
   the extra rule that `null`-valued keys are dropped before validation, so a product can never come
   to rest holding both `price` and `priceMin` (which would render a range on the card and charge
   the fixed price in the cart).
3. **`image` is `gallery[0]`.** Enforced, not assumed. See §7.2.
4. **`series[]` entries carry a `slug`.** Additive; `href` is untouched. `products[].series` is
   validated against `series[].slug`, and `GET /api/admin/meta` serves the list.
5. **Bengali content is first-class.** No validation rule restricts free text to ASCII. The
   generated `data.js` is emitted with `ensure_ascii=True`, so Bengali survives as `\uXXXX`
   escapes and cannot be corrupted by a charset mismatch. `tools/apicheck.py` proves the
   round trip with a real Bengali product name.

---

## 0. Ground rules

| | |
| --- | --- |
| Base | `/api/admin` |
| Request body | `application/json; charset=utf-8` — **including image upload** (base64 in a JSON string) |
| Response body | `application/json; charset=utf-8` on every response except `204` |
| Cookies | `credentials: "same-origin"` — the session cookie is `HttpOnly`, JS can never read it |
| Custom header | **`X-FC-Admin: 1` is required on every `/api/admin/*` request except `GET /api/admin/session`** |
| Caching | every response carries `Cache-Control: no-store, max-age=0` |
| CORS | none. No CORS headers are ever emitted. `OPTIONS` on `/api/*` returns **403**. |

### `X-FC-Admin`

The session cookie is `SameSite=Strict`, so a browser will not attach it to a cross-site request in
the first place. `X-FC-Admin` is the second layer: an HTML `<form>` from another origin cannot set a
custom header, and a cross-origin `fetch()` that tries triggers a CORS preflight, which this server
refuses.

The architecture's matrix marks the header as required "for mutations". **The server requires it on
every endpoint except `GET /api/admin/session`** — including the read endpoints, so that a
cross-origin page cannot read the catalogue either. `admin/assets/js/api.js` sends it on every
request, so this costs the front end nothing.

Missing or wrong header → **403** `{"error":"csrf_required"}`.

### `Origin`

If an `Origin` header is present, its `host:port` must equal the request's `Host`. Otherwise
**403** `{"error":"bad_origin"}`. A same-origin `fetch()` from `/admin/index.html` satisfies this
automatically; a plain same-origin `GET` may send no `Origin` at all, which is accepted.

### Error envelope

Every non-2xx response is exactly this shape:

```json
{
  "error": "validation_failed",
  "message": "Product price is invalid.",
  "fields": { "items/3/priceMin": "priceMin must be less than priceMax" }
}
```

* `error` — a stable machine token. Switch on this, never on `message`.
* `message` — one human sentence, safe to show in a toast.
* `fields` — present only on `400 validation_failed`. Keys are **JSON pointers relative to the
  request body**, e.g. `items/3/priceMin`, `item/options/Size/2`, `items/0/groups/1/items/4/href`.

### Status codes

| Code | Meaning |
| --- | --- |
| `200` | OK |
| `201` | Created (product create, image upload) |
| `204` | OK, no body (logout) |
| `400` | Malformed JSON, or validation failed (then `fields` is present) |
| `401` | No session, or the session expired |
| `403` | `X-FC-Admin` missing, `Origin` mismatch, `OPTIONS`, or a non-loopback bootstrap |
| `404` | Unknown collection, unknown product id, unknown image |
| `409` | Stale `rev`, or a delete blocked by references, or bootstrap when data already exists |
| `413` | Body larger than the cap (checked against `Content-Length` before the body is read) |
| `415` | Uploaded bytes are not a supported image |
| `429` | Login rate-limited. Carries `Retry-After: 300` |
| `500` | Bug. The save was aborted and `data/site.json` is unchanged. |
| `503` | No admin password configured, or `data/site.json` is unreadable |

Full list of `error` tokens:

`bad_origin`, `csrf_required`, `unauthorized`, `not_found`, `method_not_allowed`, `bad_json`,
`bad_request`, `validation_failed`, `stale_rev`, `in_use`, `id_immutable`, `duplicate_id`,
`too_large`, `bad_image`, `bad_folder`, `empty_file`, `bad_path`, `rate_limited`, `bad_password`,
`no_admin_password`, `store_unreadable`, `already_bootstrapped`, `not_loopback`, `render_failed`,
`internal_error`.

### `rev` — optimistic concurrency

`data/site.json` carries `_meta.rev`, an integer that increases by exactly 1 on every successful
write. Every mutating request must echo the `rev` the client last read. If it does not match the
current one the server changes nothing and answers:

```json
{ "error": "stale_rev", "rev": 42,
  "message": "Another tab saved since you loaded this. Reload before saving." }
```

with status **409**. `rev` in that body is the *current* server revision.

### Two failure modes the front end must handle globally

* **`503 no_admin_password`** — nobody has run `python serve.py --set-admin-password` yet. Every
  endpoint except `POST /api/admin/bootstrap` answers this. Show the "set a password" screen.
* **`503 store_unreadable`** — `data/site.json` is missing or does not parse. The server is in
  read-only mode: static files still serve, every data endpoint refuses. Show a blocking error.

---

## 1. Auth

### `GET /api/admin/session`

No session required. **The only endpoint that does not need `X-FC-Admin`.** This is how the admin
page decides whether to draw the login panel. It leaks nothing.

```http
GET /api/admin/session HTTP/1.1
```

```json
200 { "authenticated": false }
```

```json
200 { "authenticated": true, "expiresAt": "2026-09-16T20:03:44Z" }
```

`503 {"error":"no_admin_password","message":"run: python serve.py --set-admin-password"}` if
`data/admin.json` does not exist.

### `POST /api/admin/login`

No session required. `X-FC-Admin: 1` required. Rate-limited per peer IP.

```http
POST /api/admin/login HTTP/1.1
Content-Type: application/json
X-FC-Admin: 1

{ "password": "correct horse battery staple" }
```

```json
200 { "ok": true, "expiresAt": "2026-09-16T20:03:44Z" }
```
```
Set-Cookie: fc_admin=Yb3…; Path=/; HttpOnly; SameSite=Strict
```

`Secure` is appended to that cookie when the server was started with `--https`.

| Failure | |
| --- | --- |
| `400` | `{"error":"bad_request","message":"password is required."}` |
| `401` | `{"error":"bad_password","message":"That password is not correct."}` |
| `429` | `{"error":"rate_limited","message":"Too many failed attempts. Try again in 5 minutes."}` + `Retry-After: 300` |
| `503` | `{"error":"no_admin_password","message":"run: python serve.py --set-admin-password"}` |

**Rate limit:** 5 failures from one peer IP inside a sliding 5-minute window blocks further
attempts from that IP; `Retry-After` and the block window are both exactly 5 minutes
(`LOGIN_WINDOW == LOGIN_RETRY_AFTER` in `server/config.py`, deliberately kept equal), so waiting
out the advertised `Retry-After` always clears the block, not just usually. A successful login
clears the counter. The check, the pbkdf2 verify and the failure/success record all run under one
per-IP lock (`auth.login_lock`), so concurrent connections from the same peer cannot bypass the
counter or force multiple pbkdf2 verifications to run at once.

**Session lifetime:** 8 hours, slid forward on every authenticated request. Sessions live in server
memory only — restarting `serve.py` logs everyone out, and there is no session file on disk.

### `POST /api/admin/logout`

`X-FC-Admin: 1` required. A session is *not* required — logging out twice is not an error.

```json
204   (no body)
Set-Cookie: fc_admin=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0
```

### `GET /api/admin/meta`

Session required. Everything the admin UI needs to build its selects without hardcoding anything.

```json
200
{
  "rev": 41,
  "iconKeys": ["search","user","heart","cart","compare","caret","burger","close","phone","mail",
               "pin","pdf","store","eye","arrowUp","arrowLeft","arrowRight","whatsapp","facebook",
               "instagram","youtube","linkedin","box"],
  "imageFolders": ["product","category","hero","client","brands","brand"],
  "collections": ["site","menu","hero","categories","series","products","brands","clients",
                  "footerLinks","bedSizes","demoUser"],
  "seriesKeys": ["popular","premium","flagship"],
  "categorySlugs": ["living","bedroom","dining","office","interior","sofa-set"],
  "menuSlugs": ["premium","popular","living","bedroom","dining","office","institutional",
                "interior","more"],
  "brandSlugs": ["aurelio","northwood","…"],
  "sharedLists": { "bedSizes": ["Single","Semi-Double","Double","King"] },
  "limits": {
    "uploadBytes": 6291456, "maxGallery": 12, "maxOptions": 6, "maxSwatches": 8,
    "maxImagePx": 6000, "maxMenuTop": 12, "maxMenuGroups": 8, "maxMenuLinks": 20
  }
}
```

* `seriesKeys` is `series[].slug` — the only legal values for `products[].series`.
* `sharedLists` gives the live contents of every shared list, so the product editor can show
  "Bed sizes (shared): Single, Semi-Double, Double, King" instead of an opaque `@bedSizes`.
* `categorySlugs` **∪** `menuSlugs` is the set of legal values for `products[].category`. The UI
  should offer `categorySlugs` first; `menuSlugs` exist because the storefront accepts either.
* `iconKeys` is the key set of `ICONS` in `assets/js/components.js`. An icon outside it is a
  **warning**, not an error — the renderer falls back to `box`.

---

## 2. Read

### `GET /api/admin/data`

Session required. The whole document, including `_meta`.

```json
200
{
  "_meta": { "schema": 1, "rev": 41, "updatedAt": "2026-09-16T12:03:44Z" },
  "site": { "…": "…" },
  "menu": [],
  "hero": [],
  "categories": [],
  "series": [],
  "products": [],
  "brands": [],
  "clients": [],
  "footerLinks": [],
  "bedSizes": ["Single", "Semi-Double", "Double", "King"],
  "demoUser": { "…": "…" }
}
```

### `GET /api/admin/data/{collection}`

Session required. `{collection}` is a fixed whitelist — it is never reflected into a filesystem
path:

`site` · `menu` · `hero` · `categories` · `series` · `products` · `brands` · `clients` ·
`footerLinks` · `bedSizes` · `demoUser`

Array collections answer with `items`:

```http
GET /api/admin/data/categories
```
```json
200
{ "rev": 41,
  "items": [
    { "label": "Living Room", "slug": "living", "image": "assets/img/category/living-room.webp" },
    { "label": "Bed Room",    "slug": "bedroom", "image": "assets/img/category/bed-room.jpg" }
  ] }
```

The two singletons — `site` and `demoUser` — answer with `item`:

```http
GET /api/admin/data/site
```
```json
200
{ "rev": 41,
  "item": {
    "name": "The Furnist 365",
    "tagline": "Home, Office, and Hospital Solution",
    "legalName": "The Furnist 365",
    "year": "2026",
    "currency": "৳",
    "phone": "01600144705",
    "phoneIntl": "+8801600144705",
    "whatsapp": "8801600144705",
    "email": "info@furnish365.com",
    "office": {
      "label": "Our Office",
      "street": "House 30, Road 7, Sector 14",
      "floor": "6th Floor, Flat 2A",
      "area": "Uttara, Dhaka-1230",
      "address": "House 30, Road 7, Sector 14, Uttara, Dhaka-1230",
      "hotline": "01600144705",
      "email": "info@furnish365.com"
    },
    "socials": [ { "label": "Facebook", "href": "#", "icon": "facebook" } ]
  } }
```

`404 {"error":"not_found","message":"Unknown collection 'widgets'."}` on anything else.

---

## 3. Write

**The primitive is a whole-collection `PUT` with optimistic concurrency.** There is no reorder
endpoint and no bulk-delete endpoint: reordering is "PUT the array in a different order", deleting
is "PUT the array without that element". One code path, one validator.

### `PUT /api/admin/data/{collection}`

Session + `X-FC-Admin: 1`.

```http
PUT /api/admin/data/categories HTTP/1.1
Content-Type: application/json
X-FC-Admin: 1

{ "rev": 41,
  "items": [
    { "label": "Living Room", "slug": "living",  "image": "assets/img/category/living-room.webp" },
    { "label": "Bed Room",    "slug": "bedroom", "image": "assets/img/category/bed-room.jpg" }
  ] }
```

For `site` and `demoUser` send `item` instead of `items`:

```json
{ "rev": 41, "item": { "name": "The Furnist 365", "…": "…" } }
```

```json
200
{ "ok": true, "rev": 42,
  "warnings": ["products[10] 'bwd-513-lq' references brand 'amarante', which is not in brands"] }
```

`warnings` is always present and may be empty. Warnings never block a save.

| Failure | |
| --- | --- |
| `400` | `{"error":"bad_request","message":"Body must contain 'items' (an array)."}` |
| `400` | `{"error":"validation_failed","message":"…","fields":{"items/3/priceMin":"…"}}` |
| `404` | unknown collection |
| `409` | `{"error":"stale_rev","rev":42,"message":"…"}` |
| `409` | `{"error":"in_use","message":"…","referencedBy":["tds-514r-lq"],"kind":"category","values":["bedroom"]}` |
| `413` | body over 2 MiB |

### Referential integrity — enforced on every write

| Situation | Result |
| --- | --- |
| a `categories` PUT drops a slug that ≥1 product uses as `category` | **409 `in_use`**, unless `?force=1` |
| a `menu` PUT drops a top-level slug that ≥1 product uses as `category` | **409 `in_use`**, unless `?force=1` |
| a `series` PUT drops a `slug` that ≥1 product uses | **409 `in_use`**, unless `?force=1` |
| a `bedSizes` PUT empties the list while ≥1 product references `@bedSizes` | **409 `in_use`**, unless `?force=1` |
| a `brands` PUT drops a slug that ≥1 product uses | **200 + `warnings`** — `product.js` tolerates an unknown brand slug and degrades cleanly |
| a `products` write names a `category` / `series` that does not exist | **400** `fields` names the exact index |
| any `image` / `logo` / `gallery` path that does not exist on disk | **400** `fields` names the exact index |
| duplicate `products[].id` | **400** |
| two top-level menu labels that `slug()` identically | **400** — `components.js` writes `data-nav="<slug>"` and the active-nav query would match two items |

`?force=1` turns the `in_use` **409** into a **200** whose `warnings` list the products left
dangling. Use it only behind an explicit confirmation in the UI.

The `409 in_use` body:

```json
409
{ "error": "in_use",
  "message": "2 products still use category 'bedroom'. Add ?force=1 to save anyway.",
  "kind": "category",
  "values": ["bedroom"],
  "referencedBy": ["tds-514r-lq", "wrd-514r-lq"] }
```

### Product item routes

The product editor is a single-record form and deletion needs a reference sweep, so products get
three extra routes on top of `PUT /api/admin/data/products`.

#### `POST /api/admin/data/products`

```http
POST /api/admin/data/products
X-FC-Admin: 1

{ "rev": 41, "index": 0,
  "item": {
    "id": "bwd-515-lq",
    "sku": "BWD-515-LQ",
    "name": "Bed (BWD-515-LQ)",
    "category": "bedroom",
    "categoryLabel": "Bedroom",
    "sub": "bed",
    "series": "popular",
    "brand": "amarante",
    "priceMin": 27000,
    "priceMax": 36500,
    "variable": true,
    "badge": "New",
    "image": "assets/img/product/bwd-513.jpg",
    "gallery": ["assets/img/product/bwd-513.jpg"],
    "options": { "Size": ["Single", "Semi-Double", "Double", "King"] },
    "swatches": ["Single", "Semi-Double", "Double", "King"],
    "short": "Panel bed with an upholstered headboard.",
    "material": "Engineered wood with lacquer finish",
    "dimensions": "Single / Semi-Double / Double / King",
    "warranty": "1 year manufacturing warranty"
  } }
```

`index` is optional; omit it to append.

```json
201 { "ok": true, "rev": 42, "id": "bwd-515-lq", "warnings": [] }
```

`400 {"error":"duplicate_id","message":"A product with id 'bwd-515-lq' already exists."}`

#### `PUT /api/admin/data/products/{id}`

```json
{ "rev": 41, "item": { "id": "bwd-515-lq", "…": "…" } }
```
```json
200 { "ok": true, "rev": 42, "id": "bwd-515-lq", "warnings": [] }
```

`item.id` must equal `{id}` in the path. **`id` is immutable after create** — it is the
`product.html?id=` URL key and the `localStorage` cart / wishlist key. Mismatch →

`400 {"error":"id_immutable","message":"A product id cannot be changed after it is created."}`

`404` if `{id}` does not exist.

#### `DELETE /api/admin/data/products/{id}?rev=41`

`rev` travels in the query string because a `DELETE` body is awkward in `fetch()`.

```json
200
{ "ok": true, "rev": 42,
  "orphanedImages": ["assets/img/product/bwd-515.jpg"],
  "warnings": [] }
```

Images referenced only by the deleted product are **reported, never deleted**. Delete them
deliberately with `DELETE /api/admin/images`.

`404` unknown id · `409` stale rev.

### Menu

The menu is edited as a whole tree with one `PUT /api/admin/data/menu`. It is ~9 top-level nodes,
~40 groups and ~120 links — about 15 KB of JSON. There is no path-addressing DSL for it.

**Depth is fixed at exactly three: item → group → link.** Anything deeper is a `400`.

```json
{ "rev": 41,
  "items": [
    { "label": "Premium",
      "href": "shop.html?cat=premium",
      "cols": 2,
      "alignRight": false,
      "groups": [
        { "title": "Premium",
          "items": [
            { "label": "Premium Bed",
              "href": "shop.html?cat=premium&sub=premium-bed" }
          ] }
      ],
      "promo": { "title": "Premium Series",
                 "text": "Crafted for elevated living.",
                 "href": "shop.html?series=premium",
                 "image": "assets/img/category/series-premium.jpeg" } }
  ] }
```

`links()` / `group()` no longer exist — the tree editor sends fully expanded objects, and the
server writes them out verbatim.

---

## 4. Images

### `POST /api/admin/upload`

Session + `X-FC-Admin: 1`. **Base64 inside JSON, not `multipart/form-data`** — `cgi.FieldStorage`
is gone in Python 3.13, so stdlib-only multipart would mean hand-writing a streaming boundary
parser.

Client side is four lines:

```js
const reader = new FileReader();
reader.onload = () => post("/api/admin/upload", {
  folder: "product",
  filename: file.name,
  data: String(reader.result).split(",")[1]   // strip the "data:image/jpeg;base64," prefix
});
reader.readAsDataURL(file);
```

```http
POST /api/admin/upload
X-FC-Admin: 1

{ "folder": "product", "filename": "Sofa Set 7010.JPG", "data": "/9j/4AAQSkZJRgABAQ…" }
```

```json
201
{ "ok": true,
  "path": "assets/img/product/sofa-set-7010.jpg",
  "bytes": 184203,
  "width": 1200,
  "height": 1200 }
```

Write the returned `path` — not the filename you sent — into the data field.

| `folder` | Directory | Used by |
| --- | --- | --- |
| `product` | `assets/img/product/` | `products[].image`, `products[].gallery[]` |
| `category` | `assets/img/category/` | `categories[].image`, `series[].image`, `menu[].promo.image` |
| `hero` | `assets/img/hero/` | `hero[].image` |
| `client` | `assets/img/client/` | `clients[].image` |
| `brands` | `assets/img/brands/` | `brands[].logo` — vendor wordmarks, SVG |
| `brand` | `assets/img/brand/` | the site's own logo / favicon / payments strip |

**`brand/` and `brands/` are different directories.** The lookup is a dict, never string
concatenation.

Rules, in the order the server applies them:

1. `Content-Length` > 8 MiB → **413**, *before the body is read*.
2. `folder` not in the dict → **400 `bad_folder`**.
3. Base64 strict-decoded. Empty → **400 `empty_file`**. Decoded > 6 MiB → **413 `too_large`**.
4. **Magic-byte sniff.** JPEG `FF D8 FF`, PNG `89 50 4E 47 0D 0A 1A 0A`, GIF `GIF87a`/`GIF89a`,
   WEBP `RIFF ???? WEBP`, SVG `<svg`/`<?xml`. Unrecognised → **415 `bad_image`**. If the filename
   you sent carries a known image extension it must agree with the sniff, or **415**.
5. **SVG** is accepted only into `brands` and `brand`, and only if it parses as XML with an `<svg>`
   root and contains none of `<script`, `<foreignObject`, `<!ENTITY`, `javascript:`, an `on…=`
   event attribute, or an `xlink:href` / `href` pointing off-origin. Otherwise **415**.
   `.svg` files are additionally served with
   `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'`.
6. Dimensions are read from the header bytes. Either axis > 6000 px → **415 `bad_image`**.
   SVG returns `"width": null, "height": null`.
7. **The filename you send is never used as a filename.** The server derives
   `slug(basename)[:60]` restricted to `[a-z0-9-]` (empty → `img`) and appends the extension implied
   by the *sniffed* type. A collision appends `-2`, `-3`, …
8. At most 2 uploads run concurrently; a third waits.

| Failure | |
| --- | --- |
| `400` | `{"error":"bad_folder","message":"Unknown image folder 'sofas'."}` |
| `400` | `{"error":"empty_file","message":"The uploaded file is empty."}` |
| `400` | `{"error":"bad_request","message":"'data' must be base64."}` |
| `413` | `{"error":"too_large","message":"…","limit":6291456}` |
| `415` | `{"error":"bad_image","message":"File content is not a valid JPEG/PNG/WEBP/GIF."}` |

### `GET /api/admin/images?folder=product`

Session required. Powers the "choose existing" picker.

```json
200
{ "folder": "product",
  "items": [
    { "path": "assets/img/product/bwd-513.jpg",
      "bytes": 98213,
      "mtime": "2026-09-10T09:14:02Z",
      "usedBy": ["product:bwd-513-lq"] }
  ] }
```

`usedBy` entries are `"<kind>:<key>"` — `product:<id>`, `category:<slug>`, `series:<index>`,
`hero:<index>`, `client:<name>`, `brand:<slug>`, `menu:<top-level slug>`. An empty `usedBy` means
the file is safe to delete.

`400 {"error":"bad_folder"}` on an unknown folder.

### `DELETE /api/admin/images?path=assets/img/product/x.jpg`

Session + `X-FC-Admin: 1`.

```json
200 { "ok": true, "path": "assets/img/product/x.jpg" }
```

| Failure | |
| --- | --- |
| `400` | `{"error":"bad_path","message":"…"}` — the path is not inside `assets/img/<whitelisted folder>/` |
| `404` | `{"error":"not_found"}` |
| `409` | `{"error":"in_use","message":"…","usedBy":["product:bwd-513-lq"]}` |

---

## 5. Maintenance

### `POST /api/admin/publish`

Session + `X-FC-Admin: 1`. Body may be empty (`{}`). Re-derives `assets/js/data.js` from
`data/site.json` without touching the JSON or the `rev`. This is the repair button for the
"new JSON, stale JS" crash window.

```json
200 { "ok": true, "bytes": 28414, "rev": 42 }
```

### `GET /api/admin/backups`

Session required. Newest first, at most 50 are kept.

```json
200
{ "items": [
    { "file": "site-20260916-140233.json", "bytes": 27918, "at": "2026-09-16T14:02:33Z" },
    { "file": "site-20260916-135501.json", "bytes": 27901, "at": "2026-09-16T13:55:01Z" }
  ] }
```

### `POST /api/admin/restore`

Session + `X-FC-Admin: 1`.

```json
{ "file": "site-20260916-140233.json" }
```
```json
200 { "ok": true, "rev": 43, "warnings": [] }
```

The filename is matched against the listing above — it is **never joined from user input**. A fresh
backup of the current state is taken before the swap, so a restore is itself undoable.

`404 {"error":"not_found","message":"No such backup."}`
`400 validation_failed` if the backup no longer validates — for instance because an image it
references has since been deleted from disk.

---

## 6. Bootstrap — one shot, Phase 1 only

### `POST /api/admin/bootstrap`

**No session.** `X-FC-Admin: 1` required. Accepted **only** when

* `data/site.json` does **not** exist, **and**
* the peer address is loopback (`127.0.0.1` / `::1`).

It is also the one endpoint that still works before `python serve.py --set-admin-password` has been
run — Phase 1 happens before auth exists.

```http
POST /api/admin/bootstrap
X-FC-Admin: 1

{ "data": { "site": {…}, "menu": [...], "hero": [...], "categories": [...], "series": [...],
            "products": [...], "brands": [...], "clients": [...], "footerLinks": [...],
            "demoUser": {…} } }
```

`data` is literally `JSON.parse(JSON.stringify(window.FC_DATA))` from `admin/bootstrap.html`.
`JSON.stringify` drops `slug` because it is a function, which is exactly right — the key set must
be **exactly** those ten names. This uses the browser as the JS engine so the seed is byte-faithful
to the hand-written `data.js`, with zero transcription risk.

**Bootstrap normalisation.** `JSON.stringify` has already flattened two things that the source file
kept structured, so the server rebuilds them once, deterministically, and reports what it did:

1. **Shared lists.** The value of `swatches` on the first product that has one becomes
   `doc["bedSizes"]`. Every array anywhere in `products[].swatches` or `products[].options[*]` that
   is deep-equal to it is replaced with `"@bedSizes"`. This is lossless by construction — the
   renderer expands the reference back to the identical list. No product with swatches → `bedSizes`
   is seeded `[]`.
2. **Series slugs.** Each `series[i].slug` is derived from `?series=(\w+)` in that entry's `href`,
   falling back to `slug(eyebrow)` then `slug(title)`. `href` itself is left byte-identical.

```json
200
{ "ok": true, "rev": 1, "warnings": [],
  "normalised": { "bedSizes": ["Single","Semi-Double","Double","King"],
                  "sharedListRefs": 4,
                  "seriesSlugs": ["popular","premium","flagship"] } }
```

| Failure | |
| --- | --- |
| `403` | `{"error":"not_loopback"}` |
| `409` | `{"error":"already_bootstrapped","message":"data/site.json already exists."}` |
| `400` | `{"error":"bad_request","message":"Unexpected keys: foo. Missing keys: clients."}` |
| `400` | `validation_failed` with `fields` keyed under `data/…` |

---

## 7. Validation rules

These are the rules `server/validate.py` enforces. The admin UI should mirror them for a fast
error, but **the server is the authority** and will reject anything the UI lets through.

### Global — applied to every string in the document

* **No `<` and no `>` in any field.** This is the load-bearing rule. Every renderer in this codebase
  concatenates data straight into `innerHTML` with no escaping — `components.js:productCard`,
  `home.js`, `shop.js`, `product.js`, `pages.js`, `cart-page.js`. Today that is safe because a
  developer writes `data.js`; the moment an admin form can write it, `<img src=x onerror=…>` in a
  product name is stored XSS for every visitor. The cost is that a name like `L-shape <3` cannot be
  expressed. Error: `"< and > are not allowed"`.
* **No C0 control characters** (`U+0000`–`U+001F`) and no `U+007F`, anywhere. `data.js` is generated
  with `ensure_ascii=True`, and the renderer relies on control characters being impossible in real
  content to place its shared-list markers safely (§7.1).
* Every string is **NFC-normalised and `.strip()`ed** before it is stored. What you PUT is not
  always byte-identical to what a later GET returns.
* **Non-ASCII text is fully supported and is never rejected.** `৳`, typographic apostrophes and
  Bengali content in any free-text field are fine; length limits count *characters*, not bytes. Only
  the structured fields with an explicit regex — `id`, `slug`, `sku`, `sub`, `year`, the phone
  numbers, `href` and image paths — are restricted to ASCII, because the storefront uses them to
  build URLs, DOM ids and CSS selectors.
* **Unknown keys are rejected**, per entity — default deny. A field added later cannot slip past the
  `<>` rule by being unvalidated. Error: `"unknown field 'foo'"`.
* Numbers must be real numbers. A JSON boolean is never accepted where a number is expected.

### `href`

≤ 300 characters, no control characters, and it must match one of:

| Form | Example |
| --- | --- |
| relative page | `shop.html`, `shop.html?cat=premium&sub=bed`, `contact.html#showroom` |
| bare anchor | `#`, `#showroom` |
| telephone | `tel:+8801600144705` |
| mail | `mailto:info@furnish365.com` |
| absolute | `https://wa.me/8801600144705`, `http://example.com/x` |

`javascript:`, `data:`, `vbscript:` and anything else are rejected outright.

### `image` / `logo` / `gallery[]`

Must match

```
^assets/img/(brand|brands|hero|category|product|client)/[a-z0-9._-]+\.(jpg|jpeg|png|webp|gif|svg)$
```

**and the file must exist on disk.** No `..`, no absolute path, no URL, no backslash, no space, no
quote, no `)`. The last three matter because `menu[].promo.image` is interpolated into an inline CSS
`url(...)` in `components.js:megaHTML`.

### `products[]`

| Field | Rule |
| --- | --- |
| `id` | required · `^[a-z0-9][a-z0-9-]{1,63}$` · unique · **immutable after create** |
| `name` | required · 2–120 |
| `sku` | required · 1–40 · `^[A-Za-z0-9./ -]+$` |
| `category` | required · a `categories[].slug` **or** a `slug(menu[i].label)` |
| `categoryLabel` | required · 1–40 |
| `sub` | optional · `^[a-z0-9-]{1,60}$` |
| `series` | optional · one of `series[].slug` (served by `GET /api/admin/meta` as `seriesKeys`) |
| `brand` | optional · should be a `brands[].slug` → **warning**, not an error |
| `price` / `priceMin` / `priceMax` | **exactly one shape**: `price` alone, **or** `priceMin` and `priceMax` together. Sending `price` with `priceMin` → 400. Each `0 < v ≤ 100000000`, and `priceMin < priceMax`. This mirrors `components.js:priceHTML`, which keys purely off `priceMin != null && priceMax != null`. |
| `variable` | boolean · **display hint only**. It drives the "multiple variants" note, not the price shape. The shipped data has `variable:true` on single-price items and that is legal — do not "fix" it. |
| `image` | required · path rule · **must equal `gallery[0]` whenever `gallery` is present** (§7.2) |
| `gallery` | optional · 1–12 paths · `gallery[0]` is the main image. Absent → `product.js` falls back to `[image]`. |
| `badge` | optional · ≤ 12 |
| `options` | object · ≤ 6 keys · key 1–24 matching `^[A-Za-z][A-Za-z0-9 ]*$` · `slug(key)` non-empty and unique (`product.js` builds `id="opt-"+slug(key)`) · value = 1–20 strings of 1–40, **or** a shared-list reference (§7.1) |
| `swatches` | optional · ≤ 8 strings, **or** a shared-list reference (§7.1) · **each value must also appear in one of `options`' value arrays** — `shop.js` filters bed sizes against `swatches` while `product.js` renders the select from `options`; a mismatch silently makes a product unfilterable |
| `short` / `material` / `dimensions` / `warranty` | optional · ≤ 600 / 200 / 120 / 120 |

**Null-dropping.** Before anything else, the server deletes every product key whose value is `null`,
and deletes `price` / `priceMin` / `priceMax` whose value is `null` or `""`. The form can therefore
send all three price inputs every time and let the server keep only the pair that is filled in. The
consequence is the important one: **a product can never come to rest holding both `price` and
`priceMin`.** That combination renders a price *range* on the card (`components.js:73`) while the
cart charges the fixed `price` (`cart.js:51`) — a silent mispricing.

### 7.1 Shared lists — `@bedSizes`

`assets/js/data.js` declares `var BED_SIZES = ["Single","Semi-Double","Double","King"]` once, and
`bwd-513-lq` and `bwd-514r-lq` both point at *that same array object* for `swatches` and for
`options.Size`. `BED_SIZES` is deliberately **not** exported on `window.FC_DATA`.

Flattening it into four independent copies would work today and break the owner's mental model
tomorrow: renaming "Semi-Double" would have to be done four times, with no error if you missed one.

So `data/site.json` keeps it as a top-level array, and products point at it with a string:

```json
"bedSizes": ["Single", "Semi-Double", "Double", "King"],

"products": [
  { "id": "bwd-513-lq",
    "swatches": "@bedSizes",
    "options": { "Size": "@bedSizes" } }
]
```

* A shared-list reference is the **whole value** in a place where an array is expected —
  `products[].swatches` and any `products[].options[key]`. It is never an element inside an array,
  so it can never be confused with a real option value.
* `@bedSizes` is the only reference that exists. Anything else starting with `@` in those positions
  is `400 validation_failed`.
* `server/render.py` expands it back to the bare JavaScript identifier `BED_SIZES`, so the
  generated file reproduces today's sharing exactly:

  ```js
  var BED_SIZES = ["Single", "Semi-Double", "Double", "King"];
  var PRODUCTS = [ { "id": "bwd-513-lq", "swatches": BED_SIZES, "options": { "Size": BED_SIZES } } ];
  ```
* For every other rule — `swatches` ⊆ `options` values, lengths, the `<>` ban — the reference is
  resolved first and the resolved list is validated.
* Edit the list itself with `PUT /api/admin/data/bedSizes`, body `{"rev":41,"items":["Single","…"]}`.
  0–20 entries, each 1–40 characters. Emptying it while a product still references it is a
  `409 in_use` unless `?force=1`.

`GET /api/admin/data/products` returns the reference **unresolved** (`"swatches": "@bedSizes"`), so
a read-modify-write round trip preserves the sharing. `GET /api/admin/meta` carries `sharedLists`
so the UI can display the contents.

### 7.2 `image` and `gallery[0]`

Every product shipped in `data.js` has `image === gallery[0]`. The admin UI presents one gallery
strip with the first tile badged MAIN, so the server makes that relationship a rule rather than a
coincidence:

* `gallery` present and non-empty, `image` absent → the server sets `image = gallery[0]`.
* `gallery` present and non-empty, `image` present but different → `400`, `fields` =
  `{"item/image": "image must equal gallery[0] (the main image)"}`.
* `gallery` absent → `image` stands alone; `product.js` falls back to `[image]`.

Reordering the gallery therefore *is* changing the main image, which is what the strip's drag
handle means.

### `menu[]`

* Top-level count ≤ 12. `slug(label)` unique across the top level.
* node: `label` 1–24 (nav-bar width) · `href` · `cols` int 1–4 (feeds `--fc-mega-cols`) ·
  `alignRight` bool · `groups` 0–8 · `promo` optional.
* group: `title` 1–40 · `items` 0–20 links.
* link: `label` 1–60 · `href`.
* promo: `title` ≤ 40 · `text` ≤ 80 · `href` · `image`.
* Depth is exactly 3. A link that itself carries `items` or `groups` is a `400`.

> The caps of 12 top-level items, 8 groups and 20 links per group are read off the CSS, not
> measured. Confirm with the designer before shipping.

### The rest

| Entity | Rules |
| --- | --- |
| `categories[]` | `label` 1–40 · `slug` `^[a-z0-9-]{1,40}$` unique · `image` required · count 1–40 |
| `series[]` | **`slug` required** `^[a-z0-9-]{1,40}$` unique · `eyebrow` ≤ 40 · `title` ≤ 80 · `text` ≤ 200 · `cta` ≤ 40 · `href` · `image` · count 1–6 |
| `bedSizes[]` | 0–20 strings of 1–40 — the shared list of §7.1 |
| `hero[]` | `title` ≤ 60 · `text` ≤ 120 · `cta` ≤ 24 · `href` · `image` · `align` ∈ `left\|center\|right` · count 1–8 |
| `brands[]` | `name` 1–40 · `slug` `^[a-z0-9-]+$` unique · `category` (warning if unknown) · `categoryLabel` ≤ 40 · `logo` · count ≤ 200 |
| `clients[]` | `name` 1–60 · `image` · count 1–200 |
| `footerLinks[]` | 1–4 columns (the footer grid) · `title` ≤ 40 · `items` 1–12 of `{label ≤ 60, href}` |
| `demoUser` | `email` · `password` 4–100 · `name` 1–60. Stays in `data.js` in plain text — that is existing, documented, intentional demo behaviour. The **admin** password never appears there. |
| `site` | `name` 1–60 · `tagline` ≤ 120 · `legalName` ≤ 60 · `year` `^\d{4}$` · `currency` 1–3 · `phone` `^0\d{9,10}$` · `phoneIntl` `^\+?\d{10,15}$` · `whatsapp` `^\d{10,15}$` · `email` · `office.{label,street,floor,area,address,hotline,email}` each ≤ 160 · `socials` ≤ 6 of `{label ≤ 24, href, icon}`, where an `icon` outside `iconKeys` is a **warning** |

---

## 8. What the server does on a successful write

In this order, all of it under one lock:

1. `validate.validate_document(doc)` — the **whole** document, not the delta. A failure raises
   before anything on disk is touched.
2. `json.dumps(...)` then `json.loads(...)` of the result as a self-check.
3. `render.build_js(doc)` **plus its sanity check** — before anything is written, so a render bug
   cannot leave a good JSON next to a broken JS.
4. Copy the current `data/site.json` to `data/backups/site-YYYYmmdd-HHMMSS.json` (UTC). Prune to the
   newest 50.
5. `data/tmp/…` → `flush()` → `os.fsync()` → `os.replace()` onto `data/site.json`.
6. The same tmp → fsync → replace for `assets/js/data.js`.
7. If step 6 raises, `data/site.json` is restored from the step-4 backup and the request answers
   **500**.

**JSON first, JS second, deliberately.** The only crash window leaves *new JSON, stale JS* — the
storefront keeps rendering the previous, complete content. It is never half-rendered and never
blank. `POST /api/admin/publish` repairs it.

`assets/js/data.js` is therefore a **generated file**. Hand-editing it loses the edit at the next
save. `admin/*` must never load it — the admin panel reads the authoritative JSON from this API.
