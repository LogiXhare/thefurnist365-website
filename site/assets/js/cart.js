/* ==========================================================================
   cart.js — front-end-only cart + wishlist, persisted in localStorage.
   No backend: this is the demo store state used across all pages.
   ========================================================================== */

(function (window, document) {
  "use strict";

  var D = window.FC_DATA;
  var CART_KEY = "fc365.cart";
  var WISH_KEY = "fc365.wishlist";

  /* ---------- storage helpers (safe against private mode / blocked storage) ---------- */
  function read(key, fallback) {
    try {
      var raw = window.localStorage.getItem(key);
      if (!raw) return fallback;
      var parsed = JSON.parse(raw);
      return parsed == null ? fallback : parsed;
    } catch (err) {
      return fallback;
    }
  }

  function write(key, value) {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch (err) {
      /* storage unavailable — state stays in memory for this page only */
    }
  }

  var state = {
    cart: read(CART_KEY, []),
    wishlist: read(WISH_KEY, [])
  };

  if (!Array.isArray(state.cart)) state.cart = [];
  if (!Array.isArray(state.wishlist)) state.wishlist = [];

  /* ---------- lookup ---------- */
  function findProduct(id) {
    for (var i = 0; i < D.products.length; i++) {
      if (D.products[i].id === id) return D.products[i];
    }
    return null;
  }

  /* A variable product's "from" price is used as the demo unit price. */
  function unitPrice(product, variant) {
    if (product.price != null) return product.price;
    if (product.priceMin == null) return 0;
    if (!variant || !product.options) return product.priceMin;

    /* spread the range across the chosen option so totals vary sensibly */
    var keys = Object.keys(product.options);
    if (!keys.length) return product.priceMin;
    var list = product.options[keys[0]];
    var idx = list.indexOf(variant);
    if (idx < 0 || list.length < 2) return product.priceMin;
    var step = (product.priceMax - product.priceMin) / (list.length - 1);
    return Math.round(product.priceMin + step * idx);
  }

  function lineKey(id, variant) {
    return id + "::" + (variant || "");
  }

  /* ---------- mutations ---------- */
  function add(id, qty, variant) {
    var product = findProduct(id);
    if (!product) return false;

    qty = Math.max(1, parseInt(qty, 10) || 1);
    var key = lineKey(id, variant);

    for (var i = 0; i < state.cart.length; i++) {
      if (lineKey(state.cart[i].id, state.cart[i].variant) === key) {
        state.cart[i].qty += qty;
        persist();
        return true;
      }
    }

    state.cart.push({
      id: id,
      qty: qty,
      variant: variant || "",
      price: unitPrice(product, variant)
    });
    persist();
    return true;
  }

  function setQty(id, variant, qty) {
    qty = parseInt(qty, 10);
    var key = lineKey(id, variant);
    for (var i = 0; i < state.cart.length; i++) {
      if (lineKey(state.cart[i].id, state.cart[i].variant) === key) {
        if (!qty || qty < 1) {
          state.cart.splice(i, 1);
        } else {
          state.cart[i].qty = qty;
        }
        persist();
        return;
      }
    }
  }

  function remove(id, variant) {
    var key = lineKey(id, variant);
    state.cart = state.cart.filter(function (line) {
      return lineKey(line.id, line.variant) !== key;
    });
    persist();
  }

  function clear() {
    state.cart = [];
    persist();
  }

  function toggleWishlist(id) {
    var idx = state.wishlist.indexOf(id);
    var added;
    if (idx > -1) {
      state.wishlist.splice(idx, 1);
      added = false;
    } else {
      state.wishlist.push(id);
      added = true;
    }
    write(WISH_KEY, state.wishlist);
    renderCounts();
    return added;
  }

  function inWishlist(id) {
    return state.wishlist.indexOf(id) > -1;
  }

  /* ---------- totals ---------- */
  function lines() {
    return state.cart
      .map(function (line) {
        var product = findProduct(line.id);
        if (!product) return null;
        return {
          id: line.id,
          variant: line.variant,
          qty: line.qty,
          price: line.price != null ? line.price : unitPrice(product, line.variant),
          product: product
        };
      })
      .filter(Boolean);
  }

  function count() {
    return state.cart.reduce(function (sum, l) {
      return sum + l.qty;
    }, 0);
  }

  function subtotal() {
    return lines().reduce(function (sum, l) {
      return sum + l.price * l.qty;
    }, 0);
  }

  /* ---------- rendering ---------- */
  function renderCounts() {
    var money = window.FC.money;

    document.querySelectorAll("[data-fc-cart-count]").forEach(function (el) {
      el.textContent = count();
    });
    document.querySelectorAll("[data-fc-cart-total]").forEach(function (el) {
      el.innerHTML = money(subtotal());
    });
    document.querySelectorAll("[data-fc-wishlist-count]").forEach(function (el) {
      el.textContent = state.wishlist.length;
    });

    /* reflect wishlist state on product cards */
    document.querySelectorAll("[data-fc-wishlist]").forEach(function (btn) {
      btn.classList.toggle("is-active", inWishlist(btn.getAttribute("data-fc-wishlist")));
    });
  }

  function renderMiniCart() {
    var body = document.querySelector("[data-fc-minicart-body]");
    if (!body) return;

    var list = lines();
    if (!list.length) {
      body.innerHTML =
        '<div class="fc-empty-state">' +
          window.FC.icons.cart +
          "<p>Your cart is empty.</p>" +
          '<a class="fc-btn fc-btn-sm" href="shop.html">Browse products</a>' +
        "</div>";
      return;
    }

    body.innerHTML = list
      .map(function (l) {
        return (
          '<div class="fc-minicart-item">' +
            '<img src="' + l.product.image + '" alt="' + l.product.name + '" loading="lazy">' +
            "<div>" +
              '<a class="fc-minicart-item-title" href="product.html?id=' + l.id + '">' + l.product.name + "</a>" +
              '<div class="fc-minicart-item-meta">' +
                (l.variant ? l.variant + " &middot; " : "") +
                l.qty + " &times; " + window.FC.money(l.price) +
              "</div>" +
            "</div>" +
            '<button type="button" class="fc-minicart-remove" data-fc-remove-line="' + l.id + '" data-fc-variant="' + l.variant + '" aria-label="Remove ' + l.product.name + '">&times;</button>' +
          "</div>"
        );
      })
      .join("");
  }

  function persist() {
    write(CART_KEY, state.cart);
    renderCounts();
    renderMiniCart();
    document.dispatchEvent(new CustomEvent("fc:cart-changed"));
  }

  /* ---------- public API ---------- */
  window.FC = window.FC || {};
  window.FC.cart = {
    add: add,
    remove: remove,
    setQty: setQty,
    clear: clear,
    lines: lines,
    count: count,
    subtotal: subtotal,
    unitPrice: unitPrice,
    findProduct: findProduct,
    toggleWishlist: toggleWishlist,
    inWishlist: inWishlist,
    wishlist: function () { return state.wishlist.slice(); },
    refresh: function () { renderCounts(); renderMiniCart(); }
  };
})(window, document);
