/* ==========================================================================
   api.js — the only place that talks to the server.

   Contract: docs/api-admin.md (frozen). Everything here mirrors it:
     - application/json in and out, including image upload (base64 in JSON)
     - credentials: "same-origin" (the session cookie is HttpOnly)
     - X-FC-Admin: 1 on every request except GET /api/admin/session
     - _meta.rev echoed on every mutating request (optimistic concurrency)

   This file holds NO DOM. It raises ApiError and lets the shell decide what
   to paint; the four blocking conditions (401, 403, 503 no_admin_password,
   503 store_unreadable) are routed through FCA.api.handlers, which app.js
   fills in.

   admin/** must never load assets/js/data.js — that file is GENERATED from
   data/site.json, and the panel reads the authoritative JSON from this API.
   ========================================================================== */

(function (window) {
  "use strict";

  var BASE = "/api/admin";

  /* The admin lives at /admin/, the image paths the API returns are relative
     to the site root ("assets/img/product/x.jpg"), so every src needs one
     level up. Centralised because getting it wrong shows as a broken image
     on every screen at once. */
  function assetURL(path) {
    if (!path) return "";
    if (/^(https?:)?\/\//.test(path) || path.charAt(0) === "/") return path;
    return "../" + path;
  }

  /* ---------------- errors ---------------- */

  /* Every non-2xx answer is { error, message, fields? }. `error` is the
     stable token to switch on; `message` is one human sentence written for
     the owner, so it is shown verbatim. */
  function ApiError(status, body, fallback) {
    this.name = "ApiError";
    this.status = status;
    this.body = body || {};
    this.code = this.body.error || fallback || "internal_error";
    this.message = this.body.message || defaultMessage(status, this.code);
    this.fields = this.body.fields || null;
  }
  ApiError.prototype = Object.create(Error.prototype);
  ApiError.prototype.constructor = ApiError;

  function defaultMessage(status, code) {
    switch (code) {
      case "network":
        return "The server did not answer. Check that it is running.";
      case "csrf_required":
        return "This page is out of date. Reload it and try again.";
      case "unauthorized":
        return "Your session ended. Sign in again.";
      case "stale_rev":
        return "Another tab saved since you loaded this. Reload before saving.";
      case "too_large":
        return "That file is too large to upload.";
      case "no_admin_password":
        return "No admin password is set yet. Run: python serve.py --set-admin-password";
      case "store_unreadable":
        return "The content file cannot be read, so nothing can be saved right now.";
      default:
        return "Something went wrong (HTTP " + status + ").";
    }
  }

  /* ---------------- transport ---------------- */

  var handlers = {
    /* app.js fills these in. Each may return a promise. */
    reauth: null,          /* 401 → re-authenticate in place, resolve(true) to retry */
    forbidden: null,       /* 403 → the page is stale, hard reload */
    noPassword: null,      /* 503 no_admin_password */
    storeUnreadable: null, /* 503 store_unreadable */
    revChanged: null       /* every response that carries a rev */
  };

  var state = { rev: null, meta: null };

  function noteRev(body) {
    if (!body || typeof body !== "object") return;
    var rev = body.rev;
    if (rev == null && body._meta) rev = body._meta.rev;
    if (typeof rev === "number") {
      var changed = state.rev !== rev;
      state.rev = rev;
      if (changed && handlers.revChanged) handlers.revChanged(rev);
    }
  }

  function parse(res) {
    if (res.status === 204) return Promise.resolve({});
    return res.text().then(function (text) {
      if (!text) return {};
      try {
        return JSON.parse(text);
      } catch (e) {
        /* A non-JSON body from an endpoint that promises JSON means the
           request never reached the API layer (a 404 from the static file
           handler, a proxy page). Say so plainly. */
        return { error: "bad_json", message: "The server sent a reply this page could not read." };
      }
    });
  }

  /* One attempt. `retryOn401` is false on the retry itself so a broken
     session can never loop. */
  function attempt(method, path, options, retryOn401) {
    options = options || {};
    var init = {
      method: method,
      credentials: "same-origin",
      headers: { Accept: "application/json" },
      cache: "no-store"
    };
    /* GET /api/admin/session is the single endpoint that must NOT carry the
       header — it is the pre-session probe. */
    if (!options.noCsrf) init.headers["X-FC-Admin"] = "1";
    if (options.body !== undefined) {
      init.headers["Content-Type"] = "application/json; charset=utf-8";
      init.body = JSON.stringify(options.body);
    }

    return fetch(BASE + path, init)
      .catch(function () {
        throw new ApiError(0, { error: "network" }, "network");
      })
      .then(function (res) {
        return parse(res).then(function (body) {
          if (res.ok) {
            noteRev(body);
            return body;
          }
          var err = new ApiError(res.status, body);

          /* 503 before 401: if no password is configured, every endpoint
             answers 503 and asking the owner to sign in would be a lie. */
          if (res.status === 503 && err.code === "no_admin_password" && handlers.noPassword) {
            handlers.noPassword(err);
            throw err;
          }
          if (res.status === 503 && err.code === "store_unreadable" && handlers.storeUnreadable) {
            handlers.storeUnreadable(err);
            throw err;
          }
          if (res.status === 401 && retryOn401 && handlers.reauth) {
            /* Re-authenticate in place and replay the request, so a session
               that expires mid-edit never costs the owner her work. */
            return Promise.resolve(handlers.reauth(err)).then(function (ok) {
              if (!ok) throw err;
              return attempt(method, path, options, false);
            });
          }
          if (res.status === 403 && handlers.forbidden) handlers.forbidden(err);
          /* 409 carries the current rev; adopt it so the reload offer is
             accurate. */
          if (res.status === 409 && typeof body.rev === "number") state.rev = body.rev;
          throw err;
        });
      });
  }

  function request(method, path, options) {
    return attempt(method, path, options, true);
  }

  /* Auth endpoints must never trigger the reauth-and-retry path: a bad
     password on the login screen answers 401 too, and retryOn401 would
     otherwise hand that straight to handlers.reauth() and open the
     "session ended" modal over the login screen itself, hanging forever
     waiting for an interaction nobody can give it. */
  function requestNoRetry(method, path, options) {
    return attempt(method, path, options, false);
  }

  /* ---------------- upload ----------------
     XHR rather than fetch: fetch gives no upload progress event, and a photo
     from a phone on mobile data needs a progress bar or it looks hung.
     The body is still the contract's JSON envelope. */
  function uploadRequest(payload, onProgress, onAbortHandle) {
    return new Promise(function (resolve, reject) {
      var xhr = new XMLHttpRequest();
      xhr.open("POST", BASE + "/upload", true);
      xhr.withCredentials = true;
      xhr.setRequestHeader("X-FC-Admin", "1");
      xhr.setRequestHeader("Content-Type", "application/json; charset=utf-8");
      xhr.setRequestHeader("Accept", "application/json");

      if (onProgress && xhr.upload) {
        xhr.upload.onprogress = function (e) {
          if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
        };
      }
      if (onAbortHandle) {
        onAbortHandle(function () {
          try { xhr.abort(); } catch (e) { /* already finished */ }
        });
      }

      xhr.onerror = function () { reject(new ApiError(0, { error: "network" }, "network")); };
      xhr.onabort = function () { reject(new ApiError(0, { error: "aborted", message: "Upload cancelled." }, "aborted")); };
      xhr.onload = function () {
        var body = {};
        try { body = xhr.responseText ? JSON.parse(xhr.responseText) : {}; } catch (e) { body = {}; }
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(body);
        } else {
          reject(new ApiError(xhr.status, body));
        }
      };
      xhr.send(JSON.stringify(payload));
    });
  }

  /* ---------------- endpoints ---------------- */

  var api = {
    handlers: handlers,
    ApiError: ApiError,
    assetURL: assetURL,

    get rev() { return state.rev; },
    set rev(v) { state.rev = v; },
    get meta() { return state.meta; },

    /* -- auth -- */
    session: function () {
      /* the only request without X-FC-Admin */
      return requestNoRetry("GET", "/session", { noCsrf: true });
    },
    login: function (password) {
      return requestNoRetry("POST", "/login", { body: { password: password } });
    },
    logout: function () {
      return requestNoRetry("POST", "/logout", { body: {} });
    },
    loadMeta: function () {
      return request("GET", "/meta").then(function (m) {
        state.meta = m;
        return m;
      });
    },

    /* -- read -- */
    getAll: function () { return request("GET", "/data"); },
    getCollection: function (name) { return request("GET", "/data/" + encodeURIComponent(name)); },

    /* -- write --
       One primitive: whole-collection PUT with the rev. Reorder is "PUT the
       array in a different order"; delete is "PUT it without that element". */
    putCollection: function (name, payload, opts) {
      opts = opts || {};
      var qs = opts.force ? "?force=1" : "";
      var body = { rev: state.rev };
      if (SINGLETONS.indexOf(name) >= 0) body.item = payload;
      else body.items = payload;
      return request("PUT", "/data/" + encodeURIComponent(name) + qs, { body: body });
    },

    createProduct: function (item, index) {
      var body = { rev: state.rev, item: item };
      if (typeof index === "number") body.index = index;
      return request("POST", "/data/products", { body: body });
    },
    updateProduct: function (id, item) {
      return request("PUT", "/data/products/" + encodeURIComponent(id), {
        body: { rev: state.rev, item: item }
      });
    },
    deleteProduct: function (id) {
      /* rev travels in the query string — a DELETE body is awkward in fetch */
      return request("DELETE", "/data/products/" + encodeURIComponent(id) + "?rev=" + encodeURIComponent(state.rev));
    },

    /* -- images -- */
    upload: function (opts) {
      return uploadRequest(
        { folder: opts.folder, filename: opts.filename, data: opts.data },
        opts.onProgress,
        opts.onAbortHandle
      );
    },
    listImages: function (folder) {
      return request("GET", "/images?folder=" + encodeURIComponent(folder));
    },
    deleteImage: function (path) {
      return request("DELETE", "/images?path=" + encodeURIComponent(path));
    },

    /* -- maintenance -- */
    publish: function () { return request("POST", "/publish", { body: {} }); },
    backups: function () { return request("GET", "/backups"); },
    restore: function (file) { return request("POST", "/restore", { body: { file: file } }); }
  };

  var SINGLETONS = ["site", "demoUser"];

  api.isSingleton = function (name) { return SINGLETONS.indexOf(name) >= 0; };

  window.FCA = window.FCA || {};
  window.FCA.api = api;
})(window);
