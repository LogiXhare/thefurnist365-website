/* ==========================================================================
   main.js — global behaviour: mega menu, mobile drawer, sticky nav bar,
   search modal with live results, mini-cart, wishlist buttons, quick view,
   toasts, back-to-top and the demo session (login state in the header).
   ========================================================================== */

(function (window, document) {
  "use strict";

  var D = window.FC_DATA;
  var FC = window.FC;
  var SESSION_KEY = "fc365.session";

  /* ---------------- small utilities ---------------- */
  function qs(sel, root) { return (root || document).querySelector(sel); }
  function qsa(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function param(name, search) {
    var m = new RegExp("[?&]" + name + "=([^&#]*)").exec(search || window.location.search);
    return m ? decodeURIComponent(m[1].replace(/\+/g, " ")) : "";
  }

  function toast(message) {
    var stack = qs("[data-fc-toasts]");
    if (!stack) return;
    var el = document.createElement("div");
    el.className = "fc-toast";
    el.textContent = message;
    stack.appendChild(el);
    window.setTimeout(function () {
      el.style.opacity = "0";
      window.setTimeout(function () { el.remove(); }, 260);
    }, 2600);
  }

  /* ---------------- demo session ---------------- */
  var session = {
    get: function () {
      try {
        return JSON.parse(window.localStorage.getItem(SESSION_KEY) || "null");
      } catch (err) {
        return null;
      }
    },
    set: function (user) {
      try { window.localStorage.setItem(SESSION_KEY, JSON.stringify(user)); } catch (err) {}
    },
    clear: function () {
      try { window.localStorage.removeItem(SESSION_KEY); } catch (err) {}
    }
  };

  function paintSession() {
    var user = session.get();
    qsa("[data-fc-account-label]").forEach(function (el) {
      el.textContent = user ? user.name.split(" ")[0] : (el.closest(".fc-topbar, .fc-drawer-foot") ? "Login / Register" : "Login");
    });
    qsa("[data-fc-account-link]").forEach(function (el) {
      el.setAttribute("href", user ? "account.html" : "login.html");
    });
  }

  /* ---------------- overlay / panels ---------------- */
  function closeAllPanels() {
    var drawer = qs("[data-fc-drawer]");
    var minicart = qs("[data-fc-minicart]");
    var searchModal = qs("[data-fc-search-modal]");
    var overlay = qs("[data-fc-overlay]");

    if (drawer) { drawer.classList.remove("is-open"); drawer.setAttribute("aria-hidden", "true"); }
    if (minicart) { minicart.classList.remove("is-open"); minicart.setAttribute("aria-hidden", "true"); }
    if (searchModal) { searchModal.classList.remove("is-open"); searchModal.setAttribute("aria-hidden", "true"); }
    if (overlay) overlay.classList.remove("is-open");

    document.body.classList.remove("fc-no-scroll");
    qsa("[data-fc-open-drawer],[data-fc-open-cart]").forEach(function (b) {
      b.setAttribute("aria-expanded", "false");
    });
  }

  function openPanel(panel, trigger) {
    closeAllPanels();
    if (!panel) return;
    panel.classList.add("is-open");
    panel.setAttribute("aria-hidden", "false");
    var overlay = qs("[data-fc-overlay]");
    if (overlay) overlay.classList.add("is-open");
    document.body.classList.add("fc-no-scroll");
    if (trigger) trigger.setAttribute("aria-expanded", "true");
  }

  /* ---------------- mega menu ---------------- */
  function initMegaMenu() {
    var items = qsa(".fc-nav-item");
    var isTouch = window.matchMedia("(hover: none)").matches;
    var closeTimer;

    items.forEach(function (item) {
      var link = qs(".fc-nav-link", item);
      var mega = qs(".fc-mega", item);
      if (!mega || !link) return;

      function open() {
        window.clearTimeout(closeTimer);
        items.forEach(function (other) {
          if (other !== item) other.classList.remove("is-open");
        });
        item.classList.add("is-open");
        link.setAttribute("aria-expanded", "true");
        keepInViewport(mega);
      }

      function close() {
        item.classList.remove("is-open");
        link.setAttribute("aria-expanded", "false");
      }

      if (isTouch) {
        /* first tap opens the mega menu, second follows the link */
        link.addEventListener("click", function (e) {
          if (!item.classList.contains("is-open")) {
            e.preventDefault();
            open();
          }
        });
      } else {
        item.addEventListener("mouseenter", open);
        item.addEventListener("mouseleave", function () {
          closeTimer = window.setTimeout(close, 120);
        });
        link.addEventListener("focus", open);
      }

      /* keyboard: Escape closes and returns focus to the trigger */
      item.addEventListener("keydown", function (e) {
        if (e.key === "Escape" && item.classList.contains("is-open")) {
          close();
          link.focus();
        }
      });
    });

    /* click outside closes any open mega menu */
    document.addEventListener("click", function (e) {
      if (!e.target.closest(".fc-nav-item")) {
        items.forEach(function (item) {
          item.classList.remove("is-open");
          var l = qs(".fc-nav-link", item);
          if (l && l.hasAttribute("aria-expanded")) l.setAttribute("aria-expanded", "false");
        });
      }
    });
  }

  /* Nudge a wide mega panel back inside the window. */
  function keepInViewport(mega) {
    mega.style.left = "";
    mega.style.right = "";
    var rect = mega.getBoundingClientRect();
    var pad = 16;
    if (rect.right > window.innerWidth - pad) {
      var shift = rect.right - (window.innerWidth - pad);
      mega.style.left = -shift + "px";
    }
    if (rect.left < pad) mega.style.left = "0px";
  }

  /* ---------------- mobile drawer ---------------- */
  function initDrawer() {
    document.addEventListener("click", function (e) {
      var openBtn = e.target.closest("[data-fc-open-drawer]");
      if (openBtn) {
        openPanel(qs("[data-fc-drawer]"), openBtn);
        return;
      }
      if (e.target.closest("[data-fc-close-drawer]")) closeAllPanels();

      var toggle = e.target.closest("[data-fc-drawer-toggle]");
      if (toggle) {
        var sub = document.getElementById(toggle.getAttribute("aria-controls"));
        var expanded = toggle.getAttribute("aria-expanded") === "true";
        toggle.setAttribute("aria-expanded", String(!expanded));
        if (sub) sub.hidden = expanded;
      }
    });
  }

  /* ---------------- sticky nav bar ---------------- */
  function initSticky() {
    var navbar = qs("[data-fc-navbar]");
    var spacer = qs("[data-fc-navbar-spacer]");
    if (!navbar || !spacer) return;

    var threshold = navbar.offsetTop;

    function onScroll() {
      if (window.scrollY > threshold + 10) {
        if (!navbar.classList.contains("is-stuck")) {
          navbar.classList.add("is-stuck");
          spacer.classList.add("is-active");
        }
      } else if (navbar.classList.contains("is-stuck")) {
        navbar.classList.remove("is-stuck");
        spacer.classList.remove("is-active");
      }
    }

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", function () {
      navbar.classList.remove("is-stuck");
      spacer.classList.remove("is-active");
      threshold = navbar.offsetTop;
      onScroll();
    });
    onScroll();
  }

  /* ---------------- search ---------------- */
  function searchProducts(term, cat) {
    var q = String(term || "").trim().toLowerCase();
    return D.products.filter(function (p) {
      var matchCat = !cat || p.category === cat || p.sub === cat || p.series === cat;
      if (!matchCat) return false;
      if (!q) return false;
      return (
        p.name.toLowerCase().indexOf(q) > -1 ||
        p.sku.toLowerCase().indexOf(q) > -1 ||
        p.categoryLabel.toLowerCase().indexOf(q) > -1
      );
    });
  }

  function initSearch() {
    document.addEventListener("click", function (e) {
      var open = e.target.closest("[data-fc-open-search]");
      if (open) {
        openPanel(qs("[data-fc-search-modal]"), open);
        var input = qs("#fc-search-modal-input");
        if (input) window.setTimeout(function () { input.focus(); }, 60);
      }
      if (e.target.closest("[data-fc-close-search]")) closeAllPanels();
    });

    /* live results inside the modal */
    var modalInput = qs("#fc-search-modal-input");
    var results = qs("[data-fc-search-results]");
    if (modalInput && results) {
      modalInput.addEventListener("input", function () {
        var found = searchProducts(modalInput.value, "");
        if (!modalInput.value.trim()) { results.innerHTML = ""; return; }
        if (!found.length) {
          results.innerHTML = '<p class="fc-muted">No products matched that search.</p>';
          return;
        }
        results.innerHTML = found
          .slice(0, 6)
          .map(function (p) {
            return (
              '<a class="fc-search-result" href="product.html?id=' + p.id + '">' +
                '<img src="' + p.image + '" alt="' + p.name + '">' +
                '<span class="fc-search-result-title">' + p.name + "</span>" +
                FC.priceHTML(p) +
              "</a>"
            );
          })
          .join("");
      });
    }

    /* the header form just navigates to shop.html with query params */
    qsa("[data-fc-search-form]").forEach(function (form) {
      form.addEventListener("submit", function (e) {
        var input = qs('input[name="q"]', form);
        if (input && !input.value.trim()) {
          e.preventDefault();
          input.focus();
        }
      });
    });
  }

  /* ---------------- mini cart + product actions ---------------- */
  function initCartUI() {
    document.addEventListener("click", function (e) {
      var openCart = e.target.closest("[data-fc-open-cart]");
      if (openCart) {
        openPanel(qs("[data-fc-minicart]"), openCart);
        return;
      }
      if (e.target.closest("[data-fc-close-cart]")) closeAllPanels();

      var removeBtn = e.target.closest("[data-fc-remove-line]");
      if (removeBtn) {
        FC.cart.remove(
          removeBtn.getAttribute("data-fc-remove-line"),
          removeBtn.getAttribute("data-fc-variant") || ""
        );
        toast("Item removed from cart.");
      }

      var wishBtn = e.target.closest("[data-fc-wishlist]");
      if (wishBtn) {
        var added = FC.cart.toggleWishlist(wishBtn.getAttribute("data-fc-wishlist"));
        toast(added ? "Added to wishlist." : "Removed from wishlist.");
      }

      var compareBtn = e.target.closest("[data-fc-compare]");
      if (compareBtn) toast("Compare is not available in this front-end demo.");

      var quickBtn = e.target.closest("[data-fc-quickview]");
      if (quickBtn) openQuickView(quickBtn.getAttribute("data-fc-quickview"));

      var addBtn = e.target.closest("[data-fc-add-to-cart]");
      if (addBtn) {
        var id = addBtn.getAttribute("data-fc-add-to-cart");
        var variant = addBtn.getAttribute("data-fc-variant") || "";
        var qtyInput = qs("[data-fc-qty]");
        var qty = qtyInput ? qtyInput.value : 1;
        if (FC.cart.add(id, qty, variant)) {
          var p = FC.cart.findProduct(id);
          toast((p ? p.name : "Product") + " added to cart.");
        }
      }
    });

    document.addEventListener("fc:cart-changed", function () {
      /* keep any open cart page in sync */
      if (window.FC.renderCartPage) window.FC.renderCartPage();
    });
  }

  /* ---------------- quick view ---------------- */
  function openQuickView(id) {
    var p = FC.cart.findProduct(id);
    if (!p) return;

    var existing = qs("[data-fc-quickview-modal]");
    if (existing) existing.remove();

    var optionKeys = p.options ? Object.keys(p.options) : [];
    var optionsHTML = optionKeys
      .map(function (key) {
        return (
          '<div class="fc-field">' +
            '<label class="fc-label" for="fc-qv-' + FC_slug(key) + '">' + key + "</label>" +
            '<select class="fc-select" id="fc-qv-' + FC_slug(key) + '" data-fc-qv-option>' +
              p.options[key].map(function (v) { return "<option>" + v + "</option>"; }).join("") +
            "</select>" +
          "</div>"
        );
      })
      .join("");

    var wrap = document.createElement("div");
    wrap.className = "fc-modal is-open";
    wrap.setAttribute("data-fc-quickview-modal", "");
    wrap.innerHTML =
      '<div class="fc-modal-backdrop" data-fc-qv-close></div>' +
      '<div class="fc-modal-dialog" role="dialog" aria-modal="true" aria-label="' + p.name + ' quick view">' +
        '<button type="button" class="fc-modal-close" data-fc-qv-close aria-label="Close quick view">' + FC.icons.close + "</button>" +
        '<div class="fc-modal-body">' +
          '<div class="fc-modal-media"><img src="' + p.image + '" alt="' + p.name + '"></div>' +
          "<div>" +
            '<span class="fc-product-cat">' + p.categoryLabel + "</span>" +
            "<h3>" + p.name + "</h3>" +
            FC.priceHTML(p) +
            "<p>" + p.short + "</p>" +
            optionsHTML +
            '<div class="fc-row" style="gap:10px;margin-top:6px">' +
              '<input class="fc-input" data-fc-qty type="number" min="1" value="1" style="width:80px" aria-label="Quantity">' +
              '<button class="fc-btn" type="button" data-fc-qv-add="' + p.id + '">Add to cart</button>' +
            "</div>" +
            '<p style="margin-top:14px"><a class="fc-link-arrow" href="product.html?id=' + p.id + '">View full details</a></p>' +
          "</div>" +
        "</div>" +
      "</div>";

    document.body.appendChild(wrap);
    document.body.classList.add("fc-no-scroll");

    wrap.addEventListener("click", function (e) {
      if (e.target.closest("[data-fc-qv-close]")) {
        wrap.remove();
        document.body.classList.remove("fc-no-scroll");
        return;
      }
      var add = e.target.closest("[data-fc-qv-add]");
      if (add) {
        var sel = qs("[data-fc-qv-option]", wrap);
        var qtyEl = qs("[data-fc-qty]", wrap);
        FC.cart.add(add.getAttribute("data-fc-qv-add"), qtyEl ? qtyEl.value : 1, sel ? sel.value : "");
        toast(p.name + " added to cart.");
        wrap.remove();
        document.body.classList.remove("fc-no-scroll");
      }
    });
  }

  function FC_slug(s) { return D.slug(s); }

  /* ---------------- back to top ---------------- */
  function initToTop() {
    var btn = qs("[data-fc-to-top]");
    if (!btn) return;
    btn.addEventListener("click", function () {
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
    window.addEventListener(
      "scroll",
      function () { btn.classList.toggle("is-visible", window.scrollY > 400); },
      { passive: true }
    );
  }

  /* ---------------- global keys / overlay ---------------- */
  function initGlobal() {
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") {
        closeAllPanels();
        var qv = qs("[data-fc-quickview-modal]");
        if (qv) { qv.remove(); document.body.classList.remove("fc-no-scroll"); }
      }
    });

    var overlay = qs("[data-fc-overlay]");
    if (overlay) overlay.addEventListener("click", closeAllPanels);
  }

  /* ---------------- reveal on scroll ----------------
     The sections carrying [data-fc-reveal] are built by the page script
     (home.js), which waits for DOMContentLoaded exactly as this file does.
     This file is loaded first, so its handler runs first: a scan made here
     and now finds nothing, returns early, and leaves those sections sitting
     at opacity 0 forever — visible to a text selection but not to the eye.
     So defer the first scan by one task, after every renderer has run, and
     keep it re-runnable for anything rendered later still. */
  var revealIO = null;

  function scanReveal() {
    var targets = qsa("[data-fc-reveal]").filter(function (t) {
      return !t.classList.contains("is-revealed");
    });
    if (!targets.length) return;

    if (!("IntersectionObserver" in window)) {
      targets.forEach(function (t) { t.classList.add("is-revealed"); });
      return;
    }

    if (!revealIO) {
      revealIO = new IntersectionObserver(
        function (entries) {
          entries.forEach(function (entry) {
            if (entry.isIntersecting) {
              entry.target.classList.add("is-revealed");
              revealIO.unobserve(entry.target);
            }
          });
        },
        { rootMargin: "0px 0px -60px 0px", threshold: 0.08 }
      );
    }
    /* observing an already-observed target is a no-op, so this is safe to re-run */
    targets.forEach(function (t) { revealIO.observe(t); });
  }

  function initReveal() {
    window.setTimeout(scanReveal, 0);
  }

  /* ---------------- boot ---------------- */
  function boot() {
    initMegaMenu();
    initDrawer();
    initSticky();
    initSearch();
    initCartUI();
    initToTop();
    initGlobal();
    initReveal();
    paintSession();
    FC.cart.refresh();
  }

  window.FC = window.FC || {};
  window.FC.toast = toast;
  window.FC.param = param;
  window.FC.qs = qs;
  window.FC.qsa = qsa;
  window.FC.session = session;
  window.FC.paintSession = paintSession;
  window.FC.searchProducts = searchProducts;
  window.FC.closePanels = closeAllPanels;
  window.FC.scanReveal = scanReveal;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})(window, document);
