/* ==========================================================================
   menu.js — the three-level menu tree editor.

   The tree has a FIXED depth of three and always will:
       menu item (MENU[])        label, href, cols, alignRight, promo{}
       └─ column (item.groups[]) title
          └─ link (group.items[]) label, href
   components.js:megaHTML renders exactly three levels. Every interaction
   below leans on that.

   No drag-and-drop (unusable at 360px, no keyboard story, ~200 lines of
   fragile pointer code) and no indent/outdent (in a fixed-depth tree
   "outdent" on a link would silently promote it into the site's navbar).
   Instead, three controls named after their outcome:
     ▲ ▼            reorder among siblings only
     "Move to…"     re-parent, choosing from a list that can only contain
                    legal parents, so the tree can never become invalid
     "Turn into …"  the two promote/demote moves that do make sense

   Everything edits the working copy; one PUT /api/admin/data/menu on Save.
   ========================================================================== */

(function (window, document) {
  "use strict";

  var FCA = window.FCA = window.FCA || {};
  var api = FCA.api;

  function esc(v) { return FCA.util.esc(v); }
  function menu() { return FCA.state.doc.menu || (FCA.state.doc.menu = []); }
  function limits() { return (FCA.state.meta && FCA.state.meta.limits) || {}; }

  var KIND = { 1: "Menu item", 2: "Column", 3: "Link" };
  var KIND_LETTER = { 1: "M", 2: "C", 3: "L" };
  var KIND_CLASS = { 1: "menu", 2: "column", 3: "link" };

  /* ---- path helpers: [i] | [i,g] | [i,g,l] ---- */
  function pathKey(p) { return p.join("-"); }
  function parsePath(k) { return String(k).split("-").map(Number).filter(function (n) { return !isNaN(n); }); }

  function nodeAt(p) {
    var m = menu()[p[0]];
    if (!m) return null;
    if (p.length === 1) return m;
    var g = (m.groups || [])[p[1]];
    if (!g) return null;
    if (p.length === 2) return g;
    return (g.items || [])[p[2]] || null;
  }
  function siblingsOf(p) {
    if (p.length === 1) return menu();
    if (p.length === 2) return menu()[p[0]].groups || (menu()[p[0]].groups = []);
    var g = menu()[p[0]].groups[p[1]];
    return g.items || (g.items = []);
  }
  function labelOf(node, level) { return level === 2 ? (node.title || "") : (node.label || ""); }
  function setLabel(node, level, value) { if (level === 2) node.title = value; else node.label = value; }

  function countLinks(item) {
    return (item.groups || []).reduce(function (n, g) { return n + (g.items || []).length; }, 0);
  }

  /* slug(label) must be unique across the top level: components.js writes
     data-nav="<slug>" and the active-nav query would match two items. */
  function topSlugCollisions() {
    var seen = {}, dup = {};
    menu().forEach(function (m) {
      var s = FCA.util.slug(m.label || "");
      if (seen[s]) dup[s] = true;
      seen[s] = true;
    });
    return dup;
  }

  /* ======================================================================
     page
     ====================================================================== */

  var view = {
    selected: null,       /* path array */
    expanded: {},         /* pathKey -> true */
    q: "",
    showAll: false,       /* phone: opt out of the accordion */
    sheetOpen: false
  };

  var phoneQuery = window.matchMedia("(max-width: 899px)");
  function isPhone() { return phoneQuery.matches; }

  FCA.app.register("menu", {
    render: function (host, route) {
      if (route.parts[0] === "node" && route.parts[1]) {
        var p = parsePath(route.parts[1]);
        if (nodeAt(p)) { view.selected = p; expandTo(p); view.sheetOpen = isPhone(); }
      } else {
        view.sheetOpen = false;
      }
      draw(host);
    }
  });

  function expandTo(p) {
    if (p.length >= 2) view.expanded[pathKey([p[0]])] = true;
    if (p.length >= 3) view.expanded[pathKey([p[0], p[1]])] = true;
  }

  function touch() {
    FCA.app.recomputeDirty("menu");
    FCA.app.refreshNavDots();
    if (bar) FCA.fields.setSaveBarStatus(bar, FCA.app.isDirty("menu") ? "dirty" : "clean",
      FCA.app.isDirty("menu") ? "Unsaved changes" : "All changes saved");
  }

  var bar = null;
  var hostEl = null;

  function draw(host) {
    hostEl = host || hostEl;
    var page = document.createElement("div");
    page.className = "ad-page";
    page.innerHTML =
      '<div class="ad-page-head"><div>' +
        '<h1 class="ad-page-title">Menu</h1>' +
        '<p class="ad-page-sub">The navigation bar and its drop-down panels. Three levels: ' +
        "<b>menu item → column → link</b>.</p>" +
      "</div>" +
      '<button class="fc-btn" type="button" data-ad-addmenu>＋ Add menu item</button></div>' +
      '<div class="ad-treelayout">' +
        '<div class="ad-card ad-tree">' +
          '<div class="ad-tree-toolbar">' +
            '<div class="ad-search">' + FCA.util.icon("search") +
              '<input class="fc-input" type="search" data-ad-q value="' + esc(view.q) + '" ' +
              'placeholder="Find a menu item" aria-label="Find in the menu">' +
            "</div>" +
            '<button class="fc-btn fc-btn-sm fc-btn-outline" type="button" data-ad-expand>Expand all</button>' +
            '<button class="fc-btn fc-btn-sm fc-btn-outline" type="button" data-ad-collapse>Collapse all</button>' +
            '<label class="fc-checkbox" style="margin-left:auto"><input type="checkbox" data-ad-showall' +
              (view.showAll ? " checked" : "") + "> Show all at once</label>" +
          "</div>" +
          '<div class="ad-tree-body" data-ad-tree></div>' +
        "</div>" +
        '<aside class="ad-inspector' + (view.sheetOpen ? " ad-sheet" : "") + '" data-ad-inspector></aside>' +
      "</div>";

    hostEl.innerHTML = "";
    hostEl.appendChild(page);

    bar = FCA.fields.saveBar({
      backLabel: "Dashboard",
      onBack: function () { FCA.app.navigate("#/"); },
      onSave: doSave
    });
    page.appendChild(bar);
    FCA.fields.setSaveBarStatus(bar, FCA.app.isDirty("menu") ? "dirty" : "clean",
      FCA.app.isDirty("menu") ? "Unsaved changes" : "All changes saved");

    page.querySelector("[data-ad-addmenu]").addEventListener("click", addMenuItem);
    page.querySelector("[data-ad-q]").addEventListener("input", FCA.util.debounce(function (e) {
      view.q = e.target.value.trim().toLowerCase();
      /* a search auto-expands its matches, or she cannot see them */
      if (view.q) menu().forEach(function (m, i) {
        view.expanded[pathKey([i])] = true;
        (m.groups || []).forEach(function (g, gi) { view.expanded[pathKey([i, gi])] = true; });
      });
      drawTree();
    }, 120));
    page.querySelector("[data-ad-expand]").addEventListener("click", function () {
      menu().forEach(function (m, i) {
        view.expanded[pathKey([i])] = true;
        (m.groups || []).forEach(function (g, gi) { view.expanded[pathKey([i, gi])] = true; });
      });
      drawTree();
    });
    page.querySelector("[data-ad-collapse]").addEventListener("click", function () {
      view.expanded = {};
      drawTree();
    });
    page.querySelector("[data-ad-showall]").addEventListener("change", function (e) {
      view.showAll = e.target.checked;
      drawTree();
    });

    drawTree();
    drawInspector();
  }

  /* ======================================================================
     the tree
     ====================================================================== */

  function matches(text) { return !view.q || String(text || "").toLowerCase().indexOf(view.q) >= 0; }

  function highlight(text) {
    if (!view.q) return esc(text);
    var s = String(text || "");
    var i = s.toLowerCase().indexOf(view.q);
    if (i < 0) return esc(s);
    return esc(s.slice(0, i)) + "<mark>" + esc(s.slice(i, i + view.q.length)) + "</mark>" + esc(s.slice(i + view.q.length));
  }

  function rowHTML(node, path, level, isFirst, isLast, expandable) {
    var key = pathKey(path);
    var open = !!view.expanded[key];
    var label = labelOf(node, level);
    var selected = view.selected && pathKey(view.selected) === key;

    var meta = "";
    if (level === 1) {
      meta = (node.groups || []).length + " col · " + countLinks(node) + " links";
      if (node.promo) meta += ' <span class="ad-pill">PROMO</span>';
      if (node.alignRight) meta += ' <span class="ad-pill">RIGHT</span>';
      if (topSlugCollisions()[FCA.util.slug(label)]) {
        meta += ' <span class="ad-pill ad-pill-warn" title="Two menu items make the same web name">⚠ same web name</span>';
      }
    } else if (level === 2) {
      meta = FCA.util.plural((node.items || []).length, "link", "links");
    } else {
      meta = (!node.href || node.href === "#")
        ? '<span class="ad-pill ad-pill-warn">⚠ no link</span>'
        : esc(String(node.href).slice(0, 34) + (String(node.href).length > 34 ? "…" : ""));
    }

    return '<div class="ad-tree-row lvl' + level + (selected ? " is-selected" : "") + '" ' +
      'role="treeitem" aria-level="' + level + '"' +
      (expandable ? ' aria-expanded="' + open + '"' : "") +
      ' aria-selected="' + (selected ? "true" : "false") + '" ' +
      'tabindex="' + (selected ? "0" : "-1") + '" data-ad-path="' + key + '">' +
      (expandable
        ? '<button type="button" class="ad-tree-twisty" data-ad-twisty="' + key + '" aria-expanded="' + open + '" ' +
          'aria-label="' + (open ? "Collapse " : "Expand ") + esc(label) + '">' + FCA.util.icon("chevron") + "</button>"
        : '<span class="ad-tree-leafdot" aria-hidden="true">·</span>') +
      '<span class="ad-tree-kind ad-tree-kind--' + KIND_CLASS[level] + '">' +
        '<span class="ad-kind-word">' + esc(KIND[level]) + "</span>" +
        '<span class="ad-kind-letter" aria-hidden="true">' + KIND_LETTER[level] + "</span>" +
      "</span>" +
      '<button type="button" class="ad-tree-label" data-ad-open="' + key + '">' + highlight(label || "(no name)") + "</button>" +
      '<span class="ad-tree-meta">' + meta + "</span>" +
      '<span class="ad-tree-move">' +
        '<button type="button" class="ad-iconbtn" data-ad-up="' + key + '"' + (isFirst ? " disabled aria-disabled=\"true\"" : "") +
          ' title="' + (isFirst ? "Already first" : "Move up") + '" aria-label="Move ' + esc(label) + ' up">' + FCA.util.icon("up") + "</button>" +
        '<button type="button" class="ad-iconbtn" data-ad-down="' + key + '"' + (isLast ? " disabled aria-disabled=\"true\"" : "") +
          ' title="' + (isLast ? "Already last" : "Move down") + '" aria-label="Move ' + esc(label) + ' down">' + FCA.util.icon("down") + "</button>" +
        '<button type="button" class="ad-iconbtn" data-ad-more="' + key + '" title="More actions" ' +
          'aria-label="More actions for ' + esc(label) + '" aria-haspopup="true">' + FCA.util.icon("more") + "</button>" +
      "</span>" +
    "</div>";
  }

  function drawTree() {
    var box = hostEl.querySelector("[data-ad-tree]");
    if (!box) return;
    var list = menu();
    if (!list.length) {
      box.innerHTML = '<div class="ad-empty">' + FCA.util.icon("box") +
        "<h2>The menu is empty</h2><p>Add a menu item to start building the navigation bar.</p></div>";
      return;
    }

    var html = "";
    var anyMatch = false;

    list.forEach(function (item, i) {
      var p1 = [i];
      var itemMatches = matches(item.label) ||
        (item.groups || []).some(function (g) {
          return matches(g.title) || (g.items || []).some(function (l) { return matches(l.label); });
        });
      if (view.q && !itemMatches) return;
      anyMatch = true;

      html += rowHTML(item, p1, 1, i === 0, i === list.length - 1, true);

      /* On a phone only one menu item is open at a time: 9 top items with up
         to 31 links each is a 200-row scroll at 360px. "Show all at once"
         opts out for the rare case. */
      var openable = view.expanded[pathKey(p1)] &&
        (!isPhone() || view.showAll || !view.selected || view.selected[0] === i || view.q);
      if (!openable) return;

      (item.groups || []).forEach(function (g, gi) {
        var p2 = [i, gi];
        html += rowHTML(g, p2, 2, gi === 0, gi === (item.groups.length - 1), true);
        if (!view.expanded[pathKey(p2)]) return;

        (g.items || []).forEach(function (l, li) {
          html += rowHTML(l, [i, gi, li], 3, li === 0, li === (g.items.length - 1), false);
        });
        html += '<button type="button" class="ad-tree-add lvl3" data-ad-addlink="' + pathKey(p2) + '">' +
          "＋ <span>Add link here</span></button>";
      });

      html += '<button type="button" class="ad-tree-add lvl2" data-ad-addcol="' + pathKey(p1) + '">' +
        "＋ <span>Add column here</span></button>";
    });

    if (view.q && !anyMatch) {
      html = '<div class="ad-empty">' + FCA.util.icon("search") +
        "<h2>Nothing matches “" + esc(view.q) + "”</h2>" +
        '<button class="fc-btn fc-btn-outline" type="button" data-ad-clearq>Clear search</button></div>';
    }

    box.innerHTML = '<div role="tree" aria-label="Menu tree">' + html + "</div>";
  }

  /* ======================================================================
     the inspector (a side panel on desktop, a full-screen sheet on a phone)
     ====================================================================== */

  function drawInspector() {
    var box = hostEl.querySelector("[data-ad-inspector]");
    if (!box) return;

    /* On a phone the inspector is not rendered beside the tree at all — it
       is pushed as a sheet only when a row is opened. */
    if (isPhone() && !view.sheetOpen) { box.innerHTML = ""; box.classList.remove("ad-sheet"); return; }
    box.classList.toggle("ad-sheet", isPhone() && view.sheetOpen);

    if (!view.selected || !nodeAt(view.selected)) {
      box.innerHTML = '<div class="ad-card"><div class="ad-card-body">' +
        '<p class="ad-help" style="font-size:13.5px">Tap a row on the left to edit it.</p>' +
        '<p class="ad-help"><b style="color:var(--fc-title)">Moving things</b><br>' +
        "▲ ▼ move an item among its neighbours only. To put it somewhere else, use " +
        "<b>⋯ → Move to…</b> and pick the new home from the list.</p>" +
        "</div></div>";
      return;
    }

    var p = view.selected;
    var level = p.length;
    var node = nodeAt(p);

    var headHTML =
      '<div class="ad-inspector-head">' +
        '<button type="button" class="fc-btn fc-btn-sm fc-btn-outline ad-inspector-back" data-ad-back>' +
          FCA.util.icon("back") + " Menu tree</button>" +
        '<span class="ad-tree-kind ad-tree-kind--' + KIND_CLASS[level] + '">' +
          '<span class="ad-kind-word">' + esc(KIND[level]) + "</span>" +
          '<span class="ad-kind-letter" aria-hidden="true">' + KIND_LETTER[level] + "</span></span>" +
        "<h2>" + esc(labelOf(node, level) || "(no name)") + "</h2>" +
      "</div>";

    var bodyHTML = "";
    if (level === 3) bodyHTML = linkFormHTML(node);
    else if (level === 2) bodyHTML = columnFormHTML(node, p);
    else bodyHTML = itemFormHTML(node, p);

    box.innerHTML = '<div class="ad-card">' + headHTML + '<div class="ad-card-body">' + bodyHTML + "</div>" +
      '<div class="ad-card-foot">' +
        '<button class="fc-btn fc-btn-sm fc-btn-outline fc-btn-danger" type="button" data-ad-delnode>Delete this ' +
        esc(KIND[level].toLowerCase()) + "</button>" +
      "</div></div>";

    wireInspector(box, p, level, node);
  }

  function pagePickerOptions() {
    var opts = [
      { value: "", label: "Custom address…" },
      { value: "index.html", label: "Home" },
      { value: "shop.html", label: "Shop — everything" }
    ];
    (FCA.state.doc.categories || []).forEach(function (c) {
      opts.push({ value: "shop.html?cat=" + c.slug, label: "Shop — " + c.label });
    });
    (FCA.state.doc.series || []).forEach(function (s) {
      opts.push({ value: "shop.html?series=" + s.slug, label: "Shop — " + (s.title || s.slug) });
    });
    ["about.html", "contact.html", "dealer.html", "catalogue.html"].forEach(function (h) {
      opts.push({ value: h, label: h.replace(".html", "").replace(/^\w/, function (c) { return c.toUpperCase(); }) });
    });
    opts.push({ value: "#", label: "Nowhere yet (#)" });
    return opts;
  }

  function hrefFieldHTML(id, value, label) {
    var opts = pagePickerOptions();
    var known = opts.some(function (o) { return o.value === value && o.value !== ""; });
    return '<div class="fc-field">' +
      '<label class="fc-label" for="' + id + '-pick">' + esc(label) + "</label>" +
      '<select class="fc-select" id="' + id + '-pick" data-ad-hrefpick="' + id + '" style="margin-bottom:8px">' +
        opts.map(function (o) {
          return '<option value="' + esc(o.value) + '"' + (known && o.value === value ? " selected" : "") + ">" + esc(o.label) + "</option>";
        }).join("") +
      "</select>" +
      '<input class="fc-input" id="' + id + '" data-ad-href value="' + esc(value || "") + '" ' +
        'aria-label="' + esc(label) + ' address">' +
      '<span class="ad-fielderr" data-ad-hreferr hidden></span>' +
    "</div>";
  }

  function linkFormHTML(node) {
    return '<div class="fc-field">' +
      '<label class="fc-label" for="ad-n-label">Link text <span class="ad-req">*</span></label>' +
      '<input class="fc-input" id="ad-n-label" data-ad-label maxlength="60" value="' + esc(node.label || "") + '">' +
      '<span class="ad-fielderr" data-ad-labelerr hidden></span></div>' +
      hrefFieldHTML("ad-n-href", node.href, "Where it goes");
  }

  function columnFormHTML(node, p) {
    var links = node.items || [];
    return '<div class="fc-field">' +
      '<label class="fc-label" for="ad-n-label">Column heading <span class="ad-req">*</span></label>' +
      '<input class="fc-input" id="ad-n-label" data-ad-label maxlength="40" value="' + esc(node.title || "") + '">' +
      '<span class="ad-fielderr" data-ad-labelerr hidden></span></div>' +
      '<p class="fc-label">Links in this column (' + links.length + ")</p>" +
      (links.length
        ? '<ul class="ad-where" style="border:1px solid var(--fc-border);border-radius:var(--fc-radius);padding:0 12px">' +
          links.map(function (l, li) {
            return '<li><button type="button" style="border:0;background:none;text-align:left;padding:0;color:var(--fc-primary-ink)" ' +
              'data-ad-open="' + pathKey([p[0], p[1], li]) + '">' + esc(l.label) + "</button></li>";
          }).join("") + "</ul>"
        : '<p class="ad-help">No links yet. Use “Add link here” under this column in the tree.</p>');
  }

  function itemFormHTML(node, p) {
    var s = FCA.util.slug(node.label || "");
    var dup = topSlugCollisions()[s];
    var cols = Number(node.cols) || (node.groups || []).length || 1;

    return '<div class="fc-field">' +
      '<label class="fc-label" for="ad-n-label">Label in the navbar <span class="ad-req">*</span></label>' +
      '<input class="fc-input" id="ad-n-label" data-ad-label maxlength="24" value="' + esc(node.label || "") + '">' +
      '<p class="ad-help">Web name: <code>' + esc(s || "?") + "</code>" +
        (dup ? ' <span class="ad-pill ad-pill-warn">Another menu item makes the same web name — the server will refuse this.</span>' : "") +
      "</p>" +
      '<span class="ad-fielderr" data-ad-labelerr hidden></span></div>' +

      hrefFieldHTML("ad-n-href", node.href, "Where the label itself links") +

      '<div class="fc-field">' +
        '<label class="fc-label" for="ad-n-cols">Columns per row in the drop-down</label>' +
        '<select class="fc-select" id="ad-n-cols" data-ad-cols>' +
          [1, 2, 3, 4].map(function (n) {
            return '<option value="' + n + '"' + (n === cols ? " selected" : "") + ">" + n + "</option>";
          }).join("") +
        "</select>" +
        megaMiniHTML(node, cols) +
        '<p class="ad-help">A preview of the drop-down panel.</p>' +
      "</div>" +

      '<label class="fc-checkbox" style="margin-bottom:16px"><input type="checkbox" data-ad-alignright' +
        (node.alignRight ? " checked" : "") + "> Push this menu to the right of the navbar</label>" +

      '<details style="border-top:1px solid var(--fc-border);padding-top:14px"' + (node.promo ? " open" : "") + ">" +
        '<summary style="font:600 13px/1.4 var(--ad-font-ui);cursor:pointer;min-height:24px">Promo panel (image + text)</summary>' +
        '<div style="padding-top:14px" data-ad-promo></div>' +
      "</details>";
  }

  function megaMiniHTML(node, cols) {
    var groups = (node.groups || []).slice(0, 6);
    var total = cols + (node.promo ? 1 : 0);
    return '<div class="ad-megamini" style="grid-template-columns:repeat(' + Math.max(1, Math.min(4, total)) + ',1fr)">' +
      groups.map(function (g) {
        return "<div><b>" + esc(g.title) + "</b>" +
          (g.items || []).slice(0, 3).map(function (l) { return esc(l.label); }).join("<br>") +
          ((g.items || []).length > 3 ? "<br>…" : "") + "</div>";
      }).join("") +
      (node.promo ? '<div class="is-promo">' + esc(node.promo.title || "Promo") + "</div>" : "") +
    "</div>";
  }

  function wireInspector(box, p, level, node) {
    var back = box.querySelector("[data-ad-back]");
    if (back) back.addEventListener("click", closeSheet);

    var labelEl = box.querySelector("[data-ad-label]");
    if (labelEl) {
      labelEl.addEventListener("input", FCA.util.debounce(function () {
        setLabel(node, level, labelEl.value);
        touch();
        drawTree();
        var h2 = box.querySelector(".ad-inspector-head h2");
        if (h2) h2.textContent = labelEl.value || "(no name)";
        if (level === 1) {
          var help = box.querySelector(".ad-help code");
          if (help) help.textContent = FCA.util.slug(labelEl.value) || "?";
        }
      }, 150));
      labelEl.addEventListener("blur", function () {
        var err = box.querySelector("[data-ad-labelerr]");
        var msg = null;
        if (!labelEl.value.trim()) msg = "This needs a name.";
        else {
          var a = FCA.fields.checkAngle(labelEl.value);
          if (a) msg = a;
        }
        err.hidden = !msg;
        if (msg) { err.innerHTML = '<span aria-hidden="true">!</span> ' + esc(msg); labelEl.setAttribute("aria-invalid", "true"); }
        else labelEl.removeAttribute("aria-invalid");
      });
    }

    var hrefEl = box.querySelector("[data-ad-href]");
    if (hrefEl) {
      var pick = box.querySelector("[data-ad-hrefpick]");
      if (pick) pick.addEventListener("change", function () {
        if (!pick.value) { hrefEl.focus(); return; }   /* "Custom address…" */
        hrefEl.value = pick.value;
        node.href = pick.value;
        touch();
        drawTree();
      });
      hrefEl.addEventListener("input", FCA.util.debounce(function () {
        node.href = hrefEl.value;
        touch();
        drawTree();
      }, 150));
      hrefEl.addEventListener("blur", function () {
        var err = box.querySelector("[data-ad-hreferr]");
        var msg = FCA.fields.checkHref(hrefEl.value.trim());
        err.hidden = !msg;
        if (msg) { err.innerHTML = '<span aria-hidden="true">!</span> ' + esc(msg); hrefEl.setAttribute("aria-invalid", "true"); }
        else hrefEl.removeAttribute("aria-invalid");
      });
    }

    var colsEl = box.querySelector("[data-ad-cols]");
    if (colsEl) colsEl.addEventListener("change", function () {
      node.cols = Number(colsEl.value);
      touch();
      var mini = box.querySelector(".ad-megamini");
      if (mini) mini.outerHTML = megaMiniHTML(node, node.cols);
    });

    var alignEl = box.querySelector("[data-ad-alignright]");
    if (alignEl) alignEl.addEventListener("change", function () {
      if (alignEl.checked) node.alignRight = true; else delete node.alignRight;
      touch();
      drawTree();
    });

    var promoHost = box.querySelector("[data-ad-promo]");
    if (promoHost) drawPromo(promoHost, node);

    box.querySelector("[data-ad-delnode]").addEventListener("click", function () { deleteNode(p); });

    box.addEventListener("click", function (e) {
      var o = e.target.closest("[data-ad-open]");
      if (o) openNode(parsePath(o.getAttribute("data-ad-open")));
    });
  }

  function drawPromo(host, node) {
    if (!node.promo) {
      host.innerHTML = '<p class="ad-help">No promo panel. Adding one shows a picture panel beside the columns.</p>' +
        '<button class="fc-btn fc-btn-sm fc-btn-outline" type="button" data-ad-addpromo>＋ Add a promo panel</button>';
      host.querySelector("[data-ad-addpromo]").addEventListener("click", function () {
        node.promo = { title: "", text: "", href: "#", image: "" };
        touch();
        drawPromo(host, node);
        drawTree();
      });
      return;
    }

    host.innerHTML =
      '<div class="fc-field"><label class="fc-label" for="ad-pr-title">Title</label>' +
        '<input class="fc-input" id="ad-pr-title" data-ad-pk="title" maxlength="40" value="' + esc(node.promo.title || "") + '"></div>' +
      '<div class="fc-field"><label class="fc-label" for="ad-pr-text">Text</label>' +
        '<input class="fc-input" id="ad-pr-text" data-ad-pk="text" maxlength="80" value="' + esc(node.promo.text || "") + '"></div>' +
      '<div class="fc-field"><label class="fc-label" for="ad-pr-href">Link</label>' +
        '<input class="fc-input" id="ad-pr-href" data-ad-pk="href" value="' + esc(node.promo.href || "") + '">' +
        '<span class="ad-fielderr" data-ad-prerr hidden></span></div>' +
      '<div class="fc-field"><label class="fc-label">Picture</label><div data-ad-primg></div></div>' +
      '<button class="fc-btn fc-btn-sm fc-btn-outline fc-btn-danger" type="button" data-ad-delpromo>Remove promo panel</button>';

    host.addEventListener("input", function (e) {
      var k = e.target.getAttribute && e.target.getAttribute("data-ad-pk");
      if (!k) return;
      node.promo[k] = e.target.value;
      touch();
      if (k === "href") {
        var err = host.querySelector("[data-ad-prerr]");
        var msg = FCA.fields.checkHref(e.target.value.trim());
        err.hidden = !msg;
        if (msg) err.innerHTML = '<span aria-hidden="true">!</span> ' + esc(msg);
      }
    });

    /* promo.image is interpolated into an inline CSS url(...) by
       components.js:megaHTML, so it must come from the uploader's whitelisted
       path, never a free-text box. */
    FCA.images.mount(host.querySelector("[data-ad-primg]"), {
      folder: "category",
      multi: false,
      value: node.promo.image,
      onChange: function (v) { node.promo.image = v; touch(); drawTree(); }
    });

    host.querySelector("[data-ad-delpromo]").addEventListener("click", function () {
      FCA.ui.confirmDelete({
        title: "Remove the promo panel?",
        consequence: "The picture panel disappears from this drop-down. The photo itself stays on the server.",
        confirmLabel: "Remove panel"
      }).then(function (yes) {
        if (!yes) return;
        delete node.promo;
        touch();
        drawPromo(host, node);
        drawTree();
      });
    });
  }

  /* ======================================================================
     interactions
     ====================================================================== */

  function openNode(p) {
    view.selected = p;
    expandTo(p);
    if (isPhone()) {
      view.sheetOpen = true;
      /* the browser Back button closes the sheet, which is what a phone user
         reaches for first */
      FCA.app.navigate("#/menu/node/" + pathKey(p));
      return;
    }
    drawTree();
    drawInspector();
  }

  function closeSheet() {
    view.sheetOpen = false;
    if (String(location.hash).indexOf("/node/") >= 0) history.back();
    else { drawTree(); drawInspector(); }
  }

  function move(p, delta) {
    var sibs = siblingsOf(p);
    var i = p[p.length - 1];
    var j = i + delta;
    if (j < 0 || j >= sibs.length) return;
    sibs.splice(j, 0, sibs.splice(i, 1)[0]);

    var np = p.slice();
    np[np.length - 1] = j;
    view.selected = np;

    touch();
    drawTree();
    drawInspector();

    var node = nodeAt(np);
    FCA.ui.toast("Moved " + labelOf(node, np.length) + " " + (delta < 0 ? "up" : "down") +
      ". Now " + ordinal(j + 1) + " of " + sibs.length + ".", {
      actionLabel: "Undo",
      onAction: function () { move(np, -delta); }
    });
  }

  function ordinal(n) {
    var s = ["th", "st", "nd", "rd"], v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }

  function addMenuItem() {
    var cap = limits().maxMenuTop || 12;
    if (menu().length >= cap) {
      FCA.ui.toast("The navbar holds at most " + cap + " items.");
      return;
    }
    menu().push({ label: "New item", href: "#", cols: 1, groups: [] });
    var p = [menu().length - 1];
    view.expanded[pathKey(p)] = true;
    touch();
    drawTree();
    openNode(p);
  }

  function addColumn(p1) {
    var item = nodeAt(p1);
    var cap = limits().maxMenuGroups || 8;
    if ((item.groups || []).length >= cap) {
      FCA.ui.toast("A drop-down holds at most " + cap + " columns.");
      return;
    }
    if (!item.groups) item.groups = [];
    item.groups.push({ title: "New column", items: [] });
    var p = [p1[0], item.groups.length - 1];
    view.expanded[pathKey(p1)] = true;
    view.expanded[pathKey(p)] = true;
    touch();
    drawTree();
    openNode(p);
  }

  function addLink(p2) {
    var g = nodeAt(p2);
    var cap = limits().maxMenuLinks || 20;
    if ((g.items || []).length >= cap) {
      FCA.ui.toast("A column holds at most " + cap + " links.");
      return;
    }
    if (!g.items) g.items = [];
    /* pre-build the query string she would otherwise hand-write */
    var parent = nodeAt([p2[0]]);
    g.items.push({ label: "New link", href: "shop.html?cat=" + FCA.util.slug(parent.label || "") });
    var p = [p2[0], p2[1], g.items.length - 1];
    view.expanded[pathKey(p2)] = true;
    touch();
    drawTree();
    openNode(p);
  }

  function deleteNode(p) {
    var level = p.length;
    var node = nodeAt(p);
    var label = labelOf(node, level);
    var consequence, list = null;

    if (level === 1) {
      var n = countLinks(node);
      consequence = "It disappears from the navigation bar on every page" +
        (n ? ", and its " + FCA.util.plural((node.groups || []).length, "column", "columns") +
             " and " + FCA.util.plural(n, "link", "links") + " go with it" : "") + ".";
      list = (node.groups || []).map(function (g) { return g.title; });
    } else if (level === 2) {
      var links = (node.items || []).length;
      consequence = links
        ? "<strong>" + FCA.util.plural(links, "link", "links") + " under it will be deleted too.</strong>"
        : "The column is empty, so nothing else goes with it.";
      list = (node.items || []).map(function (l) { return l.label; });
    } else {
      consequence = "The link disappears from the drop-down panel.";
    }

    FCA.ui.confirmDelete({
      title: "Delete this " + KIND[level].toLowerCase() + "?",
      recordHTML: '<div class="ad-cell-main">' + esc(label) + '</div><div class="ad-cell-sub">' + esc(KIND[level]) + "</div>",
      consequence: consequence,
      list: list
    }).then(function (yes) {
      if (!yes) return;
      var sibs = siblingsOf(p);
      var i = p[p.length - 1];
      var removed = sibs.splice(i, 1)[0];
      view.selected = null;
      view.sheetOpen = false;
      touch();
      drawTree();
      drawInspector();
      /* nothing is permanent until Save, so the undo is genuine */
      FCA.ui.toast(KIND[level] + " deleted.", {
        actionLabel: "Undo",
        onAction: function () {
          sibs.splice(Math.min(i, sibs.length), 0, removed);
          touch();
          drawTree();
          drawInspector();
        }
      });
    });
  }

  /* ---- the overflow menu ---- */
  function overflow(button, p) {
    var level = p.length;
    var node = nodeAt(p);
    var existing = document.querySelector(".ad-menupop");
    if (existing) existing.parentNode.removeChild(existing);

    var pop = document.createElement("div");
    pop.className = "ad-menupop";
    pop.innerHTML =
      '<button type="button" data-ad-act="rename">Rename</button>' +
      '<button type="button" data-ad-act="moveto">Move to…</button>' +
      '<button type="button" data-ad-act="duplicate">Duplicate</button>' +
      (level === 3 ? '<button type="button" data-ad-act="tocolumn">Turn into a column heading</button>' : "") +
      (level === 2 ? '<button type="button" data-ad-act="toitem">Turn into a menu item</button>' : "") +
      "<hr>" +
      '<button type="button" class="is-danger" data-ad-act="delete">Delete</button>';

    button.style.position = "relative";
    button.appendChild(pop);

    function close() {
      if (pop.parentNode) pop.parentNode.removeChild(pop);
      document.removeEventListener("click", onDoc, true);
    }
    function onDoc(e) { if (!pop.contains(e.target)) close(); }
    setTimeout(function () { document.addEventListener("click", onDoc, true); }, 0);

    pop.addEventListener("click", function (e) {
      var b = e.target.closest("[data-ad-act]");
      if (!b) return;
      e.stopPropagation();
      var act = b.getAttribute("data-ad-act");
      close();
      if (act === "rename") { openNode(p); setTimeout(function () {
        var el = document.querySelector("[data-ad-label]");
        if (el) { el.focus(); el.select(); }
      }, 60); }
      else if (act === "delete") deleteNode(p);
      else if (act === "duplicate") duplicate(p);
      else if (act === "moveto") moveTo(p);
      else if (act === "tocolumn") turnIntoColumn(p);
      else if (act === "toitem") turnIntoItem(p);
    });
  }

  function duplicate(p) {
    var sibs = siblingsOf(p);
    var i = p[p.length - 1];
    var copy = FCA.util.clone(sibs[i]);
    var level = p.length;
    setLabel(copy, level, labelOf(copy, level) + " copy");
    sibs.splice(i + 1, 0, copy);
    touch();
    drawTree();
    FCA.ui.toast(KIND[level] + " duplicated.");
  }

  /* Re-parenting. The select can only ever contain LEGAL parents, so the
     tree cannot end up invalid — which is exactly why this replaces a
     generic indent/outdent pair. */
  function moveTo(p) {
    var level = p.length;
    if (level === 1) {
      FCA.ui.toast("A menu item is already at the top. Use ▲ ▼ to reorder it.");
      return;
    }
    var options = [];
    if (level === 3) {
      menu().forEach(function (m, i) {
        (m.groups || []).forEach(function (g, gi) {
          options.push({ value: i + "-" + gi, label: (m.label || "?") + " → " + (g.title || "?") });
        });
      });
    } else {
      menu().forEach(function (m, i) { options.push({ value: String(i), label: m.label || "?" }); });
    }

    var currentParent = p.slice(0, level - 1).join("-");
    var body = document.createElement("div");
    body.innerHTML =
      '<div class="fc-field"><label class="fc-label" for="ad-mv-to">New home</label>' +
        '<select class="fc-select" id="ad-mv-to">' + options.map(function (o) {
          return '<option value="' + esc(o.value) + '"' + (o.value === currentParent ? " selected" : "") + ">" +
            esc(o.label) + (o.value === currentParent ? " (where it is now)" : "") + "</option>";
        }).join("") + "</select></div>" +
      '<div class="fc-field"><label class="fc-label" for="ad-mv-at">Place it</label>' +
        '<select class="fc-select" id="ad-mv-at"><option value="bottom">At the bottom</option>' +
        '<option value="top">At the top</option></select></div>';

    FCA.ui.modal({
      title: "Move " + esc(labelOf(nodeAt(p), level)),
      bodyNode: body,
      actions: [
        { label: "Cancel", kind: "outline", value: null },
        { label: "Move", value: "go" }
      ]
    }).then(function (choice) {
      if (choice !== "go") return;
      var target = parsePath(body.querySelector("#ad-mv-to").value);
      var at = body.querySelector("#ad-mv-at").value;

      var sibs = siblingsOf(p);
      var node = sibs.splice(p[p.length - 1], 1)[0];
      var dest;
      if (level === 3) {
        var g = nodeAt(target);
        dest = g.items || (g.items = []);
      } else {
        var m = nodeAt(target);
        dest = m.groups || (m.groups = []);
      }
      var at0 = at === "top" ? 0 : dest.length;
      dest.splice(at0, 0, node);

      view.selected = target.concat([at0]);
      expandTo(view.selected);
      touch();
      drawTree();
      drawInspector();
      FCA.ui.toast("Moved.");
    });
  }

  /* Both "turn into" moves are in the overflow, never on the row: they are
     rare and consequential, and each confirm says exactly what results. */
  function turnIntoColumn(p) {
    var link = nodeAt(p);
    FCA.ui.modal({
      title: "Turn this link into a column heading?",
      bodyHTML: "<p>«" + esc(link.label) + "» becomes a column heading <strong>with no links " +
        "under it</strong>, placed after the column it is in now. You can then move links into it.</p>",
      actions: [{ label: "Cancel", kind: "outline", value: null }, { label: "Turn into a column", value: "go" }]
    }).then(function (c) {
      if (c !== "go") return;
      var item = nodeAt([p[0]]);
      var cap = limits().maxMenuGroups || 8;
      if (item.groups.length >= cap) { FCA.ui.toast("A drop-down holds at most " + cap + " columns."); return; }
      siblingsOf(p).splice(p[2], 1);
      item.groups.splice(p[1] + 1, 0, { title: link.label, items: [] });
      view.selected = [p[0], p[1] + 1];
      expandTo(view.selected);
      touch();
      drawTree();
      drawInspector();
      FCA.ui.toast("Turned into a column.");
    });
  }

  function turnIntoItem(p) {
    var col = nodeAt(p);
    var cap = limits().maxMenuTop || 12;
    if (menu().length >= cap) { FCA.ui.toast("The navbar holds at most " + cap + " items."); return; }

    var preview = menu().map(function (m) { return m.label; }).concat([col.title]).join(" · ");
    FCA.ui.modal({
      title: "Turn this column into a menu item?",
      bodyHTML: "<p>It becomes a new item at the end of the navigation bar, keeping its " +
        FCA.util.plural((col.items || []).length, "link", "links") + " as its first column.</p>" +
        "<p><strong>This changes the site header.</strong> The navbar will become:</p>" +
        '<p class="ad-help" style="font-size:12.5px">' + esc(preview) + "</p>",
      actions: [{ label: "Cancel", kind: "outline", value: null }, { label: "Turn into a menu item", value: "go" }]
    }).then(function (c) {
      if (c !== "go") return;
      siblingsOf(p).splice(p[1], 1);
      menu().push({
        label: col.title,
        href: "#",
        cols: 1,
        groups: (col.items || []).length ? [{ title: col.title, items: col.items }] : []
      });
      view.selected = [menu().length - 1];
      expandTo(view.selected);
      touch();
      drawTree();
      drawInspector();
      FCA.ui.toast("Turned into a menu item.");
    });
  }

  /* ======================================================================
     events + keyboard
     ====================================================================== */

  document.addEventListener("click", function (e) {
    var box = document.querySelector('[data-ad-page="menu"]');
    if (!box || box.hidden || !box.contains(e.target)) return;

    var b = e.target.closest("button");
    if (!b) return;
    var k;

    if ((k = b.getAttribute("data-ad-twisty")) != null) {
      view.expanded[k] = !view.expanded[k];
      /* accordion on a phone: opening one top item closes the others */
      if (isPhone() && !view.showAll && parsePath(k).length === 1 && view.expanded[k]) {
        Object.keys(view.expanded).forEach(function (other) {
          if (other !== k && parsePath(other).length === 1) view.expanded[other] = false;
        });
        view.selected = parsePath(k);
      }
      drawTree();
      return;
    }
    if ((k = b.getAttribute("data-ad-open")) != null && b.classList.contains("ad-tree-label")) {
      openNode(parsePath(k));
      return;
    }
    if ((k = b.getAttribute("data-ad-up")) != null) { move(parsePath(k), -1); return; }
    if ((k = b.getAttribute("data-ad-down")) != null) { move(parsePath(k), 1); return; }
    if ((k = b.getAttribute("data-ad-more")) != null) { e.stopPropagation(); overflow(b, parsePath(k)); return; }
    if ((k = b.getAttribute("data-ad-addcol")) != null) { addColumn(parsePath(k)); return; }
    if ((k = b.getAttribute("data-ad-addlink")) != null) { addLink(parsePath(k)); return; }
    if (b.hasAttribute("data-ad-clearq")) {
      view.q = "";
      var q = document.querySelector("[data-ad-q]");
      if (q) q.value = "";
      drawTree();
      return;
    }
  });

  document.addEventListener("keydown", function (e) {
    var box = document.querySelector('[data-ad-page="menu"]');
    if (!box || box.hidden) return;
    var row = e.target.closest ? e.target.closest(".ad-tree-row") : null;
    if (!row) return;
    var p = parsePath(row.getAttribute("data-ad-path"));
    var rows = Array.prototype.slice.call(box.querySelectorAll(".ad-tree-row"));
    var i = rows.indexOf(row);

    if (e.key === "ArrowDown" && i < rows.length - 1) { e.preventDefault(); focusRow(rows[i + 1]); }
    else if (e.key === "ArrowUp" && i > 0) { e.preventDefault(); focusRow(rows[i - 1]); }
    else if (e.key === "ArrowRight" && p.length < 3) { e.preventDefault(); view.expanded[pathKey(p)] = true; drawTree(); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); view.expanded[pathKey(p)] = false; drawTree(); }
    else if (e.key === "Enter") { e.preventDefault(); openNode(p); }
    else if (e.key === "Delete") { e.preventDefault(); deleteNode(p); }
    else if (e.altKey && e.key === "ArrowUp") { e.preventDefault(); move(p, -1); }
    else if (e.altKey && e.key === "ArrowDown") { e.preventDefault(); move(p, 1); }
  });

  function focusRow(row) {
    Array.prototype.slice.call(row.parentNode.querySelectorAll(".ad-tree-row")).forEach(function (r) {
      r.setAttribute("tabindex", "-1");
    });
    row.setAttribute("tabindex", "0");
    row.focus();
  }

  phoneQuery.addEventListener("change", function () {
    var box = document.querySelector('[data-ad-page="menu"]');
    if (box && !box.hidden) draw(box);
  });

  /* ======================================================================
     save
     ====================================================================== */

  /* Strip UI-only keys and empties. Unknown keys are rejected by the server,
     so nothing may leak out of the editor's own state. */
  function serialise(items) {
    return (items || []).map(function (m) {
      var out = { label: String(m.label || "").trim(), href: String(m.href || "#").trim() };
      if (m.cols) out.cols = Number(m.cols);
      if (m.alignRight) out.alignRight = true;
      out.groups = (m.groups || []).map(function (g) {
        return {
          title: String(g.title || "").trim(),
          items: (g.items || []).map(function (l) {
            return { label: String(l.label || "").trim(), href: String(l.href || "#").trim() };
          })
        };
      });
      if (m.promo && (m.promo.title || m.promo.image)) {
        out.promo = {
          title: String(m.promo.title || "").trim(),
          text: String(m.promo.text || "").trim(),
          href: String(m.promo.href || "#").trim(),
          image: m.promo.image || ""
        };
      }
      return out;
    });
  }

  function validateTree() {
    var problems = [];
    var seen = {};
    menu().forEach(function (m, i) {
      var label = String(m.label || "").trim();
      if (!label) problems.push("Menu item " + (i + 1) + " has no label.");
      if (label.length > 24) problems.push("“" + label + "” is longer than 24 characters, which breaks the navbar.");
      var s = FCA.util.slug(label);
      if (seen[s]) problems.push("“" + label + "” and “" + seen[s] + "” make the same web name (" + s + ").");
      else seen[s] = label;
      var h = FCA.fields.checkHref(String(m.href || "").trim());
      if (h) problems.push("“" + label + "”: " + h);

      (m.groups || []).forEach(function (g, gi) {
        if (!String(g.title || "").trim()) problems.push("A column in “" + label + "” has no heading.");
        (g.items || []).forEach(function (l) {
          if (!String(l.label || "").trim()) problems.push("A link in “" + (g.title || "?") + "” has no text.");
          var lh = FCA.fields.checkHref(String(l.href || "").trim());
          if (lh) problems.push("“" + (l.label || "?") + "”: " + lh);
        });
      });
    });
    return problems;
  }

  function doSave() {
    FCA.ui.clearBanners("validation");
    var problems = validateTree();
    if (problems.length) {
      FCA.ui.banner({
        tag: "validation", kind: "error",
        title: FCA.util.plural(problems.length, "problem needs", "problems need") + " fixing first.",
        bodyHTML: '<ul class="ad-confirm-list">' +
          problems.slice(0, 8).map(function (t) { return "<li>" + esc(t) + "</li>"; }).join("") +
          (problems.length > 8 ? "<li>and " + (problems.length - 8) + " more</li>" : "") + "</ul>"
      });
      return;
    }

    FCA.fields.setSaving(bar, true);
    FCA.fields.setSaveBarStatus(bar, "saving", "Saving…");
    FCA.app.saveCollection("menu", {
      successMessage: "Menu saved.",
      serialise: serialise,
      onFieldErrors: function (fieldsMap, message) {
        FCA.ui.banner({
          tag: "validation", kind: "error",
          title: "The server would not accept the menu.",
          bodyHTML: " " + esc(message) + '<ul class="ad-confirm-list">' +
            Object.keys(fieldsMap).map(function (k) {
              return "<li><code>" + esc(k) + "</code> — " + esc(fieldsMap[k]) + "</li>";
            }).join("") + "</ul>"
        });
      }
    }).then(function (ok) {
      FCA.fields.setSaving(bar, false);
      FCA.fields.setSaveBarStatus(bar, ok ? "clean" : "failed", ok ? "All changes saved" : "Could not save");
      if (ok) { drawTree(); drawInspector(); }
    });
  }

  FCA.menu = { serialise: serialise, validateTree: validateTree };
})(window, document);
