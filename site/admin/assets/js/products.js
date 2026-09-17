/* ==========================================================================
   products.js — the product list and the product editor.

   Two findings from the data drive this screen, and both contradict the
   obvious reading:

   1. `variable: true` does NOT mean "price range". data.js has products with
      variable:true and a single fixed price (wrd-514r-lq, tbs-514r-lq) and
      others with variable:true and priceMin/priceMax. components.js:73 keys
      the card price purely off `priceMin != null && priceMax != null`, while
      cart.js checks `price` first. So the editor exposes TWO independent
      controls — "Price type" and "Buyer chooses an option" — and the
      serialiser DELETES the keys of whichever price shape is not in use.
      A product holding both renders a range on the card and charges the
      fixed price in the cart: a silent mispricing.

   2. `image` is always `gallery[0]`. One strip, first tile badged MAIN;
      `image` is derived, never edited separately (docs/api-admin.md §7.2).

   Bed sizes are a shared list, not a copy: an option group can point at it
   with the reference "@bedSizes" (§7.1), so renaming a size once changes
   every product that uses it.
   ========================================================================== */

(function (window, document) {
  "use strict";

  var FCA = window.FCA = window.FCA || {};
  var api = FCA.api;
  var F = null;   /* FCA.fields, resolved lazily — list-editor.js may load after */

  function fields() { return FCA.fields; }
  function esc(v) { return FCA.util.esc(v); }
  function products() { return FCA.state.doc.products || (FCA.state.doc.products = []); }
  function meta() { return FCA.state.meta || {}; }

  function isRange(p) { return p.priceMin != null && p.priceMax != null; }

  function priceCellHTML(p) {
    if (isRange(p)) {
      return '<span class="ad-price">' + FCA.util.money(p.priceMin) + " – " + FCA.util.money(p.priceMax) +
        '</span><span class="ad-pill-range">range</span>';
    }
    if (p.price != null) return '<span class="ad-price">' + FCA.util.money(p.price) + "</span>";
    return '<span class="ad-pill ad-pill-warn">no price</span>';
  }

  function thumbHTML(p) {
    var src = p.image || (p.gallery && p.gallery[0]);
    if (!src) return '<div class="ad-thumb is-missing" title="No photo" aria-hidden="true">!</div>';
    return '<div class="ad-thumb"><img src="' + esc(api.assetURL(src)) + '" alt="" loading="lazy"></div>';
  }

  function findIndex(id) {
    var list = products();
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return i;
    return -1;
  }

  /* Shared-list values resolved for display. The reference is kept in the
     data; only the UI expands it. */
  function sharedList() {
    return FCA.state.doc.bedSizes || (meta().sharedLists && meta().sharedLists.bedSizes) || [];
  }
  function resolveList(v) { return v === "@bedSizes" ? sharedList().slice() : (Array.isArray(v) ? v.slice() : []); }

  /* ======================================================================
     page
     ====================================================================== */

  FCA.app.register("products", {
    render: function (host, route) {
      if (route.parts[0] === "new") return renderEditor(host, null);
      if (route.parts[0] === "edit") return renderEditor(host, route.parts[1]);
      return renderList(host);
    }
  });

  /* ======================================================================
     list
     ====================================================================== */

  function renderList(host) {
    var page = document.createElement("div");
    page.className = "ad-page";
    page.innerHTML =
      '<div class="ad-page-head"><div>' +
        '<h1 class="ad-page-title">Products</h1>' +
        '<p class="ad-page-sub">Everything in the New Arrivals grid and on the shop page.</p>' +
      "</div>" +
      '<a class="fc-btn" href="#/products/new">＋ Add product</a></div>' +
      '<div class="ad-card">' +
        '<div class="ad-toolbar">' +
          '<div class="ad-search">' + FCA.util.icon("search") +
            '<input class="fc-input" type="search" data-ad-q placeholder="Search name or SKU" aria-label="Search products">' +
          "</div>" +
          '<label class="fc-visually-hidden" for="ad-p-cat">Filter by category</label>' +
          '<select class="fc-select" id="ad-p-cat" data-ad-cat></select>' +
          '<label class="fc-visually-hidden" for="ad-p-ser">Filter by series</label>' +
          '<select class="fc-select" id="ad-p-ser" data-ad-ser></select>' +
          '<label class="fc-visually-hidden" for="ad-p-sort">Sort</label>' +
          '<select class="fc-select" id="ad-p-sort" data-ad-sort>' +
            '<option value="none">In site order</option>' +
            '<option value="name">Name A–Z</option>' +
            '<option value="price-asc">Price low–high</option>' +
            '<option value="price-desc">Price high–low</option>' +
          "</select>" +
          '<button class="fc-btn fc-btn-sm fc-btn-outline" type="button" data-ad-clear hidden>Clear filters</button>' +
          '<span class="ad-toolbar-count" data-ad-count></span>' +
        "</div>" +
        '<div data-ad-body>' + FCA.ui.skeletonRows(5) + "</div>" +
      "</div>";

    host.innerHTML = "";
    host.appendChild(page);

    var state = { q: "", cat: "", ser: "", sort: "none" };
    var body = page.querySelector("[data-ad-body]");

    var cats = (FCA.state.doc.categories || []).map(function (c) { return { value: c.slug, label: c.label }; });
    page.querySelector("[data-ad-cat]").innerHTML =
      '<option value="">All categories</option>' +
      cats.map(function (c) { return '<option value="' + esc(c.value) + '">' + esc(c.label) + "</option>"; }).join("");

    var sers = (FCA.state.doc.series || []).map(function (s) { return { value: s.slug, label: s.title || s.slug }; });
    page.querySelector("[data-ad-ser]").innerHTML =
      '<option value="">All series</option>' +
      sers.map(function (s) { return '<option value="' + esc(s.value) + '">' + esc(s.label) + "</option>"; }).join("");

    function sortPrice(p) { return isRange(p) ? Number(p.priceMin) : Number(p.price || 0); }

    function draw() {
      var all = products();
      var rows = all.slice();

      if (state.q) {
        var q = state.q;
        rows = rows.filter(function (p) {
          return (p.name + " " + p.sku + " " + (p.brand || "")).toLowerCase().indexOf(q) >= 0;
        });
      }
      if (state.cat) rows = rows.filter(function (p) { return p.category === state.cat; });
      if (state.ser) rows = rows.filter(function (p) { return p.series === state.ser; });

      if (state.sort === "name") rows.sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); });
      else if (state.sort === "price-asc") rows.sort(function (a, b) { return sortPrice(a) - sortPrice(b); });
      else if (state.sort === "price-desc") rows.sort(function (a, b) { return sortPrice(b) - sortPrice(a); });

      var filtering = !!(state.q || state.cat || state.ser);
      page.querySelector("[data-ad-clear]").hidden = !filtering;
      page.querySelector("[data-ad-count]").textContent =
        filtering ? rows.length + " of " + all.length + " products" : FCA.util.plural(all.length, "product", "products");

      if (!all.length) {
        body.innerHTML = '<div class="ad-empty">' + FCA.util.icon("box") +
          "<h2>No products yet</h2><p>Products fill the New Arrivals grid on the home page and the shop page.</p>" +
          '<a class="fc-btn" href="#/products/new">＋ Add product</a></div>';
        return;
      }
      if (!rows.length) {
        body.innerHTML = '<div class="ad-empty">' + FCA.util.icon("search") +
          "<h2>No products match " + (state.q ? "“" + esc(state.q) + "”" : "those filters") + "</h2>" +
          '<button class="fc-btn fc-btn-outline" type="button" data-ad-clear2>Clear filters</button></div>';
        return;
      }

      body.innerHTML =
        '<div class="ad-table-wrap"><table class="ad-table"><thead><tr>' +
          '<th style="width:64px">Photo</th><th>Product</th><th style="width:110px">Category</th>' +
          '<th style="width:230px">Price</th><th style="width:100px">Series</th>' +
          '<th style="width:90px">Badge</th><th class="ad-right" style="width:100px">Actions</th>' +
        "</tr></thead><tbody>" +
        rows.map(function (p) {
          return "<tr>" +
            "<td>" + thumbHTML(p) + "</td>" +
            '<td><div class="ad-cell-main">' + esc(p.name) + "</div>" +
              '<div class="ad-cell-sub">' + esc(p.sku) + (p.brand ? " · " + esc(p.brand) : "") + "</div></td>" +
            '<td><span class="ad-pill ad-pill-muted">' + esc(p.categoryLabel || p.category) + "</span></td>" +
            "<td>" + priceCellHTML(p) + "</td>" +
            "<td>" + esc(p.series || "—") + "</td>" +
            "<td>" + (p.badge ? '<span class="fc-badge fc-badge-new">' + esc(p.badge) + "</span>" : "") +
              (!p.image && !(p.gallery || []).length ? '<span class="ad-pill ad-pill-warn">No photo</span>' : "") + "</td>" +
            '<td class="ad-right"><div class="ad-rowactions">' +
              '<a class="ad-iconbtn" href="#/products/edit/' + encodeURIComponent(p.id) + '" title="Edit" ' +
                'aria-label="Edit ' + esc(p.name) + '">' + FCA.util.icon("edit") + "</a>" +
              '<button type="button" class="ad-iconbtn ad-iconbtn-danger" data-ad-del="' + esc(p.id) + '" ' +
                'title="Delete" aria-label="Delete ' + esc(p.name) + '">' + FCA.util.icon("trash") + "</button>" +
            "</div></td></tr>";
        }).join("") +
        "</tbody></table></div>" +

        /* below 760px the table is replaced by one card per product — never a
           sideways-scrolling table on a phone */
        '<div class="ad-list-cards">' + rows.map(function (p) {
          return '<div class="ad-list-card"><div class="ad-list-card-top">' + thumbHTML(p) +
            '<div><div class="ad-cell-main">' + esc(p.name) + "</div>" +
            '<div class="ad-cell-sub">' + esc(p.sku) + " · " + esc(p.categoryLabel || p.category) + "</div>" +
            '<div style="margin-top:4px">' + priceCellHTML(p) + "</div>" +
            '<div style="margin-top:6px">' +
              (p.badge ? '<span class="fc-badge fc-badge-new">' + esc(p.badge) + "</span> " : "") +
              (!p.image && !(p.gallery || []).length ? '<span class="ad-pill ad-pill-warn">No photo</span>' : "") +
            "</div></div></div>" +
            '<div class="ad-list-card-actions">' +
              '<a class="fc-btn fc-btn-sm fc-btn-outline" href="#/products/edit/' + encodeURIComponent(p.id) + '">Edit</a>' +
              '<button type="button" class="ad-iconbtn ad-iconbtn-danger" data-ad-del="' + esc(p.id) + '" ' +
                'aria-label="Delete ' + esc(p.name) + '">' + FCA.util.icon("trash") + "</button>" +
            "</div></div>";
        }).join("") + "</div>";
    }

    page.querySelector("[data-ad-q]").addEventListener("input", FCA.util.debounce(function (e) {
      state.q = e.target.value.trim().toLowerCase();
      draw();
    }, 120));
    page.querySelector("[data-ad-cat]").addEventListener("change", function (e) { state.cat = e.target.value; draw(); });
    page.querySelector("[data-ad-ser]").addEventListener("change", function (e) { state.ser = e.target.value; draw(); });
    page.querySelector("[data-ad-sort]").addEventListener("change", function (e) { state.sort = e.target.value; draw(); });

    function clearFilters() {
      state.q = ""; state.cat = ""; state.ser = "";
      page.querySelector("[data-ad-q]").value = "";
      page.querySelector("[data-ad-cat]").value = "";
      page.querySelector("[data-ad-ser]").value = "";
      draw();
    }
    page.querySelector("[data-ad-clear]").addEventListener("click", clearFilters);
    body.addEventListener("click", function (e) {
      if (e.target.closest("[data-ad-clear2]")) { clearFilters(); return; }
      var d = e.target.closest("[data-ad-del]");
      if (d) confirmDelete(d.getAttribute("data-ad-del"), draw);
    });

    draw();
  }

  /* Product delete goes straight to the server: the contract gives products
     their own DELETE route precisely so it can report which images are left
     orphaned. That means it is NOT undoable from the working copy, so the
     dialog says so rather than promising an Undo it cannot honour. */
  function confirmDelete(id, after) {
    var i = findIndex(id);
    if (i < 0) return;
    var p = products()[i];

    FCA.ui.confirmDelete({
      title: "Delete this product?",
      recordHTML: thumbHTML(p) + '<div><div class="ad-cell-main">' + esc(p.name) + "</div>" +
                  '<div class="ad-cell-sub">' + esc(p.sku) + "</div></div>",
      consequence: "It disappears from the shop, the New Arrivals grid and any customer's saved " +
                   "wishlist. <strong>This one is saved immediately and cannot be undone here</strong> " +
                   "— a backup is taken on the server first.",
      confirmLabel: "Delete product"
    }).then(function (yes) {
      if (!yes) return;
      FCA.ui.setStatus("saving", "Deleting…");
      return api.deleteProduct(id).then(function (res) {
        products().splice(i, 1);
        FCA.state.baseline.products = JSON.stringify(products());
        FCA.app.refreshNavDots();
        FCA.ui.setStatus("saved", "Saved " + FCA.util.timeNow());
        FCA.ui.toast("Product deleted.");
        if ((res.orphanedImages || []).length) {
          FCA.ui.banner({
            tag: "orphans", kind: "ok",
            title: FCA.util.plural(res.orphanedImages.length, "photo is", "photos are") + " no longer used by any product.",
            bodyHTML: " They were left on the server on purpose — a stale photo harms nothing, a " +
              "wrongly deleted one does. <ul class=\"ad-confirm-list\">" +
              res.orphanedImages.map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ul>",
            actions: [{ label: "Dismiss", kind: "outline", onClick: function (n) { n.parentNode.removeChild(n); } }]
          });
        }
        if (after) after();
      }).catch(function (err) {
        FCA.ui.setStatus("failed", "Not saved");
        FCA.app.handleSaveError(err, function () { confirmDelete(id, after); });
      });
    });
  }

  /* ======================================================================
     editor
     ====================================================================== */

  /* Stored shape for a brand-new product. price/priceMin/priceMax are
     deliberately ABSENT (not ""), matching a real stored product: isRange()
     tests `priceMin != null`, and an empty string is not null, so leaving
     these as "" here made every new product open in Range mode instead of
     Fixed. */
  function blankProduct() {
    return {
      id: "", sku: "", name: "", category: "", categoryLabel: "", sub: "",
      series: "", brand: "",
      variable: false, badge: "", gallery: [], options: [], swatchesOn: false,
      short: "", material: "", dimensions: "", warranty: ""
    };
  }

  /* stored shape -> form shape */
  function toForm(p) {
    var options = [];
    Object.keys(p.options || {}).forEach(function (k) {
      options.push({
        name: k,
        shared: p.options[k] === "@bedSizes",
        values: resolveList(p.options[k])
      });
    });
    return {
      id: p.id || "", sku: p.sku || "", name: p.name || "",
      category: p.category || "", categoryLabel: p.categoryLabel || "",
      sub: p.sub || "", series: p.series || "", brand: p.brand || "",
      priceType: isRange(p) ? "range" : "fixed",
      price: p.price != null ? String(p.price) : "",
      priceMin: p.priceMin != null ? String(p.priceMin) : "",
      priceMax: p.priceMax != null ? String(p.priceMax) : "",
      variable: !!p.variable,
      badge: p.badge || "",
      gallery: (p.gallery && p.gallery.length) ? p.gallery.slice() : (p.image ? [p.image] : []),
      options: options,
      swatchesOn: p.swatches != null,
      short: p.short || "", material: p.material || "",
      dimensions: p.dimensions || "", warranty: p.warranty || ""
    };
  }

  /* form shape -> stored shape.
     Only known keys are emitted (the server rejects unknown ones outright),
     empty optionals are omitted, and the unused price keys are DELETED
     rather than sent as null. */
  function toStored(v) {
    var out = {
      id: v.id.trim(),
      sku: v.sku.trim(),
      name: v.name.trim(),
      category: v.category,
      categoryLabel: v.categoryLabel.trim()
    };

    if (v.priceType === "range") {
      out.priceMin = Number(v.priceMin);
      out.priceMax = Number(v.priceMax);
      /* `price` is deliberately absent, not null: a product holding both
         renders a range and charges the fixed price. */
    } else {
      out.price = Number(v.price);
    }

    if (v.sub.trim()) out.sub = v.sub.trim();
    if (v.series) out.series = v.series;
    if (v.brand) out.brand = v.brand;
    if (v.badge.trim()) out.badge = v.badge.trim();

    /* image is derived from gallery[0] — never a second field to desync */
    if (v.gallery.length) {
      out.image = v.gallery[0];
      out.gallery = v.gallery.slice();
    }

    var groups = (v.options || []).filter(function (g) {
      return g.name.trim() && (g.shared || g.values.length);
    });
    if (v.variable) out.variable = true;
    if (groups.length) {
      out.options = {};
      groups.forEach(function (g) {
        out.options[g.name.trim()] = g.shared ? "@bedSizes" : g.values.slice();
      });
      /* swatches must be a subset of an option's values, so it mirrors the
         first group — including the shared reference, so the sharing is kept */
      if (v.swatchesOn) out.swatches = groups[0].shared ? "@bedSizes" : groups[0].values.slice();
    }

    ["short", "material", "dimensions", "warranty"].forEach(function (k) {
      if (v[k] && v[k].trim()) out[k] = v[k].trim();
    });
    return out;
  }

  function renderEditor(host, id) {
    var isNew = !id;
    var index = isNew ? -1 : findIndex(id);
    if (!isNew && index < 0) {
      host.innerHTML = '<div class="ad-page"><div class="ad-empty">' + FCA.util.icon("box") +
        "<h2>That product is not here any more</h2>" +
        '<a class="fc-btn" href="#/products">Back to the list</a></div></div>';
      return;
    }

    var v = isNew ? toForm(blankProduct()) : toForm(products()[index]);
    var idTouched = !isNew;     /* auto-slug the id from the name until she edits it */
    var dirty = isNew;

    var page = document.createElement("div");
    page.className = "ad-page";
    page.innerHTML =
      '<div class="ad-page-head"><div>' +
        '<h1 class="ad-page-title" data-ad-h1>' + esc(isNew ? "New product" : v.name) + "</h1>" +
        '<p class="ad-page-sub">Products › ' + (isNew ? "New" : "Edit") + "</p>" +
      "</div></div>" +
      '<div class="ad-editor">' +
        '<div class="ad-editor-main">' +
          '<fieldset class="ad-fieldset" data-fs="basics"><legend class="ad-fieldset-legend">1 · Basics</legend></fieldset>' +
          '<fieldset class="ad-fieldset" data-fs="price"><legend class="ad-fieldset-legend">2 · Price</legend></fieldset>' +
          '<fieldset class="ad-fieldset" data-fs="photos"><legend class="ad-fieldset-legend">3 · Photos</legend></fieldset>' +
          '<fieldset class="ad-fieldset" data-fs="options"><legend class="ad-fieldset-legend">4 · Options</legend></fieldset>' +
          '<fieldset class="ad-fieldset" data-fs="details"><legend class="ad-fieldset-legend">5 · Details</legend></fieldset>' +
        "</div>" +
        '<aside class="ad-editor-side" data-ad-side></aside>' +
      "</div>";

    host.innerHTML = "";
    host.appendChild(page);

    var errors = {};   /* key -> message */

    function touch() {
      if (!dirty) { dirty = true; }
      FCA.state.dirty.products = true;
      FCA.ui.refreshStatus();
      FCA.app.refreshNavDots();
      FCA.fields.setSaveBarStatus(bar, "dirty", "Unsaved changes");
      drawSide();
    }

    function fieldWrap(key, label, inner, help, opts) {
      opts = opts || {};
      return '<div class="fc-field" data-f="' + key + '"' + (opts.full ? ' style="grid-column:1/-1"' : "") + ">" +
        '<label class="fc-label" for="ad-f-' + key + '">' + esc(label) +
          (opts.required ? ' <span class="ad-req" title="required">*</span>' : "") + "</label>" +
        inner +
        (help ? '<p class="ad-help">' + help + "</p>" : "") +
        '<span class="ad-fielderr" id="ad-e-' + key + '" hidden></span>' +
      "</div>";
    }
    function input(key, value, attrs) {
      return '<input class="fc-input" id="ad-f-' + key + '" data-k="' + key + '" value="' + esc(value) + '" ' +
        (attrs || "") + ' aria-describedby="ad-e-' + key + '">';
    }
    function select(key, value, options, attrs) {
      return '<select class="fc-select" id="ad-f-' + key + '" data-k="' + key + '" ' + (attrs || "") +
        ' aria-describedby="ad-e-' + key + '">' +
        options.map(function (o) {
          var ov = typeof o === "string" ? o : o.value;
          var ol = typeof o === "string" ? o : o.label;
          return '<option value="' + esc(ov) + '"' + (String(ov) === String(value) ? " selected" : "") + ">" + esc(ol) + "</option>";
        }).join("") + "</select>";
    }

    function setError(key, message) {
      errors[key] = message;
      var el = page.querySelector("#ad-e-" + key);
      var input = page.querySelector("#ad-f-" + key);
      if (el) { el.hidden = false; el.innerHTML = '<span aria-hidden="true">!</span> ' + esc(message); }
      if (input) input.setAttribute("aria-invalid", "true");
    }
    function clearError(key) {
      delete errors[key];
      var el = page.querySelector("#ad-e-" + key);
      var input = page.querySelector("#ad-f-" + key);
      if (el) { el.hidden = true; el.textContent = ""; }
      if (input) input.removeAttribute("aria-invalid");
    }
    function clearAllErrors() { Object.keys(errors).slice().forEach(clearError); }

    /* ---------------- 1 · Basics ---------------- */
    function drawBasics() {
      var fs = page.querySelector('[data-fs="basics"]');
      var cats = (FCA.state.doc.categories || []).map(function (c) { return { value: c.slug, label: c.label }; });
      var menuCats = (FCA.state.doc.menu || []).map(function (m) {
        return { value: FCA.util.slug(m.label), label: m.label + " (menu)" };
      }).filter(function (m) {
        return !cats.some(function (c) { return c.value === m.value; });
      });
      var brands = (FCA.state.doc.brands || []).map(function (b) { return { value: b.slug, label: b.name }; });
      var sers = (FCA.state.doc.series || []).map(function (s) { return { value: s.slug, label: s.title || s.slug }; });

      /* every sub slug already used anywhere in the menu, so she picks rather
         than invents */
      var subs = {};
      (FCA.state.doc.menu || []).forEach(function (m) {
        (m.groups || []).forEach(function (g) {
          (g.items || []).forEach(function (l) {
            var mt = /[?&]sub=([^&#]+)/.exec(l.href || "");
            if (mt) subs[decodeURIComponent(mt[1])] = true;
          });
        });
      });
      (products() || []).forEach(function (p) { if (p.sub) subs[p.sub] = true; });

      fs.innerHTML = '<legend class="ad-fieldset-legend">1 · Basics</legend>' +
        fieldWrap("name", "Product name", input("name", v.name, 'maxlength="120"'), null, { full: true, required: true }) +
        '<div class="ad-grid-2">' +
          fieldWrap("id", "Web address (id)",
            input("id", v.id, isNew ? 'maxlength="64"' : "readonly"),
            isNew
              ? "Used in the product link: <code>product.html?id=sof-7010p</code>. Filled in from the name until you change it."
              : "This cannot be changed after a product exists — it is the link customers save and the key their cart uses.",
            { required: true }) +
          fieldWrap("sku", "SKU", input("sku", v.sku, 'maxlength="40"'), null, { required: true }) +
          fieldWrap("category", "Category", select("category", v.category,
            [{ value: "", label: "— choose —" }].concat(cats).concat(menuCats)), null, { required: true }) +
          fieldWrap("categoryLabel", "Category label on the card", input("categoryLabel", v.categoryLabel, 'maxlength="40"'),
            "Shown under the product name. Often shorter than the category name.", { required: true }) +
          fieldWrap("brand", "Brand", select("brand", v.brand, [{ value: "", label: "— none —" }].concat(brands))) +
          fieldWrap("sub", "Sub-category", input("sub", v.sub, 'list="ad-subs" maxlength="60"'),
            "Matches the menu link the product sits under.") +
          fieldWrap("series", "Series", select("series", v.series, [{ value: "", label: "— none —" }].concat(sers))) +
          fieldWrap("badge", "Badge", input("badge", v.badge, 'list="ad-badges" maxlength="12"'),
            "A small label on the card, like New or Sale. Leave empty for none.") +
        "</div>" +
        '<datalist id="ad-subs">' + Object.keys(subs).map(function (s) { return '<option value="' + esc(s) + '">'; }).join("") + "</datalist>" +
        '<datalist id="ad-badges"><option value="New"><option value="Sale"></datalist>';
    }

    /* ---------------- 2 · Price ----------------
       Radio CARDS, not a select: the choice changes the form, so it has to be
       visible without opening anything. Exactly one panel is in the DOM at a
       time, so a hidden input can never be submitted. */
    function drawPrice() {
      var fs = page.querySelector('[data-fs="price"]');
      var isR = v.priceType === "range";

      fs.innerHTML = '<legend class="ad-fieldset-legend">2 · Price</legend>' +
        '<div class="ad-radio-cards" role="radiogroup" aria-label="Price type">' +
          '<label class="ad-radio-card' + (!isR ? " is-on" : "") + '">' +
            '<input type="radio" name="ad-ptype" value="fixed"' + (!isR ? " checked" : "") + ">" +
            "<span><b>One price</b><span>e.g. " + FCA.util.money(23500) + " — shown as a single price</span></span>" +
          "</label>" +
          '<label class="ad-radio-card' + (isR ? " is-on" : "") + '">' +
            '<input type="radio" name="ad-ptype" value="range"' + (isR ? " checked" : "") + ">" +
            "<span><b>Price range</b><span>e.g. " + FCA.util.money(8600) + " – " + FCA.util.money(45100) +
            " — shown as “from – to”</span></span>" +
          "</label>" +
        "</div>" +
        (isR
          ? '<div class="ad-range">' +
              '<div class="fc-field" data-f="priceMin" style="margin:0">' +
                '<label class="fc-label" for="ad-f-priceMin">Lowest price <span class="ad-req">*</span></label>' +
                '<div class="ad-money">' + input("priceMin", v.priceMin, 'inputmode="numeric"') + "</div>" +
                '<span class="ad-fielderr" id="ad-e-priceMin" hidden></span>' +
              "</div>" +
              '<div class="ad-range-dash" aria-hidden="true">–</div>' +
              '<div class="fc-field" data-f="priceMax" style="margin:0">' +
                '<label class="fc-label" for="ad-f-priceMax">Highest price <span class="ad-req">*</span></label>' +
                '<div class="ad-money">' + input("priceMax", v.priceMax, 'inputmode="numeric"') + "</div>" +
                '<span class="ad-fielderr" id="ad-e-priceMax" hidden></span>' +
              "</div>" +
            "</div>" +
            '<p class="ad-echo" data-ad-echo></p>'
          : '<div class="fc-field" data-f="price" style="max-width:280px">' +
              '<label class="fc-label" for="ad-f-price">Price <span class="ad-req">*</span></label>' +
              '<div class="ad-money">' + input("price", v.price, 'inputmode="numeric"') + "</div>" +
              '<span class="ad-fielderr" id="ad-e-price" hidden></span>' +
              '<p class="ad-echo" data-ad-echo></p>' +
            "</div>") +
        '<p class="ad-help" data-ad-switchnote hidden></p>';

      drawEcho();
    }

    function drawEcho() {
      var echo = page.querySelector("[data-ad-echo]");
      if (!echo) return;
      if (v.priceType === "range") {
        var a = Number(v.priceMin), b = Number(v.priceMax);
        echo.innerHTML = (isFinite(a) && isFinite(b) && v.priceMin !== "" && v.priceMax !== "")
          ? "Shows as <b>" + FCA.util.money(a) + " – " + FCA.util.money(b) + "</b>"
          : "Shows as <b>from – to</b> on the card.";
      } else {
        var n = Number(v.price);
        echo.innerHTML = (isFinite(n) && v.price !== "")
          ? "Shows as <b>" + FCA.util.money(n) + "</b>"
          : "Shows as a single price on the card.";
      }
    }

    /* ---------------- 3 · Photos ---------------- */
    var gallery = null;
    function drawPhotos() {
      var fs = page.querySelector('[data-fs="photos"]');
      fs.innerHTML = '<legend class="ad-fieldset-legend">3 · Photos</legend>' +
        '<div class="fc-field" data-f="gallery"><div data-ad-gal></div>' +
        '<span class="ad-fielderr" id="ad-e-gallery" hidden></span></div>';
      gallery = FCA.images.mount(fs.querySelector("[data-ad-gal]"), {
        folder: "product",
        multi: true,
        value: v.gallery,
        onChange: function (paths) {
          v.gallery = paths;
          clearError("gallery");
          touch();
        }
      });
    }

    /* ---------------- 4 · Options ----------------
       Independent of the price control above. Off by default for a new
       product; `variable` and `options` are simply omitted when off. */
    function drawOptions() {
      var fs = page.querySelector('[data-fs="options"]');
      var shared = sharedList();
      var sharedLabel = shared.length ? "Use the Bed sizes list (" + shared.join(", ") + ")" : "Use the Bed sizes list";

      fs.innerHTML = '<legend class="ad-fieldset-legend">4 · Options</legend>' +
        '<label class="ad-switch"><input type="checkbox" data-ad-variable' + (v.variable ? " checked" : "") + ">" +
          "<span><b>Buyer chooses an option (size, finish, doors…)</b>" +
          '<span class="ad-help" style="margin:2px 0 0">Turn this on when the same product comes in ' +
          "several versions. The buyer picks one on the product page. This is separate from the price " +
          "above — a product can have options and still be one price.</span></span></label>" +
        (v.variable ? '<div data-ad-groups></div>' +
          '<button class="fc-btn fc-btn-sm fc-btn-outline" type="button" data-ad-addgroup style="margin-top:6px">' +
          "＋ Add another option</button>" +
          '<div data-ad-swatches style="margin-top:16px"></div>' +
          '<div data-ad-crossnote></div>' : "");

      if (!v.variable) return;

      var groupsHost = fs.querySelector("[data-ad-groups]");
      groupsHost.innerHTML = "";

      if (!v.options.length) v.options.push({ name: "", shared: false, values: [] });

      v.options.forEach(function (g, gi) {
        var row = document.createElement("div");
        row.className = "ad-repeat-row";
        row.innerHTML =
          '<div class="ad-repeat-head"><b>Option ' + (gi + 1) + "</b>" +
            '<div class="ad-rowactions">' +
              '<button type="button" class="ad-iconbtn ad-iconbtn-danger" data-ad-delgroup="' + gi + '" ' +
                'title="Remove this option" aria-label="Remove option ' + (gi + 1) + '">' + FCA.util.icon("trash") + "</button>" +
            "</div></div>" +
          '<div class="fc-field"><label class="fc-label" for="ad-og-' + gi + '">Option name</label>' +
            '<input class="fc-input" id="ad-og-' + gi + '" list="ad-optnames" value="' + esc(g.name) + '" data-ad-gname="' + gi + '">' +
            '<span class="ad-fielderr" data-ad-gerr="' + gi + '" hidden></span></div>' +
          '<label class="fc-label">Choices</label>' +
          '<div data-ad-gvals="' + gi + '"></div>' +
          '<div class="ad-srcpick">' +
            '<label class="fc-checkbox"><input type="radio" name="ad-src-' + gi + '" value="custom"' +
              (g.shared ? "" : " checked") + "> Custom list</label>" +
            '<label class="fc-checkbox"><input type="radio" name="ad-src-' + gi + '" value="shared"' +
              (g.shared ? " checked" : "") + "> " + esc(sharedLabel) + "</label>" +
          "</div>" +
          (g.shared ? '<p class="ad-help">These come from the shared list. ' +
            '<a href="#/bedsizes">Edit the Bed sizes list →</a></p>' : "");

        groupsHost.appendChild(row);

        var tags = FCA.fields.tagInput(row.querySelector('[data-ad-gvals="' + gi + '"]'), {
          value: g.shared ? shared : g.values,
          label: g.name || "this option",
          placeholder: "Type a choice and press Enter",
          locked: g.shared,
          onChange: function (vals) { g.values = vals; touch(); }
        });

        row.querySelectorAll('input[name="ad-src-' + gi + '"]').forEach(function (r) {
          r.addEventListener("change", function () {
            g.shared = r.value === "shared";
            /* keep what can be kept: coming off the shared list, the values
               she saw stay as a starting point */
            if (!g.shared && !g.values.length) g.values = shared.slice();
            touch();
            drawOptions();
          });
        });
      });

      if (!fs.querySelector("#ad-optnames")) {
        var dl = document.createElement("datalist");
        dl.id = "ad-optnames";
        dl.innerHTML = '<option value="Size"><option value="Finish"><option value="Doors"><option value="Seat">';
        fs.appendChild(dl);
      }

      /* swatches: only meaningful once a group exists */
      var sw = fs.querySelector("[data-ad-swatches]");
      var first = v.options[0];
      sw.innerHTML = '<label class="fc-checkbox"><input type="checkbox" data-ad-swon' +
        (v.swatchesOn ? " checked" : "") + (first && (first.shared || first.values.length) ? "" : " disabled") +
        "> Show these choices as buttons on the product card</label>" +
        '<p class="ad-help">Uses the first option’s choices. The shop page filters on these.</p>';

      /* the cross-field note she should see exactly once */
      var note = fs.querySelector("[data-ad-crossnote]");
      note.innerHTML = (v.priceType === "range")
        ? '<div class="fc-notice" style="margin-top:18px">With a price range, the price a buyer sees ' +
          "changes with their choice — the first choice costs the lowest price, the last one the " +
          "highest. Put the choices in order, cheapest first.</div>"
        : "";
    }

    /* ---------------- 5 · Details ---------------- */
    function drawDetails() {
      var fs = page.querySelector('[data-fs="details"]');
      var warranties = {};
      products().forEach(function (p) { if (p.warranty) warranties[p.warranty] = true; });

      fs.innerHTML = '<legend class="ad-fieldset-legend">5 · Details</legend>' +
        '<div class="fc-field" data-f="short">' +
          '<label class="fc-label" for="ad-f-short">Short description</label>' +
          '<textarea class="fc-textarea" id="ad-f-short" data-k="short" rows="3" maxlength="600" ' +
            'aria-describedby="ad-e-short">' + esc(v.short) + "</textarea>" +
          '<p class="ad-help"><span data-ad-count-short></span> of 600 characters</p>' +
          '<span class="ad-fielderr" id="ad-e-short" hidden></span>' +
        "</div>" +
        '<div class="ad-grid-2">' +
          fieldWrap("material", "Material", input("material", v.material, 'maxlength="200"')) +
          fieldWrap("dimensions", "Dimensions", input("dimensions", v.dimensions, 'maxlength="120"'),
            'Like <code>W 36" x D 18" x H 68"</code>. Straight quotes are fine.') +
          fieldWrap("warranty", "Warranty", input("warranty", v.warranty, 'list="ad-warr" maxlength="120"')) +
        "</div>" +
        '<datalist id="ad-warr">' + Object.keys(warranties).map(function (w) { return '<option value="' + esc(w) + '">'; }).join("") + "</datalist>";

      updateShortCount();
    }

    function updateShortCount() {
      var c = page.querySelector("[data-ad-count-short]");
      if (c) c.textContent = String((v.short || "").length);
    }

    /* ---------------- side: live preview ---------------- */
    function drawSide() {
      var side = page.querySelector("[data-ad-side]");
      var main = v.gallery[0];
      var priceHTML = v.priceType === "range"
        ? (v.priceMin !== "" && v.priceMax !== ""
            ? FCA.util.money(v.priceMin) + " – " + FCA.util.money(v.priceMax) : "—")
        : (v.price !== "" ? FCA.util.money(v.price) : "—");

      side.innerHTML =
        '<div class="ad-card" style="overflow:hidden">' +
          '<div class="ad-card-head"><h2>How it will look</h2></div>' +
          '<div class="ad-preview-shot">' +
            (main ? '<img src="' + esc(api.assetURL(main)) + '" alt="">' : "main photo<br>1 : 1") +
          "</div>" +
          '<div class="ad-preview-body">' +
            '<span class="ad-preview-cat">' + esc(v.categoryLabel || "—") + "</span>" +
            '<p class="ad-preview-name">' + esc(v.name || "Product name") + "</p>" +
            '<p class="ad-preview-price">' + priceHTML + "</p>" +
          "</div>" +
        "</div>" +
        '<div class="ad-card"><div class="ad-card-head"><h2>Where this appears</h2></div>' +
          '<div class="ad-card-body"><ul class="ad-where">' +
            "<li>Home › New Arrivals</li>" +
            "<li>Shop › " + esc(v.categoryLabel || v.category || "—") + "</li>" +
            (v.series ? "<li>Shop › series “" + esc(v.series) + "”</li>" : "") +
            "<li>Its own page <code>?id=" + esc(v.id || "…") + "</code></li>" +
          "</ul></div></div>";
    }

    /* ---------------- wiring ---------------- */
    page.addEventListener("input", function (e) {
      var t = e.target;
      var k = t.getAttribute && t.getAttribute("data-k");
      if (k) {
        v[k] = t.value;
        if (k === "name" && !idTouched) {
          v.id = FCA.util.slug(t.value).slice(0, 64);
          var idEl = page.querySelector("#ad-f-id");
          if (idEl) idEl.value = v.id;
        }
        if (k === "id") idTouched = true;
        if (k === "short") updateShortCount();
        if (k === "price" || k === "priceMin" || k === "priceMax") drawEcho();
        var h1 = page.querySelector("[data-ad-h1]");
        if (k === "name" && h1) h1.textContent = v.name || "New product";
        clearError(k);
        touch();
        return;
      }
      var gn = t.getAttribute && t.getAttribute("data-ad-gname");
      if (gn != null) { v.options[Number(gn)].name = t.value; touch(); }
    });

    page.addEventListener("change", function (e) {
      var t = e.target;
      if (t.name === "ad-ptype") {
        var was = v.priceType;
        v.priceType = t.value;
        /* keep whatever can be kept, and warn once that the other price goes */
        if (was === "fixed" && v.priceType === "range" && v.price && !v.priceMin) v.priceMin = v.price;
        if (was === "range" && v.priceType === "fixed" && v.priceMin && !v.price) v.price = v.priceMin;
        drawPrice();
        var note = page.querySelector("[data-ad-switchnote]");
        if (note) {
          note.hidden = false;
          note.textContent = v.priceType === "range"
            ? "The single price will be removed when you save."
            : "The lowest and highest prices will be removed when you save.";
        }
        drawOptions();
        touch();
        return;
      }
      if (t.hasAttribute && t.hasAttribute("data-ad-variable")) {
        v.variable = t.checked;
        if (!v.variable) v.swatchesOn = false;
        drawOptions();
        touch();
        return;
      }
      if (t.hasAttribute && t.hasAttribute("data-ad-swon")) {
        v.swatchesOn = t.checked;
        touch();
        return;
      }
      var k = t.getAttribute && t.getAttribute("data-k");
      if (k === "category") {
        /* prefill the card label from the chosen category, but leave it
           editable: the data really does use "Living" on products while the
           tile says "Living Room" */
        var cat = (FCA.state.doc.categories || []).filter(function (c) { return c.slug === t.value; })[0];
        if (cat && !v.categoryLabel) {
          v.categoryLabel = cat.label;
          var el = page.querySelector("#ad-f-categoryLabel");
          if (el) el.value = cat.label;
        }
      }
    });

    page.addEventListener("click", function (e) {
      var b = e.target.closest("button");
      if (!b) return;
      if (b.hasAttribute("data-ad-addgroup")) {
        if (v.options.length >= (meta().limits && meta().limits.maxOptions || 6)) {
          FCA.ui.toast("That is the maximum number of options.");
          return;
        }
        v.options.push({ name: "", shared: false, values: [] });
        drawOptions();
        touch();
        return;
      }
      var g = b.getAttribute("data-ad-delgroup");
      if (g != null) {
        var gi = Number(g);
        var group = v.options[gi];
        var go = (group.values.length || group.shared)
          ? FCA.ui.confirmDelete({
              title: "Remove this option?",
              consequence: "Buyers will no longer choose " + esc(group.name || "this option") + " on the product page.",
              confirmLabel: "Remove option"
            })
          : Promise.resolve(true);
        go.then(function (yes) {
          if (!yes) return;
          v.options.splice(gi, 1);
          if (!v.options.length) v.swatchesOn = false;
          drawOptions();
          touch();
        });
      }
    });

    /* blur validation, per field */
    page.addEventListener("blur", function (e) {
      var k = e.target.getAttribute && e.target.getAttribute("data-k");
      if (!k) return;
      var msg = validateField(k);
      if (msg) setError(k, msg); else clearError(k);
    }, true);

    /* ---------------- validation ---------------- */
    var LABELS = {
      name: "Product name", id: "Web address (id)", sku: "SKU", category: "Category",
      categoryLabel: "Category label", sub: "Sub-category", badge: "Badge",
      price: "Price", priceMin: "Lowest price", priceMax: "Highest price",
      gallery: "Photos", short: "Short description", material: "Material",
      dimensions: "Dimensions", warranty: "Warranty"
    };

    function num(s) { return s === "" || s == null ? NaN : Number(s); }

    function validateField(k) {
      var val = v[k];
      if (typeof val === "string") {
        var ang = FCA.fields.checkAngle(val);
        if (ang) return ang;
      }
      switch (k) {
        case "name":
          if (!val.trim()) return "Give the product a name.";
          if (val.trim().length < 2) return "That name is too short.";
          if (val.length > 120) return "That name is too long.";
          return null;
        case "id":
          if (!val.trim()) return "The web address cannot be empty.";
          if (!FCA.fields.RE.productId.test(val.trim()))
            return "Use lower-case letters, numbers and hyphens only, like sof-7010p.";
          if (isNew && products().some(function (p) { return p.id === val.trim(); }))
            return "Another product already uses the web address " + val.trim() + ".";
          return null;
        case "sku":
          if (!val.trim()) return "Give the product an SKU.";
          if (val.trim().length > 40) return "An SKU can be at most 40 characters.";
          if (!FCA.fields.RE.sku.test(val.trim())) return "An SKU can use letters, numbers, spaces and . / - only.";
          return null;
        case "category":
          if (!val) return "Choose a category.";
          return null;
        case "categoryLabel":
          if (!val.trim()) return "Fill in the label shown on the card.";
          if (val.length > 40) return "That label is too long.";
          return null;
        case "sub":
          if (val && !FCA.fields.RE.sub.test(val.trim()))
            return "Use lower-case letters, numbers and hyphens only.";
          return null;
        case "badge":
          if (val && val.length > 12) return "A badge can be at most 12 characters.";
          return null;
        case "price":
          if (v.priceType !== "fixed") return null;
          var p = num(val);
          if (!isFinite(p)) return "Enter a price, like 23500.";
          if (p <= 0) return "A price must be more than zero.";
          if (p > 100000000) return "That price is too large.";
          return null;
        case "priceMin":
          if (v.priceType !== "range") return null;
          var a = num(val);
          if (!isFinite(a)) return "Enter the lowest price.";
          if (a <= 0) return "A price must be more than zero.";
          return null;
        case "priceMax":
          if (v.priceType !== "range") return null;
          var b = num(val);
          if (!isFinite(b)) return "Enter the highest price.";
          if (b <= 0) return "A price must be more than zero.";
          var mn = num(v.priceMin);
          if (isFinite(mn) && b <= mn) return "The highest price must be larger than the lowest.";
          return null;
        case "short":
          if (val && val.length > 600) return "That description is too long.";
          return null;
        case "material":
          if (val && val.length > 200) return "That is too long.";
          return null;
        case "dimensions":
        case "warranty":
          if (val && val.length > 120) return "That is too long.";
          return null;
        default:
          return null;
      }
    }

    function validateAll() {
      clearAllErrors();
      var list = [];
      ["name", "id", "sku", "category", "categoryLabel", "sub", "badge",
       "price", "priceMin", "priceMax", "short", "material", "dimensions", "warranty"].forEach(function (k) {
        var msg = validateField(k);
        if (msg) { setError(k, msg); list.push({ key: k, label: LABELS[k] || k, message: msg }); }
      });

      if (!v.gallery.length) {
        setError("gallery", "Add at least one photo.");
        list.push({ key: "gallery", label: "Photos", message: "Add at least one photo." });
      }

      if (v.variable) {
        v.options.forEach(function (g, gi) {
          var errEl = page.querySelector('[data-ad-gerr="' + gi + '"]');
          var vals = g.shared ? sharedList() : g.values;
          var msg = null;
          if (!g.name.trim() && vals.length) msg = "Give this option a name, like Size.";
          else if (g.name.trim() && !/^[A-Za-z][A-Za-z0-9 ]*$/.test(g.name.trim()))
            msg = "An option name must start with a letter and use letters, numbers and spaces only.";
          else if (g.name.trim() && vals.length < 2) msg = "An option needs at least two choices.";
          if (errEl) {
            errEl.hidden = !msg;
            if (msg) errEl.innerHTML = '<span aria-hidden="true">!</span> ' + esc(msg);
          }
          if (msg) list.push({ key: "option-" + gi, label: "Option " + (gi + 1), message: msg });
        });
      }
      return list;
    }

    /* ---------------- save bar ---------------- */
    var bar = FCA.fields.saveBar({
      onBack: function () { FCA.app.navigate("#/products"); },
      onSave: doSave,
      onDelete: isNew ? null : function () { confirmDelete(v.id, function () { FCA.app.navigate("#/products"); }); }
    });

    function doSave() {
      FCA.ui.clearBanners("validation");
      var problems = validateAll();
      if (problems.length) {
        FCA.ui.banner({
          tag: "validation", kind: "error",
          title: FCA.util.plural(problems.length, "field needs", "fields need") + " attention.",
          bodyHTML: " " + problems.map(function (p) { return esc(p.label); }).join(" · ")
        });
        focusFirstError();
        return;
      }
      if (gallery && gallery.isBusy()) {
        FCA.ui.toast("A photo is still uploading. Wait for it to finish.");
        return;
      }

      var item = toStored(v);
      FCA.fields.setSaving(bar, true);
      FCA.fields.setSaveBarStatus(bar, "saving", "Saving…");
      FCA.ui.setStatus("saving", "Saving…");

      var call = isNew ? api.createProduct(item) : api.updateProduct(v.id, item);

      call.then(function (res) {
        if (isNew) products().push(item);
        else products()[findIndex(v.id)] = item;
        FCA.state.baseline.products = JSON.stringify(products());
        delete FCA.state.dirty.products;
        dirty = false;

        FCA.fields.setSaving(bar, false);
        FCA.fields.setSaveBarStatus(bar, "clean", "All changes saved");
        FCA.ui.setStatus("saved", "Saved " + FCA.util.timeNow());
        FCA.ui.toast("Product saved.");
        FCA.app.refreshNavDots();
        FCA.app.showWarnings(res.warnings);

        /* a new record becomes an edit, so a second Save updates rather than
           creating a duplicate */
        if (isNew) FCA.app.navigate("#/products/edit/" + encodeURIComponent(item.id));
      }).catch(function (err) {
        FCA.fields.setSaving(bar, false);
        FCA.fields.setSaveBarStatus(bar, "failed", "Could not save");
        FCA.ui.setStatus("failed", "Not saved");

        if (err.status === 400 && err.fields) {
          var painted = [];
          Object.keys(err.fields).forEach(function (pointer) {
            var key = pointer.split("/").pop();
            if (LABELS[key]) { setError(key, err.fields[pointer]); painted.push(LABELS[key]); }
          });
          FCA.ui.banner({
            tag: "validation", kind: "error",
            title: "The server would not accept this.",
            bodyHTML: " " + esc(err.message) + (painted.length ? " — " + esc(painted.join(" · ")) : "") +
              '<ul class="ad-confirm-list">' + Object.keys(err.fields).map(function (k) {
                return "<li><code>" + esc(k) + "</code> — " + esc(err.fields[k]) + "</li>";
              }).join("") + "</ul>"
          });
          focusFirstError();
          return;
        }
        if (err.code === "duplicate_id") { setError("id", err.message); focusFirstError(); }
        FCA.app.handleSaveError(err, doSave);
      });
    }

    function focusFirstError() {
      var first = page.querySelector('[aria-invalid="true"], .ad-fielderr:not([hidden])');
      if (!first) return;
      var f = first.closest(".fc-field") || first;
      var input = f.querySelector("input, select, textarea");
      if (input) { try { input.focus({ preventScroll: true }); } catch (e) {} }
      var y = f.getBoundingClientRect().top + window.scrollY - 80;
      window.scrollTo({ top: Math.max(0, y), behavior: "smooth" });
    }

    /* ---------------- paint ---------------- */
    drawBasics();
    drawPrice();
    drawPhotos();
    drawOptions();
    drawDetails();
    drawSide();
    page.appendChild(bar);
    if (!isNew) {
      page.querySelector(".ad-editor-main").appendChild(
        FCA.fields.dangerZone("Delete this product", function () {
          confirmDelete(v.id, function () { FCA.app.navigate("#/products"); });
        })
      );
    }
    FCA.fields.setSaveBarStatus(bar, isNew ? "dirty" : "clean", isNew ? "Not saved yet" : "All changes saved");
  }

  FCA.products = { toStored: toStored, toForm: toForm };
})(window, document);
