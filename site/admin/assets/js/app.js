/* ==========================================================================
   app.js — the shell: working copy, hash router, dirty tracking, save
   orchestration, and the UI primitives (status, toast, modal, banner) that
   every screen module uses.

   The save model is per-section with an EXPLICIT save. Edits mutate
   FCA.state.doc only; nothing reaches the server until Save is pressed.
   The backend rewrites one content file — autosave on a file-backed store
   would put a half-typed price on the live site, and explicit save is what
   gives the owner a Cancel that actually cancels.

   The one exception, labelled in the UI: image uploads POST immediately,
   because a file cannot live in a JS object. See images.js.
   ========================================================================== */

(function (window, document) {
  "use strict";

  var FCA = window.FCA = window.FCA || {};
  var api = FCA.api;

  /* ======================================================================
     util
     ====================================================================== */

  function esc(v) {
    if (v == null) return "";
    return String(v)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  /* Copied verbatim from data.js so the admin computes the same slugs the
     storefront does — menu slug collisions and option ids depend on it. */
  function slug(str) {
    return String(str)
      .toLowerCase()
      .replace(/[’']/g, "")
      .replace(/&/g, "and")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }

  function money(value) {
    var cur = (state.doc && state.doc.site && state.doc.site.currency) || "৳";
    var n = Number(value) || 0;
    return cur + " " + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function debounce(fn, ms) {
    var t;
    return function () {
      var args = arguments, self = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(self, args); }, ms);
    };
  }

  function fromHTML(html) {
    var tpl = document.createElement("template");
    tpl.innerHTML = String(html).trim();
    return tpl.content.firstElementChild;
  }

  function timeNow() {
    var d = new Date();
    return ("0" + d.getHours()).slice(-2) + ":" + ("0" + d.getMinutes()).slice(-2);
  }

  function plural(n, one, many) { return n + " " + (n === 1 ? one : many); }

  var ICONS = {
    edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h4l10-10-4-4L4 16Z"/><path d="M13.5 6.5 17.5 10.5"/></svg>',
    trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><path d="M5 7h14M10 7V5h4v2M7 7l1 13h8l1-13"/></svg>',
    up: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 14 6-6 6 6"/></svg>',
    down: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 10 6 6 6-6"/></svg>',
    more: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="19" cy="12" r="1.7"/></svg>',
    search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
    chevron: '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m4 2 4 4-4 4"/></svg>',
    upload: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 16V4m0 0L7 9m5-5 5 5"/><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/></svg>',
    star: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" aria-hidden="true"><path d="m12 4 2.4 5 5.6.8-4 3.9 1 5.5-5-2.7-5 2.7 1-5.5-4-3.9 5.6-.8Z"/></svg>',
    starFill: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="m12 4 2.4 5 5.6.8-4 3.9 1 5.5-5-2.7-5 2.7 1-5.5-4-3.9 5.6-.8Z"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>',
    back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5 8 12l7 7"/></svg>',
    box: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 13 4 4L19 7"/></svg>'
  };

  var util = {
    esc: esc, slug: slug, clone: clone, money: money, debounce: debounce,
    fromHTML: fromHTML, icon: function (n) { return ICONS[n] || ""; },
    plural: plural, timeNow: timeNow
  };

  /* ======================================================================
     state — one working copy of the whole document
     ====================================================================== */

  var SECTIONS = ["site", "menu", "hero", "categories", "series", "products",
                  "brands", "clients", "footerLinks", "bedSizes", "demoUser"];

  var state = {
    doc: {},        /* the working copy — every edit mutates this */
    baseline: {},   /* JSON of each section as last agreed with the server */
    dirty: {},      /* section -> true */
    meta: null,
    signedInAt: null,
    loaded: false
  };

  var DRAFT_KEY = "fc-admin-draft-v1";

  /* ======================================================================
     UI primitives
     ====================================================================== */

  /* ---- status (topbar, one instance, aria-live) ---- */
  var statusEl, statusTimer;

  function setStatus(kind, text) {
    if (!statusEl) return;
    clearTimeout(statusTimer);
    statusEl.className = "ad-status";
    var glyph = "";
    if (kind === "dirty") {
      statusEl.classList.add("is-dirty");
      glyph = '<i class="ad-dot" aria-hidden="true"></i>';
    } else if (kind === "saving") {
      statusEl.classList.add("is-dirty");
      glyph = '<i class="ad-spinner" aria-hidden="true"></i>';
    } else if (kind === "saved") {
      statusEl.classList.add("is-saved");
      glyph = '<i class="ad-glyph ad-glyph-ok" aria-hidden="true">✓</i>';
    } else if (kind === "failed") {
      statusEl.classList.add("is-failed");
      glyph = '<i class="ad-glyph ad-glyph-bad" aria-hidden="true">!</i>';
    }
    statusEl.innerHTML = glyph + '<span class="ad-status-text">' + esc(text) + "</span>";

    if (kind === "saved") {
      statusTimer = setTimeout(function () { refreshStatus(); }, 4000);
    }
  }

  function refreshStatus() {
    var dirtyList = dirtySections();
    if (dirtyList.length) setStatus("dirty", "Unsaved changes");
    else setStatus("clean", "All changes saved");
  }

  /* ---- toasts ---- */
  function toast(message, opts) {
    opts = opts || {};
    var stack = document.getElementById("ad-toasts");
    if (!stack) return;
    var node = document.createElement("div");
    node.className = "fc-toast ad-toast";
    node.innerHTML = "<span>" + esc(message) + "</span>";
    if (opts.actionLabel) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = opts.actionLabel;
      btn.addEventListener("click", function () {
        remove();
        if (opts.onAction) opts.onAction();
      });
      node.appendChild(btn);
    }
    stack.appendChild(node);
    var t = setTimeout(remove, opts.ms || (opts.actionLabel ? 8000 : 3500));
    function remove() {
      clearTimeout(t);
      if (node.parentNode) node.parentNode.removeChild(node);
    }
    return remove;
  }

  /* ---- modal ----
     Focus is trapped, Esc closes (unless dismissible:false, §7.7 session
     expiry), and focus returns to whatever opened it. Resolves with the
     chosen action value, or null when dismissed. */
  var openModals = [];

  function modal(opts) {
    opts = opts || {};
    var root = document.getElementById("ad-modal-root");
    var opener = document.activeElement;

    var wrap = document.createElement("div");
    wrap.className = "fc-modal";
    wrap.setAttribute("role", "dialog");
    wrap.setAttribute("aria-modal", "true");

    var titleId = "ad-modal-title-" + Date.now();
    var actions = (opts.actions || []).map(function (a, i) {
      var cls = "fc-btn";
      if (a.kind === "outline") cls += " fc-btn-outline";
      if (a.kind === "danger") cls += " fc-btn-outline fc-btn-danger";
      if (a.kind === "danger-fill") cls += " fc-btn-danger is-fill";
      return '<button type="button" class="' + cls + '" data-ad-action="' + i + '">' + esc(a.label) + "</button>";
    }).join("");

    wrap.innerHTML =
      '<div class="fc-modal-backdrop" data-ad-backdrop></div>' +
      '<div class="fc-modal-dialog ad-dialog' + (opts.className ? " " + opts.className : "") + '" aria-labelledby="' + titleId + '">' +
        (opts.title ? '<h3 id="' + titleId + '">' + esc(opts.title) + "</h3>" : "") +
        '<div class="ad-dialog-body"></div>' +
        (actions ? '<div class="ad-modal-actions">' + actions + "</div>" : "") +
      "</div>";

    var body = wrap.querySelector(".ad-dialog-body");
    if (opts.bodyNode) body.appendChild(opts.bodyNode);
    else if (opts.bodyHTML) body.innerHTML = opts.bodyHTML;

    root.appendChild(wrap);
    openModals.push(wrap);

    return new Promise(function (resolve) {
      function close(value) {
        var i = openModals.indexOf(wrap);
        if (i >= 0) openModals.splice(i, 1);
        document.removeEventListener("keydown", onKey, true);
        if (wrap.parentNode) wrap.parentNode.removeChild(wrap);
        if (opener && opener.focus) { try { opener.focus(); } catch (e) { /* gone */ } }
        resolve(value);
      }

      wrap.addEventListener("click", function (e) {
        var b = e.target.closest ? e.target.closest("[data-ad-action]") : null;
        if (b) {
          var a = opts.actions[Number(b.getAttribute("data-ad-action"))];
          if (a.onSelect && a.onSelect(close) === false) return;
          if (!a.keepOpen) close(a.value);
          return;
        }
        if (opts.dismissible !== false && e.target.hasAttribute("data-ad-backdrop")) close(null);
      });

      function onKey(e) {
        if (openModals[openModals.length - 1] !== wrap) return;
        if (e.key === "Escape" && opts.dismissible !== false) {
          e.preventDefault();
          close(null);
          return;
        }
        if (e.key !== "Tab") return;
        var f = wrap.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])');
        if (!f.length) return;
        var first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
      document.addEventListener("keydown", onKey, true);

      /* The safe choice is the default: never autofocus a destructive button. */
      var auto = wrap.querySelector("[data-ad-autofocus]") ||
                 wrap.querySelector(".ad-modal-actions .fc-btn:not(.fc-btn-outline):not(.fc-btn-danger)") ||
                 wrap.querySelector("input, select, textarea, button");
      if (auto) setTimeout(function () { try { auto.focus(); } catch (e) {} }, 20);

      wrap._close = close;
    });
  }

  /* ---- destructive confirm (§7.5) ---- */
  function confirmDelete(opts) {
    var html = "";
    if (opts.recordHTML) html += '<div class="ad-confirm-name">' + opts.recordHTML + "</div>";
    if (opts.consequence) html += "<p>" + opts.consequence + "</p>";
    if (opts.list && opts.list.length) {
      var shown = opts.list.slice(0, 5);
      html += '<ul class="ad-confirm-list">' +
        shown.map(function (s) { return "<li>" + esc(s) + "</li>"; }).join("") +
        (opts.list.length > 5 ? "<li>and " + (opts.list.length - 5) + " more</li>" : "") +
        "</ul>";
    }
    return modal({
      className: "ad-confirm",
      title: opts.title,
      bodyHTML: html,
      actions: [
        { label: "Cancel", value: false },
        { label: opts.confirmLabel || "Delete", kind: "danger-fill", value: true }
      ]
    }).then(function (v) { return v === true; });
  }

  /* ---- banners (persistent, page-top) ---- */
  function clearBanners(tag) {
    var host = document.getElementById("ad-banners");
    if (!host) return;
    if (!tag) { host.innerHTML = ""; return; }
    Array.prototype.slice.call(host.querySelectorAll('[data-ad-banner="' + tag + '"]')).forEach(function (n) {
      n.parentNode.removeChild(n);
    });
  }

  function banner(opts) {
    var host = document.getElementById("ad-banners");
    if (!host) return;
    clearBanners(opts.tag);
    var node = document.createElement("div");
    node.className = "ad-banner ad-banner-" + (opts.kind || "warn");
    if (opts.tag) node.setAttribute("data-ad-banner", opts.tag);
    if (opts.kind === "error") node.setAttribute("role", "alert");

    node.innerHTML = '<div class="ad-grow"><strong>' + esc(opts.title) + "</strong>" +
      (opts.bodyHTML ? opts.bodyHTML : (opts.body ? esc(opts.body) : "")) + "</div>";

    (opts.actions || []).forEach(function (a) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "fc-btn fc-btn-sm" + (a.kind === "outline" ? " fc-btn-outline" : "");
      b.textContent = a.label;
      b.addEventListener("click", function () { a.onClick(node); });
      node.appendChild(b);
    });
    host.appendChild(node);
    return node;
  }

  function skeletonRows(n) {
    var out = "";
    for (var i = 0; i < (n || 5); i++) {
      out += '<div class="ad-skeleton-row"><div class="ad-skeleton"></div><div class="ad-skeleton"></div></div>';
    }
    return out;
  }

  var ui = {
    setStatus: setStatus, refreshStatus: refreshStatus,
    toast: toast, modal: modal, confirmDelete: confirmDelete,
    banner: banner, clearBanners: clearBanners, skeletonRows: skeletonRows
  };

  /* ======================================================================
     dirty tracking
     ====================================================================== */

  function dirtySections() {
    return Object.keys(state.dirty).filter(function (k) { return state.dirty[k]; });
  }

  function markDirty(section) {
    state.dirty[section] = true;
    refreshStatus();
    refreshNavDots();
    saveDraftSoon();
  }

  function markClean(section) {
    delete state.dirty[section];
    state.baseline[section] = JSON.stringify(state.doc[section]);
    refreshStatus();
    refreshNavDots();
    saveDraftSoon();
  }

  /* Re-checks the section against its baseline: an edit that was undone by
     hand should stop nagging. */
  function recomputeDirty(section) {
    if (JSON.stringify(state.doc[section]) === state.baseline[section]) delete state.dirty[section];
    else state.dirty[section] = true;
    refreshStatus();
    refreshNavDots();
    saveDraftSoon();
  }

  function flushDraft() {
    try {
      var d = dirtySections();
      if (!d.length) { sessionStorage.removeItem(DRAFT_KEY); return; }
      var payload = { rev: api.rev, at: Date.now(), sections: {} };
      d.forEach(function (s) { payload.sections[s] = state.doc[s]; });
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify(payload));
    } catch (e) { /* private mode / quota — the draft is never a requirement */ }
  }

  var saveDraftSoon = debounce(function () {
    try {
      var d = dirtySections();
      if (!d.length) { sessionStorage.removeItem(DRAFT_KEY); return; }
      var payload = { rev: api.rev, at: Date.now(), sections: {} };
      d.forEach(function (s) { payload.sections[s] = state.doc[s]; });
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify(payload));
    } catch (e) {
      /* private mode / quota — the draft is a convenience, never a
         requirement, so a failure here must not break editing */
    }
  }, 200);

  function refreshNavDots() {
    Array.prototype.slice.call(document.querySelectorAll("[data-ad-count]")).forEach(function (el) {
      var key = el.getAttribute("data-ad-count");
      var val = state.doc[key];
      var n = Array.isArray(val) ? val.length : null;
      var dot = state.dirty[key]
        ? '<i class="ad-dot" title="Unsaved changes" aria-hidden="true"></i><span class="fc-visually-hidden">unsaved changes</span>'
        : "";
      el.innerHTML = dot + (n == null ? "" : n);
    });
  }

  /* ======================================================================
     save
     ====================================================================== */

  var saving = false;

  /* One save path for every whole-collection section. `serialise` lets a
     module strip UI-only keys before the PUT. */
  function saveCollection(section, opts) {
    opts = opts || {};
    if (saving) return Promise.resolve(false);
    saving = true;
    ui.clearBanners("save");
    setStatus("saving", "Saving…");

    var slow = setTimeout(function () { setStatus("saving", "Saving… still working"); }, 8000);
    var payload = opts.serialise ? opts.serialise(state.doc[section]) : state.doc[section];

    function attemptSave(force) {
      return api.putCollection(section, payload, { force: force });
    }

    return attemptSave(false)
      .catch(function (err) {
        /* 409 in_use is a referential block the owner can consciously
           override — never silently. */
        if (err.status === 409 && err.code === "in_use") {
          var refs = err.body.referencedBy || [];
          return ui.confirmDelete({
            title: "Something still uses this",
            consequence: esc(err.message),
            list: refs,
            confirmLabel: "Save anyway"
          }).then(function (yes) {
            if (!yes) throw err;
            return attemptSave(true);
          });
        }
        throw err;
      })
      .then(function (res) {
        clearTimeout(slow);
        saving = false;
        markClean(section);
        setStatus("saved", "Saved " + timeNow());
        ui.toast(opts.successMessage || "Saved.");
        refreshNavDots();
        showWarnings(res && res.warnings);
        if (opts.onSaved) opts.onSaved(res);
        return true;
      })
      .catch(function (err) {
        clearTimeout(slow);
        saving = false;
        setStatus("failed", "Not saved");
        handleSaveError(err, function () { saveCollection(section, opts); }, opts.onFieldErrors);
        return false;
      });
  }

  function showWarnings(warnings) {
    if (!warnings || !warnings.length) return;
    ui.banner({
      tag: "warnings",
      kind: "warn",
      title: "Saved, with " + plural(warnings.length, "note", "notes"),
      bodyHTML: "<ul class=\"ad-confirm-list\">" +
        warnings.map(function (w) { return "<li>" + esc(w) + "</li>"; }).join("") + "</ul>",
      actions: [{ label: "Dismiss", kind: "outline", onClick: function (n) { n.parentNode.removeChild(n); } }]
    });
  }

  /* The failure copy is load-bearing: "Your changes are still here" is what
     stops her re-typing. A toast would vanish and she would assume it saved. */
  function handleSaveError(err, retry, onFieldErrors) {
    if (err.status === 409 && err.code === "stale_rev") {
      ui.banner({
        tag: "save",
        kind: "error",
        title: "Another tab saved since you opened this.",
        body: "Reload to get the newest content. Your unsaved changes here will be lost.",
        actions: [
          { label: "Reload", onClick: function () { location.reload(); } },
          { label: "Keep editing", kind: "outline", onClick: function (n) { n.parentNode.removeChild(n); } }
        ]
      });
      return;
    }
    if (err.status === 400 && err.fields && onFieldErrors) {
      onFieldErrors(err.fields, err.message);
      return;
    }
    if (err.status === 413) {
      ui.banner({
        tag: "save", kind: "error",
        title: "That is too much data to send at once.",
        body: err.message
      });
      return;
    }

    ui.banner({
      tag: "save",
      kind: "error",
      title: "Could not save.",
      bodyHTML: " The server said: <em>" + esc(err.message) + "</em> Your changes are still here.",
      actions: [
        { label: "Try again", onClick: function (n) { n.parentNode.removeChild(n); retry(); } },
        {
          label: "Copy error", kind: "outline",
          onClick: function () {
            var text = "HTTP " + err.status + " " + err.code + ": " + err.message;
            if (navigator.clipboard) navigator.clipboard.writeText(text).then(function () { ui.toast("Error copied."); });
            else ui.toast(text);
          }
        }
      ]
    });
  }

  /* ======================================================================
     router
     ====================================================================== */

  var PAGES = {};       /* key -> controller */
  var SEGMENT = {
    "": "dashboard",
    "products": "products",
    "brands": "brands",
    "categories": "categories",
    "series": "series",
    "bedsizes": "bedSizes",
    "menu": "menu",
    "hero": "hero",
    "footer": "footerLinks",
    "clients": "clients",
    "site": "site",
    "maintenance": "maintenance"
  };
  var TITLES = {
    dashboard: "Dashboard", products: "Products", brands: "Brands",
    categories: "Categories", series: "Series", bedSizes: "Bed sizes",
    menu: "Menu", hero: "Hero slides", footerLinks: "Footer links",
    clients: "Clients", site: "Company info", maintenance: "Backups & password",
    notfound: "Not found"
  };

  var current = { page: null, parts: [] };
  var suppressHash = false;

  function parseHash() {
    var raw = String(location.hash || "#/").replace(/^#\/?/, "");
    var parts = raw.split("/").filter(function (p) { return p !== ""; });
    var seg = (parts[0] || "").toLowerCase();
    var page = SEGMENT.hasOwnProperty(seg) ? SEGMENT[seg] : "notfound";
    return { page: page, parts: parts.slice(1).map(decodeURIComponent) };
  }

  function register(key, controller) { PAGES[key] = controller; }

  function navigate(hash) { location.hash = hash; }

  /* A route change while a section is dirty asks first, and puts the hash
     back if she says no — so Back/forward keep working either way. */
  function onHashChange() {
    if (suppressHash) { suppressHash = false; return; }
    var next = parseHash();
    var leaving = current.page;
    var lastHash = current.hash;

    var blocking = leaving && state.dirty[leaving] && next.page !== leaving &&
                   PAGES[leaving] && PAGES[leaving].guardOnLeave !== false;

    if (!blocking) { render(next); return; }

    modal({
      title: "Leave without saving?",
      bodyHTML: "<p>You changed <strong>" + esc(TITLES[leaving] || leaving) +
                "</strong>. Those changes will be lost.</p>",
      actions: [
        { label: "Keep editing", value: "stay" },
        { label: "Discard changes", kind: "danger", value: "go" }
      ]
    }).then(function (choice) {
      if (choice === "go") {
        /* discard: restore the section from its baseline */
        try { state.doc[leaving] = JSON.parse(state.baseline[leaving]); } catch (e) {}
        delete state.dirty[leaving];
        refreshStatus();
        refreshNavDots();
        saveDraftSoon();
        render(next);
      } else {
        suppressHash = true;
        location.hash = lastHash || "#/";
      }
    });
  }

  function render(route) {
    current = { page: route.page, parts: route.parts, hash: location.hash };

    Array.prototype.slice.call(document.querySelectorAll("[data-ad-page]")).forEach(function (el) {
      el.hidden = el.getAttribute("data-ad-page") !== route.page;
    });
    Array.prototype.slice.call(document.querySelectorAll("[data-ad-nav]")).forEach(function (el) {
      var on = el.getAttribute("data-ad-nav") === route.page;
      el.classList.toggle("is-active", on);
      if (on) el.setAttribute("aria-current", "page");
      else el.removeAttribute("aria-current");
    });

    var title = TITLES[route.page] || "Admin";
    document.getElementById("ad-topbar-title").textContent = title;
    document.title = title + " — Admin — The Furnist 365";

    ui.clearBanners("save");
    ui.clearBanners("validation");
    closeSidebar();

    var host = document.querySelector('[data-ad-page="' + route.page + '"]');
    var controller = PAGES[route.page];
    if (!controller) {
      host.innerHTML = '<div class="ad-page"><div class="ad-empty">' + util.icon("box") +
        "<h2>That screen does not exist</h2><p>The address in the bar does not match any section.</p>" +
        '<a class="fc-btn" href="#/">Go to the dashboard</a></div></div>';
      return;
    }
    try {
      controller.render(host, route);
    } catch (e) {
      host.innerHTML = '<div class="ad-page"><div class="ad-banner ad-banner-error" role="alert">' +
        '<div class="ad-grow"><strong>This screen could not be drawn.</strong> ' + esc(e.message) + "</div></div></div>";
      if (window.console) console.error(e);
    }
    window.scrollTo(0, 0);
  }

  /* ======================================================================
     sidebar (off-canvas below 1024px)
     ====================================================================== */

  var sidebarOpen = false;

  function openSidebar() {
    sidebarOpen = true;
    document.getElementById("ad-sidebar").classList.add("is-open");
    document.getElementById("ad-scrim").hidden = false;
    document.getElementById("ad-burger").setAttribute("aria-expanded", "true");
    var first = document.querySelector("#ad-nav .ad-nav-link");
    if (first) first.focus();
  }

  function closeSidebar() {
    if (!sidebarOpen) return;
    sidebarOpen = false;
    document.getElementById("ad-sidebar").classList.remove("is-open");
    document.getElementById("ad-scrim").hidden = true;
    document.getElementById("ad-burger").setAttribute("aria-expanded", "false");
  }

  /* ======================================================================
     boot
     ====================================================================== */

  function showOnly(id) {
    ["ad-boot", "ad-blocking", "ad-login", "ad-shell"].forEach(function (x) {
      var el = document.getElementById(x);
      if (el) el.hidden = x !== id;
    });
  }

  function blockingScreen(title, bodyHTML) {
    var el = document.getElementById("ad-blocking");
    el.innerHTML =
      '<img src="../assets/img/brand/logo-mark.svg" alt="" width="34" height="44">' +
      '<div class="ad-banner ad-banner-error" role="alert" style="max-width:560px;text-align:left">' +
        '<div class="ad-grow"><strong>' + esc(title) + "</strong>" + bodyHTML + "</div></div>" +
      '<button class="fc-btn fc-btn-outline" type="button" onclick="location.reload()">Try again</button>';
    showOnly("ad-blocking");
  }

  api.handlers.noPassword = function () {
    blockingScreen(
      "No admin password has been set yet.",
      "<p>The panel stays locked until someone sets one on the server:</p>" +
      '<p><code>python serve.py --set-admin-password</code></p>' +
      "<p>It asks twice, never echoes what you type, and stores only a hash.</p>"
    );
  };

  api.handlers.storeUnreadable = function () {
    blockingScreen(
      "The content file cannot be read.",
      "<p>The server started in read-only mode because <code>data/site.json</code> is missing or " +
      "does not parse. The website still works; nothing can be saved until that file is repaired " +
      "or restored from <code>data/backups/</code>.</p>"
    );
  };

  api.handlers.forbidden = function () {
    /* 403 means this page is out of step with the server (CSRF/origin). A
       reload is the only honest fix, but never throw away unsaved work
       without asking. */
    if (dirtySections().length) {
      ui.banner({
        tag: "save", kind: "error",
        title: "This page is out of date.",
        body: "The server refused the request. Reload to continue — your unsaved changes will be lost.",
        actions: [{ label: "Reload", onClick: function () { location.reload(); } }]
      });
    } else {
      location.reload();
    }
  };

  function loadDocument() {
    return api.getAll().then(function (doc) {
      SECTIONS.forEach(function (s) {
        state.doc[s] = doc[s] !== undefined ? doc[s] : (s === "site" || s === "demoUser" ? {} : []);
        state.baseline[s] = JSON.stringify(state.doc[s]);
      });
      state.doc._meta = doc._meta || {};
      state.loaded = true;
      return api.loadMeta().catch(function () { return null; });
    }).then(function (meta) {
      state.meta = meta;
      return true;
    });
  }

  function offerDraft() {
    var raw;
    try { raw = sessionStorage.getItem(DRAFT_KEY); } catch (e) { return; }
    if (!raw) return;
    var draft;
    try { draft = JSON.parse(raw); } catch (e) { sessionStorage.removeItem(DRAFT_KEY); return; }
    var names = Object.keys(draft.sections || {});
    if (!names.length) return;

    /* A draft written against an older revision cannot be trusted on top of
       newer server content — offer it, but say so. */
    var stale = draft.rev != null && api.rev != null && draft.rev !== api.rev;

    ui.banner({
      tag: "draft",
      kind: "warn",
      title: "You have unsaved changes from your last visit.",
      bodyHTML: " They were kept in this browser: <strong>" +
        esc(names.map(function (n) { return TITLES[n] || n; }).join(", ")) + "</strong>." +
        (stale ? " The site has been saved by someone since then, so review them carefully." : ""),
      actions: [
        {
          label: "Restore them",
          onClick: function (node) {
            names.forEach(function (n) {
              state.doc[n] = draft.sections[n];
              state.dirty[n] = true;
            });
            node.parentNode.removeChild(node);
            refreshStatus();
            refreshNavDots();
            render(parseHash());
            ui.toast("Unsaved changes restored.");
          }
        },
        {
          label: "Discard",
          kind: "outline",
          onClick: function (node) {
            try { sessionStorage.removeItem(DRAFT_KEY); } catch (e) {}
            node.parentNode.removeChild(node);
          }
        }
      ]
    });
  }

  function startShell() {
    showOnly("ad-shell");
    state.signedInAt = state.signedInAt || new Date();
    var since = document.getElementById("ad-user-since");
    if (since) since.textContent = "signed in " + timeNow();
    refreshNavDots();
    refreshStatus();
    offerDraft();
    render(parseHash());
  }

  function boot() {
    statusEl = document.getElementById("ad-status");

    /* chrome wiring */
    document.getElementById("ad-burger").addEventListener("click", function () {
      if (sidebarOpen) closeSidebar(); else openSidebar();
    });
    document.getElementById("ad-scrim").addEventListener("click", closeSidebar);
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && sidebarOpen && !openModals.length) closeSidebar();
    });
    window.addEventListener("hashchange", onHashChange);

    /* the account menu */
    var userBtn = document.getElementById("ad-user");
    userBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      var existing = userBtn.querySelector(".ad-menupop");
      if (existing) { existing.parentNode.removeChild(existing); userBtn.setAttribute("aria-expanded", "false"); return; }
      var pop = document.createElement("div");
      pop.className = "ad-menupop";
      pop.innerHTML =
        '<a href="#/maintenance">Backups &amp; password</a>' +
        '<a href="../index.html" target="_blank" rel="noopener">View the site</a>' +
        "<hr>" +
        '<button type="button" class="is-danger" data-ad-logout>Log out</button>';
      userBtn.appendChild(pop);
      userBtn.setAttribute("aria-expanded", "true");
      pop.addEventListener("click", function (ev) { ev.stopPropagation(); });
      pop.querySelector("[data-ad-logout]").addEventListener("click", function () {
        FCA.auth.logout();
      });
      pop.querySelectorAll("a").forEach(function (a) {
        a.addEventListener("click", function () { pop.parentNode.removeChild(pop); userBtn.setAttribute("aria-expanded", "false"); });
      });
      document.addEventListener("click", function once() {
        if (pop.parentNode) pop.parentNode.removeChild(pop);
        userBtn.setAttribute("aria-expanded", "false");
        document.removeEventListener("click", once);
      });
    });

    /* leaving the tab with unsaved work */
    window.addEventListener("beforeunload", function (e) {
      if (!dirtySections().length) return;
      e.preventDefault();
      e.returnValue = "";
      return "";
    });

    FCA.auth.start(function () {
      /* called once a session is confirmed */
      showOnly("ad-boot");
      loadDocument().then(startShell).catch(function (err) {
        if (err.status === 401) return;         /* auth.js takes over */
        if (err.status === 503) return;         /* blocking screen already shown */
        blockingScreen("The panel could not load its content.",
          "<p>" + esc(err.message) + "</p>");
      });
    });
  }

  /* ======================================================================
     dashboard
     ====================================================================== */

  register("dashboard", {
    render: function (host) {
      var d = state.doc;
      var checks = healthChecks();

      host.innerHTML =
        '<div class="ad-page">' +
          '<div class="ad-page-head"><div>' +
            '<h1 class="ad-page-title">Dashboard</h1>' +
            '<p class="ad-page-sub">What is on the website right now.</p>' +
          "</div></div>" +

          '<div class="fc-account-stats" style="grid-template-columns:repeat(4,minmax(0,1fr))">' +
            statTile("#/products", (d.products || []).length, "Products") +
            statTile("#/menu", (d.menu || []).length, "Menu items") +
            statTile("#/hero", (d.hero || []).length, "Hero slides") +
            statTile("#/brands", (d.brands || []).length, "Brands") +
          "</div>" +

          '<div class="ad-card">' +
            '<div class="ad-card-head"><h2>Things to check</h2></div>' +
            '<div class="ad-card-body">' +
              (checks.length
                ? '<ul class="ad-where">' + checks.map(function (c) {
                    return '<li><span aria-hidden="true">⚠</span> <a href="' + c.href + '">' + esc(c.text) + "</a></li>";
                  }).join("") + "</ul>"
                : '<p class="ad-help" style="font-size:13.5px">✓ Everything looks complete.</p>') +
            "</div>" +
          "</div>" +

          '<div class="ad-card">' +
            '<div class="ad-card-head"><h2>Last saved</h2></div>' +
            '<div class="ad-card-body" style="display:flex;gap:16px;align-items:center;flex-wrap:wrap">' +
              "<span>" + esc(formatUpdated(d._meta && d._meta.updatedAt)) +
              ' &middot; revision ' + esc(String((d._meta && d._meta.rev) != null ? d._meta.rev : "?")) + "</span>" +
              '<a class="fc-btn fc-btn-sm fc-btn-outline" href="#/maintenance">Backups &amp; restore</a>' +
            "</div>" +
          "</div>" +
        "</div>";
    }
  });

  function statTile(href, n, label) {
    return '<a class="fc-account-stat" href="' + href + '"><strong>' + n + "</strong><span>" + esc(label) + "</span></a>";
  }

  function formatUpdated(iso) {
    if (!iso) return "Not saved through this panel yet";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso);
    return d.toLocaleString();
  }

  /* Only the checks that correspond to something visibly wrong on the site. */
  function healthChecks() {
    var out = [];
    (state.doc.products || []).forEach(function (p) {
      if (!p.image && !(p.gallery && p.gallery.length)) {
        out.push({ text: (p.name || p.id) + " has no photo", href: "#/products/edit/" + encodeURIComponent(p.id) });
      }
      if (!p.short) {
        out.push({ text: (p.name || p.id) + " has no short description", href: "#/products/edit/" + encodeURIComponent(p.id) });
      }
    });
    (state.doc.menu || []).forEach(function (m, i) {
      (m.groups || []).forEach(function (g, gi) {
        (g.items || []).forEach(function (l, li) {
          if (!l.href || l.href === "#") {
            out.push({
              text: "Menu › " + (m.label || "?") + " › " + (g.title || "?") + " › " + (l.label || "?") + " links nowhere",
              href: "#/menu/node/" + i + "-" + gi + "-" + li
            });
          }
        });
      });
    });
    (state.doc.hero || []).forEach(function (s, i) {
      if (s.cta && !s.href) {
        out.push({ text: "Hero slide " + (i + 1) + " has a button with no link", href: "#/hero/edit/" + i });
      }
    });
    return out.slice(0, 12);
  }

  /* ======================================================================
     maintenance: publish, backups, password
     ====================================================================== */

  register("maintenance", {
    render: function (host) {
      host.innerHTML =
        '<div class="ad-page">' +
          '<div class="ad-page-head"><div>' +
            '<h1 class="ad-page-title">Backups &amp; password</h1>' +
            '<p class="ad-page-sub">Repair, restore, and how the password is changed.</p>' +
          "</div></div>" +

          '<div class="ad-card"><div class="ad-card-head"><h2>Rebuild the website file</h2></div>' +
            '<div class="ad-card-body">' +
              '<p class="ad-help" style="font-size:13.5px">The website reads <code>assets/js/data.js</code>, ' +
              "which the server writes from its own copy every time you save. If the site ever looks " +
              "older than the panel, press this to write it again. It changes no content.</p>" +
              '<button class="fc-btn fc-btn-outline" type="button" data-ad-publish>Rebuild now</button>' +
            "</div></div>" +

          '<div class="ad-card"><div class="ad-card-head"><h2>Backups</h2></div>' +
            '<div class="ad-card-body" data-ad-backups>' + skeletonRows(3) + "</div></div>" +

          '<div class="ad-card"><div class="ad-card-head"><h2>Admin password</h2></div>' +
            '<div class="ad-card-body">' +
              '<p class="ad-help" style="font-size:13.5px">The password is not stored in the website ' +
              "files and cannot be changed from this screen — that is deliberate, so nobody who " +
              "gets into the panel can lock you out of it. Change it on the server:</p>" +
              "<p><code>python serve.py --set-admin-password</code></p>" +
              '<p class="ad-help">It asks twice, never shows what you type, and stores only a hash. ' +
              "Everyone is signed out when the server restarts.</p>" +
            "</div></div>" +
        "</div>";

      host.querySelector("[data-ad-publish]").addEventListener("click", function (e) {
        var btn = e.currentTarget;
        btn.disabled = true;
        btn.setAttribute("aria-busy", "true");
        var label = btn.textContent;
        btn.textContent = "Rebuilding…";
        api.publish().then(function (r) {
          ui.toast("Website file rebuilt (" + (r.bytes || 0) + " bytes).");
        }).catch(function (err) {
          ui.banner({ tag: "save", kind: "error", title: "Could not rebuild.", body: err.message });
        }).then(function () {
          btn.disabled = false;
          btn.removeAttribute("aria-busy");
          btn.textContent = label;
        });
      });

      var box = host.querySelector("[data-ad-backups]");
      api.backups().then(function (r) {
        var items = r.items || [];
        if (!items.length) { box.innerHTML = '<p class="ad-help" style="font-size:13.5px">No backups yet. One is taken automatically every time you save.</p>'; return; }
        box.innerHTML = '<ul class="ad-where">' + items.map(function (b) {
          return "<li><span>" + esc(b.file) + "</span><span style=\"margin-left:auto\">" +
            '<button class="fc-btn fc-btn-sm fc-btn-outline" type="button" data-ad-restore="' + esc(b.file) + '">Restore</button></span></li>';
        }).join("") + "</ul>";
        box.addEventListener("click", function (e) {
          var b = e.target.closest("[data-ad-restore]");
          if (!b) return;
          var file = b.getAttribute("data-ad-restore");
          ui.confirmDelete({
            title: "Restore this backup?",
            consequence: "Everything on the site goes back to how it was in <strong>" + esc(file) +
                         "</strong>. A backup of the current content is taken first, so this is itself undoable.",
            confirmLabel: "Restore"
          }).then(function (yes) {
            if (!yes) return;
            return api.restore(file).then(function () {
              ui.toast("Restored. Reloading…");
              setTimeout(function () { location.reload(); }, 800);
            }).catch(function (err) {
              ui.banner({ tag: "save", kind: "error", title: "Could not restore.", body: err.message });
            });
          });
        });
      }).catch(function (err) {
        box.innerHTML = '<p class="ad-help" style="font-size:13.5px">Could not list the backups: ' + esc(err.message) + "</p>";
      });
    }
  });

  /* ======================================================================
     exports
     ====================================================================== */

  FCA.util = util;
  FCA.ui = ui;
  FCA.state = state;
  FCA.app = {
    register: register,
    navigate: navigate,
    parseHash: parseHash,
    rerender: function () { render(parseHash()); },
    markDirty: markDirty,
    markClean: markClean,
    recomputeDirty: recomputeDirty,
    dirtySections: dirtySections,
    isDirty: function (s) { return !!state.dirty[s]; },
    saveCollection: saveCollection,
    handleSaveError: handleSaveError,
    showWarnings: showWarnings,
    refreshNavDots: refreshNavDots,
    isSaving: function () { return saving; },
    setSaving: function (v) { saving = v; },
    flushDraft: flushDraft,
    titleOf: function (s) { return TITLES[s] || s; },
    startShell: startShell,
    showOnly: showOnly
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})(window, document);
