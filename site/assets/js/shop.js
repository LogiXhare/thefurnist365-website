/* ==========================================================================
   shop.js — product listing: URL-driven filters, sorting, column toggle.
   Supports ?cat= ?sub= ?series= ?q= (the header search posts q + cat here).
   ========================================================================== */

(function (window, document) {
  "use strict";

  var D = window.FC_DATA;
  var FC = window.FC;
  var COLS_KEY = "fc365.shopCols";

  function qs(sel, root) { return (root || document).querySelector(sel); }
  function qsa(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  /* ---------------- state ---------------- */
  var state = {
    cat: "",
    sub: "",
    series: [],
    sizes: [],
    q: "",
    min: null,
    max: null,
    sort: "default",
    cols: 3
  };

  /* ---------------- price bounds from the real data ---------------- */
  function productLow(p) { return p.price != null ? p.price : p.priceMin; }
  function productHigh(p) { return p.price != null ? p.price : p.priceMax; }

  function bounds() {
    var lo = null;
    var hi = null;
    D.products.forEach(function (p) {
      var a = productLow(p);
      var b = productHigh(p);
      if (lo === null || a < lo) lo = a;
      if (hi === null || b > hi) hi = b;
    });
    return { lo: lo || 0, hi: hi || 0 };
  }

  /* ---------------- filtering ---------------- */
  function matches(p) {
    if (state.cat && p.category !== state.cat && p.sub !== state.cat) return false;
    if (state.sub && p.sub !== state.sub) return false;

    if (state.series.length && state.series.indexOf(p.series) < 0) return false;

    if (state.sizes.length) {
      var sw = p.swatches || [];
      var hit = state.sizes.some(function (s) { return sw.indexOf(s) > -1; });
      if (!hit) return false;
    }

    if (state.q) {
      var needle = state.q.toLowerCase();
      var haystack = (p.name + " " + p.sku + " " + p.categoryLabel + " " + p.sub).toLowerCase();
      if (haystack.indexOf(needle) < 0) return false;
    }

    if (state.min !== null && productHigh(p) < state.min) return false;
    if (state.max !== null && productLow(p) > state.max) return false;

    return true;
  }

  function sortList(list) {
    var out = list.slice();
    if (state.sort === "price-asc") {
      out.sort(function (a, b) { return productLow(a) - productLow(b); });
    } else if (state.sort === "price-desc") {
      out.sort(function (a, b) { return productHigh(b) - productHigh(a); });
    } else if (state.sort === "name-asc") {
      out.sort(function (a, b) { return a.name.localeCompare(b.name); });
    } else if (state.sort === "name-desc") {
      out.sort(function (a, b) { return b.name.localeCompare(a.name); });
    }
    return out;
  }

  /* ---------------- category list ---------------- */
  function countFor(slug) {
    return D.products.filter(function (p) {
      return p.category === slug || p.sub === slug;
    }).length;
  }

  function renderCategories() {
    var host = qs("[data-fc-shop-cats]");
    if (!host) return;

    var items = [{ label: "All Products", slug: "" }].concat(
      D.menu
        .filter(function (m) { return m.label !== "More"; })
        .map(function (m) { return { label: m.label, slug: D.slug(m.label) }; })
    );

    host.innerHTML = items
      .map(function (c) {
        var n = c.slug === "" ? D.products.length : countFor(c.slug);
        var active = c.slug === state.cat ? " is-active" : "";
        return (
          "<li><a class=\"" + active.trim() + "\" href=\"#\" data-fc-cat=\"" + c.slug + "\">" +
            "<span>" + c.label + "</span>" +
            '<span class="fc-cat-count">(' + n + ")</span>" +
          "</a></li>"
        );
      })
      .join("");
  }

  /* ---------------- active filter chips ---------------- */
  function renderChips() {
    var host = qs("[data-fc-chips]");
    if (!host) return;

    var chips = [];
    if (state.q) chips.push({ key: "q", label: 'Search: "' + state.q + '"' });
    if (state.cat) chips.push({ key: "cat", label: "Category: " + state.cat.replace(/-/g, " ") });
    if (state.sub) chips.push({ key: "sub", label: state.sub.replace(/-/g, " ") });
    state.series.forEach(function (s) {
      chips.push({ key: "series:" + s, label: s + " series" });
    });
    state.sizes.forEach(function (s) {
      chips.push({ key: "size:" + s, label: "Size: " + s });
    });
    if (state.min !== null || state.max !== null) {
      var b = bounds();
      chips.push({
        key: "price",
        label:
          "Price: " +
          (state.min !== null ? state.min.toLocaleString("en-US") : b.lo.toLocaleString("en-US")) +
          " - " +
          (state.max !== null ? state.max.toLocaleString("en-US") : b.hi.toLocaleString("en-US"))
      });
    }

    host.innerHTML = chips
      .map(function (c) {
        return (
          '<span class="fc-chip">' + c.label +
            '<button type="button" data-fc-chip-remove="' + c.key + '" aria-label="Remove filter ' + c.label + '">&times;</button>' +
          "</span>"
        );
      })
      .join("");
  }

  /* ---------------- URL sync ---------------- */
  function syncUrl() {
    if (!window.history || !window.history.replaceState) return;

    var parts = [];
    if (state.cat) parts.push("cat=" + encodeURIComponent(state.cat));
    if (state.sub) parts.push("sub=" + encodeURIComponent(state.sub));
    if (state.q) parts.push("q=" + encodeURIComponent(state.q));
    if (state.series.length) parts.push("series=" + encodeURIComponent(state.series.join(",")));
    if (state.sizes.length) parts.push("size=" + encodeURIComponent(state.sizes.join(",")));
    if (state.min !== null) parts.push("min=" + state.min);
    if (state.max !== null) parts.push("max=" + state.max);
    if (state.sort !== "default") parts.push("sort=" + state.sort);

    var url = window.location.pathname + (parts.length ? "?" + parts.join("&") : "");
    window.history.replaceState(null, "", url);
  }

  /* ---------------- heading ---------------- */
  function renderHeading(total) {
    var h1 = qs("[data-fc-shop-heading]");
    var crumb = qs("[data-fc-shop-crumb]");

    var label = "Shop";
    if (state.q) label = 'Search results for "' + state.q + '"';
    else if (state.sub) label = titleize(state.sub);
    else if (state.cat) label = titleize(state.cat);
    else if (state.series.length === 1) label = titleize(state.series[0]) + " Series";

    if (h1) h1.textContent = label;
    if (crumb) crumb.textContent = label;
    document.title = label + " - " + D.site.name;

    var count = qs("[data-fc-shop-count]");
    if (count) {
      count.innerHTML =
        total === 0
          ? "No products matched your filters."
          : "Showing <strong>" + total + "</strong> of <strong>" + D.products.length + "</strong> products";
    }
  }

  function titleize(s) {
    return String(s)
      .replace(/-/g, " ")
      .replace(/\b\w/g, function (c) { return c.toUpperCase(); });
  }

  /* ---------------- render ---------------- */
  function render() {
    var grid = qs("[data-fc-shop-grid]");
    var empty = qs("[data-fc-shop-empty]");
    if (!grid) return;

    var list = sortList(D.products.filter(matches));

    grid.innerHTML = list.map(FC.productCard).join("");
    grid.style.setProperty("--shop-cols", state.cols);
    if (empty) empty.hidden = list.length > 0;

    renderCategories();
    renderChips();
    renderHeading(list.length);
    syncUrl();

    /* one page of results for this data set — keep the control honest */
    var pager = qs("[data-fc-pagination]");
    if (pager) pager.hidden = list.length <= 12;

    FC.cart.refresh();
  }

  /* ---------------- read URL into state ---------------- */
  function readUrl() {
    state.cat = FC.param("cat");
    state.sub = FC.param("sub");
    state.q = FC.param("q");

    var series = FC.param("series");
    state.series = series ? series.split(",").filter(Boolean) : [];

    var size = FC.param("size");
    state.sizes = size ? size.split(",").filter(Boolean) : [];

    var min = FC.param("min");
    var max = FC.param("max");
    state.min = min ? parseInt(min, 10) : null;
    state.max = max ? parseInt(max, 10) : null;
    if (isNaN(state.min)) state.min = null;
    if (isNaN(state.max)) state.max = null;

    var sort = FC.param("sort");
    state.sort = sort || "default";

    try {
      var saved = parseInt(window.localStorage.getItem(COLS_KEY), 10);
      if (saved >= 2 && saved <= 4) state.cols = saved;
    } catch (err) {}
  }

  /* ---------------- wire the controls ---------------- */
  function initControls() {
    /* category links */
    document.addEventListener("click", function (e) {
      var catLink = e.target.closest("[data-fc-cat]");
      if (catLink) {
        e.preventDefault();
        state.cat = catLink.getAttribute("data-fc-cat");
        state.sub = "";
        render();
        return;
      }

      var chip = e.target.closest("[data-fc-chip-remove]");
      if (chip) {
        var key = chip.getAttribute("data-fc-chip-remove");
        if (key === "q") state.q = "";
        else if (key === "cat") state.cat = "";
        else if (key === "sub") state.sub = "";
        else if (key === "price") { state.min = null; state.max = null; syncInputs(); }
        else if (key.indexOf("series:") === 0) {
          state.series = state.series.filter(function (s) { return s !== key.slice(7); });
          syncInputs();
        } else if (key.indexOf("size:") === 0) {
          state.sizes = state.sizes.filter(function (s) { return s !== key.slice(5); });
          syncInputs();
        }
        render();
      }
    });

    /* sort */
    var sort = qs("[data-fc-sort]");
    if (sort) {
      sort.value = state.sort;
      sort.addEventListener("change", function () {
        state.sort = sort.value;
        render();
      });
    }

    /* columns */
    qsa("[data-fc-cols]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        state.cols = parseInt(btn.getAttribute("data-fc-cols"), 10) || 3;
        try { window.localStorage.setItem(COLS_KEY, String(state.cols)); } catch (err) {}
        paintColButtons();
        render();
      });
    });

    /* price */
    var apply = qs("[data-fc-price-apply]");
    if (apply) {
      apply.addEventListener("click", function () {
        var minEl = qs("#filter-min");
        var maxEl = qs("#filter-max");
        var mn = parseInt(minEl.value, 10);
        var mx = parseInt(maxEl.value, 10);
        state.min = isNaN(mn) ? null : mn;
        state.max = isNaN(mx) ? null : mx;
        if (state.min !== null && state.max !== null && state.min > state.max) {
          var t = state.min; state.min = state.max; state.max = t;
          minEl.value = state.min;
          maxEl.value = state.max;
        }
        render();
      });
    }

    /* series + size checkboxes */
    qsa("[data-fc-series]").forEach(function (box) {
      box.addEventListener("change", function () {
        var v = box.getAttribute("data-fc-series");
        if (box.checked) {
          if (state.series.indexOf(v) < 0) state.series.push(v);
        } else {
          state.series = state.series.filter(function (s) { return s !== v; });
        }
        render();
      });
    });

    qsa("[data-fc-size]").forEach(function (box) {
      box.addEventListener("change", function () {
        var v = box.getAttribute("data-fc-size");
        if (box.checked) {
          if (state.sizes.indexOf(v) < 0) state.sizes.push(v);
        } else {
          state.sizes = state.sizes.filter(function (s) { return s !== v; });
        }
        render();
      });
    });

    /* clear all */
    var clear = qs("[data-fc-clear-filters]");
    if (clear) {
      clear.addEventListener("click", function () {
        state.cat = "";
        state.sub = "";
        state.q = "";
        state.series = [];
        state.sizes = [];
        state.min = null;
        state.max = null;
        state.sort = "default";
        if (sort) sort.value = "default";
        syncInputs();
        render();
      });
    }

    /* mobile filter drawer */
    var toggle = qs("[data-fc-filter-toggle]");
    var sidebar = qs("[data-fc-shop-sidebar]");
    if (toggle && sidebar) {
      toggle.addEventListener("click", function () {
        var open = sidebar.classList.toggle("is-open");
        toggle.setAttribute("aria-expanded", String(open));
        toggle.textContent = open ? "Hide filters" : "Show filters";
      });
    }
  }

  function paintColButtons() {
    qsa("[data-fc-cols]").forEach(function (btn) {
      btn.classList.toggle("is-active", btn.getAttribute("data-fc-cols") === String(state.cols));
    });
  }

  /* Push state back into the form controls (after clear / chip removal). */
  function syncInputs() {
    var minEl = qs("#filter-min");
    var maxEl = qs("#filter-max");
    if (minEl) minEl.value = state.min === null ? "" : state.min;
    if (maxEl) maxEl.value = state.max === null ? "" : state.max;

    qsa("[data-fc-series]").forEach(function (box) {
      box.checked = state.series.indexOf(box.getAttribute("data-fc-series")) > -1;
    });
    qsa("[data-fc-size]").forEach(function (box) {
      box.checked = state.sizes.indexOf(box.getAttribute("data-fc-size")) > -1;
    });
  }

  /* ---------------- boot ---------------- */
  function init() {
    if (!window.FC_DATA || !qs("[data-fc-shop-grid]")) return;

    readUrl();

    /* show the real price range as the placeholder hint */
    var b = bounds();
    var hint = qs("[data-fc-price-hint]");
    if (hint) {
      hint.innerHTML = "Range: " + FC.money(b.lo) + " &ndash; " + FC.money(b.hi);
    }
    var minEl = qs("#filter-min");
    var maxEl = qs("#filter-max");
    if (minEl) minEl.setAttribute("placeholder", String(b.lo));
    if (maxEl) maxEl.setAttribute("placeholder", String(b.hi));

    syncInputs();
    paintColButtons();
    initControls();
    render();

    /* keep Back/Forward usable */
    window.addEventListener("popstate", function () {
      readUrl();
      syncInputs();
      paintColButtons();
      render();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})(window, document);
