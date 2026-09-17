/* ==========================================================================
   cart-page.js — one script for cart.html, wishlist.html and account.html.
   Detects which page it is on from the mount points present in the DOM.

   Demo rules (front-end only, no server):
     delivery : free at or above FREE_DELIVERY_FROM, else FLAT_DELIVERY
     coupon   : "FC365" gives 10% off the subtotal
   ========================================================================== */

(function (window, document) {
  "use strict";

  var D = window.FC_DATA;
  var FC = window.FC;

  var COUPON_KEY = "fc365.coupon";
  var COUPON_CODE = "FC365";
  var COUPON_RATE = 0.1;
  var FLAT_DELIVERY = 1200;
  var FREE_DELIVERY_FROM = 50000;

  function qs(sel, root) { return (root || document).querySelector(sel); }
  function qsa(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  /* ---------------- coupon persistence ---------------- */
  function readCoupon() {
    try { return window.localStorage.getItem(COUPON_KEY) || ""; } catch (err) { return ""; }
  }
  function writeCoupon(code) {
    try {
      if (code) window.localStorage.setItem(COUPON_KEY, code);
      else window.localStorage.removeItem(COUPON_KEY);
    } catch (err) {}
  }

  /* ---------------- totals ---------------- */
  function totals() {
    var subtotal = FC.cart.subtotal();
    var discount = readCoupon() === COUPON_CODE ? Math.round(subtotal * COUPON_RATE) : 0;
    var afterDiscount = subtotal - discount;
    var delivery = 0;
    if (afterDiscount > 0) {
      delivery = afterDiscount >= FREE_DELIVERY_FROM ? 0 : FLAT_DELIVERY;
    }
    return {
      subtotal: subtotal,
      discount: discount,
      delivery: delivery,
      total: afterDiscount + delivery
    };
  }

  /* ================= CART PAGE ================= */
  function renderCart() {
    var body = qs("[data-fc-cart-body]");
    if (!body) return;

    var lines = FC.cart.lines();
    var wrap = qs("[data-fc-cart-content]");
    var empty = qs("[data-fc-cart-empty]");

    if (!lines.length) {
      if (wrap) wrap.hidden = true;
      if (empty) empty.hidden = false;
      return;
    }
    if (wrap) wrap.hidden = false;
    if (empty) empty.hidden = true;

    body.innerHTML = lines
      .map(function (l) {
        return (
          "<tr>" +
            "<td>" +
              '<div class="fc-cart-product">' +
                '<img src="' + l.product.image + '" alt="' + l.product.name + '" loading="lazy">' +
                "<div>" +
                  '<a class="fc-cart-product-name" href="product.html?id=' + l.id + '">' + l.product.name + "</a>" +
                  (l.variant ? '<div class="fc-cart-product-variant">' + l.variant + "</div>" : "") +
                "</div>" +
              "</div>" +
            "</td>" +
            "<td>" + FC.money(l.price) + "</td>" +
            "<td>" +
              '<div class="fc-cart-qty">' +
                '<button type="button" data-fc-line-down="' + l.id + '" data-fc-variant="' + l.variant + '" aria-label="Decrease quantity">&minus;</button>' +
                '<label class="fc-visually-hidden" for="qty-' + l.id + "-" + D.slug(l.variant || "x") + '">Quantity for ' + l.product.name + "</label>" +
                '<input type="number" id="qty-' + l.id + "-" + D.slug(l.variant || "x") + '" min="1" step="1" value="' + l.qty + '" ' +
                  'data-fc-line-qty="' + l.id + '" data-fc-variant="' + l.variant + '" inputmode="numeric">' +
                '<button type="button" data-fc-line-up="' + l.id + '" data-fc-variant="' + l.variant + '" aria-label="Increase quantity">+</button>' +
              "</div>" +
            "</td>" +
            '<td class="fc-col-right">' + FC.money(l.price * l.qty) + "</td>" +
            '<td class="fc-col-right">' +
              '<button class="fc-cart-remove" type="button" data-fc-line-remove="' + l.id + '" data-fc-variant="' + l.variant + '" aria-label="Remove ' + l.product.name + ' from cart">&times;</button>' +
            "</td>" +
          "</tr>"
        );
      })
      .join("");

    renderTotals();
  }

  function renderTotals() {
    var host = qs("[data-fc-cart-totals]");
    if (!host) return;

    var t = totals();
    var coupon = readCoupon();

    host.innerHTML =
      '<div class="fc-totals-row"><span>Subtotal</span><span>' + FC.money(t.subtotal) + "</span></div>" +
      (t.discount
        ? '<div class="fc-totals-row fc-totals-row-discount"><span>Discount <small>coupon ' + coupon + '</small></span><span>&minus;' + FC.money(t.discount) + "</span></div>"
        : "") +
      '<div class="fc-totals-row"><span>Delivery' +
        (t.delivery === 0 && t.subtotal > 0
          ? " <small>Free over " + FC.money(FREE_DELIVERY_FROM) + "</small>"
          : " <small>Flat demo rate</small>") +
        "</span><span>" + (t.delivery === 0 ? "Free" : FC.money(t.delivery)) + "</span></div>" +
      '<div class="fc-totals-grand"><span>Total</span><span>' + FC.money(t.total) + "</span></div>";
  }

  function initCartPage() {
    if (!qs("[data-fc-cart-body]")) return;

    /* cart.js calls this after every mutation */
    FC.renderCartPage = function () { renderCart(); };

    document.addEventListener("click", function (e) {
      var t = e.target;

      var up = t.closest("[data-fc-line-up]");
      if (up) {
        stepLine(up.getAttribute("data-fc-line-up"), up.getAttribute("data-fc-variant"), 1);
        return;
      }
      var down = t.closest("[data-fc-line-down]");
      if (down) {
        stepLine(down.getAttribute("data-fc-line-down"), down.getAttribute("data-fc-variant"), -1);
        return;
      }
      var rm = t.closest("[data-fc-line-remove]");
      if (rm) {
        FC.cart.remove(rm.getAttribute("data-fc-line-remove"), rm.getAttribute("data-fc-variant") || "");
        FC.toast("Item removed from cart.");
        return;
      }
      var clear = t.closest("[data-fc-cart-clear]");
      if (clear) {
        if (window.confirm("Remove all items from your cart?")) {
          FC.cart.clear();
          FC.toast("Cart cleared.");
        }
        return;
      }
      var checkout = t.closest("[data-fc-checkout]");
      if (checkout) {
        var note = qs("[data-fc-checkout-note]");
        if (note) {
          note.hidden = false;
          note.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      }
    });

    /* typed quantity */
    document.addEventListener("change", function (e) {
      var input = e.target.closest ? e.target.closest("[data-fc-line-qty]") : null;
      if (!input) return;
      var v = parseInt(input.value, 10);
      if (!v || v < 1) v = 1;
      FC.cart.setQty(input.getAttribute("data-fc-line-qty"), input.getAttribute("data-fc-variant") || "", v);
    });

    /* coupon */
    var applyBtn = qs("[data-fc-coupon-apply]");
    if (applyBtn) {
      applyBtn.addEventListener("click", function () {
        var input = qs("#coupon-code");
        var box = qs("[data-fc-coupon-notice]");
        var code = (input.value || "").trim().toUpperCase();

        if (!code) {
          show(box, "error", "Enter a coupon code.");
          return;
        }
        if (code !== COUPON_CODE) {
          writeCoupon("");
          show(box, "error", 'Coupon "' + code + '" is not valid.');
          renderTotals();
          return;
        }
        writeCoupon(COUPON_CODE);
        show(box, "success", "Coupon " + COUPON_CODE + " applied — 10% off your subtotal.");
        renderTotals();
      });
    }

    /* restore a previously applied coupon */
    var saved = readCoupon();
    if (saved) {
      var input = qs("#coupon-code");
      if (input) input.value = saved;
      show(qs("[data-fc-coupon-notice]"), "success", "Coupon " + saved + " is applied.");
    }

    renderCart();
  }

  function stepLine(id, variant, delta) {
    var lines = FC.cart.lines();
    for (var i = 0; i < lines.length; i++) {
      if (lines[i].id === id && (lines[i].variant || "") === (variant || "")) {
        FC.cart.setQty(id, variant || "", Math.max(1, lines[i].qty + delta));
        return;
      }
    }
  }

  function show(box, type, message) {
    if (!box) return;
    box.className = "fc-notice fc-notice-" + type;
    box.textContent = message;
    box.hidden = false;
  }

  /* ================= WISHLIST PAGE ================= */
  function renderWishlist() {
    var grid = qs("[data-fc-wishlist-grid]");
    if (!grid) return;

    var empty = qs("[data-fc-wishlist-empty]");
    var ids = FC.cart.wishlist();
    var items = ids
      .map(function (id) { return FC.cart.findProduct(id); })
      .filter(Boolean);

    if (!items.length) {
      grid.innerHTML = "";
      if (empty) empty.hidden = false;
      return;
    }
    if (empty) empty.hidden = true;

    grid.innerHTML = items
      .map(function (p) {
        var card = FC.productCard(p);
        /* add a "move to cart" action alongside "Select options" */
        return card.replace(
          '<div class="fc-product-cta">',
          '<div class="fc-product-cta">' +
            '<button class="fc-btn fc-btn-sm" type="button" data-fc-move-to-cart="' + p.id + '">Move to cart</button>'
        );
      })
      .join("");

    var count = qs("[data-fc-wishlist-total]");
    if (count) count.textContent = items.length;

    FC.cart.refresh();
  }

  function initWishlistPage() {
    if (!qs("[data-fc-wishlist-grid]")) return;

    document.addEventListener("click", function (e) {
      var move = e.target.closest("[data-fc-move-to-cart]");
      if (move) {
        var id = move.getAttribute("data-fc-move-to-cart");
        var p = FC.cart.findProduct(id);
        var variant = "";
        if (p && p.options) {
          var keys = Object.keys(p.options);
          if (keys.length) variant = p.options[keys[0]][0];
        }
        FC.cart.add(id, 1, variant);
        FC.cart.toggleWishlist(id);
        renderWishlist();
        FC.toast((p ? p.name : "Product") + " moved to cart.");
        return;
      }

      /* the heart on a card also removes it from this page */
      if (e.target.closest("[data-fc-wishlist]")) {
        window.setTimeout(renderWishlist, 0);
      }
    });

    renderWishlist();
  }

  /* ================= ACCOUNT PAGE ================= */
  function initAccountPage() {
    var host = qs("[data-fc-account]");
    if (!host) return;

    var user = FC.session.get();
    var guest = qs("[data-fc-account-guest]");
    var dash = qs("[data-fc-account-dash]");

    if (!user) {
      if (guest) guest.hidden = false;
      if (dash) dash.hidden = true;
      return;
    }
    if (guest) guest.hidden = true;
    if (dash) dash.hidden = false;

    /* profile card */
    var initials = user.name
      .split(" ")
      .map(function (w) { return w.charAt(0); })
      .join("")
      .slice(0, 2)
      .toUpperCase();

    var profile = qs("[data-fc-account-profile]");
    if (profile) {
      profile.innerHTML =
        '<div class="fc-account-avatar">' +
          '<span class="fc-account-avatar-circle">' + initials + "</span>" +
          "<div><strong>" + user.name + "</strong><span>" + user.email + "</span></div>" +
        "</div>" +
        '<ul class="fc-account-list">' +
          "<li><span>Account type</span><span>Demo</span></li>" +
          "<li><span>Name</span><span>" + user.name + "</span></li>" +
          "<li><span>Email</span><span style=\"word-break:break-all\">" + user.email + "</span></li>" +
        "</ul>";
    }

    var greeting = qs("[data-fc-account-greeting]");
    if (greeting) greeting.textContent = "Hello, " + user.name.split(" ")[0];

    /* stats */
    var lines = FC.cart.lines();
    var stats = qs("[data-fc-account-stats]");
    if (stats) {
      stats.innerHTML =
        '<div class="fc-account-stat"><strong>' + FC.cart.count() + "</strong><span>Items in cart</span></div>" +
        '<div class="fc-account-stat"><strong>' + FC.cart.wishlist().length + "</strong><span>Wishlist items</span></div>" +
        '<div class="fc-account-stat"><strong>0</strong><span>Orders placed</span></div>';
    }

    /* activity */
    var activity = qs("[data-fc-account-activity]");
    if (activity) {
      activity.innerHTML = lines.length
        ? '<ul class="fc-account-list">' +
            lines
              .map(function (l) {
                return (
                  "<li><span>" + l.product.name + (l.variant ? " &middot; " + l.variant : "") +
                  " &times; " + l.qty + "</span><span>" + FC.money(l.price * l.qty) + "</span></li>"
                );
              })
              .join("") +
            "<li><span><strong>Cart subtotal</strong></span><span><strong>" + FC.money(FC.cart.subtotal()) + "</strong></span></li>" +
          "</ul>"
        : '<p class="fc-muted">Your cart is empty. <a href="shop.html" style="color:var(--fc-primary-ink)">Browse products</a>.</p>';
    }

    /* offices */
    var offices = qs("[data-fc-account-offices]");
    if (offices) {
      var o = D.site.office;
      offices.innerHTML =
        "<div><h3>" + o.label + "</h3><p>" + o.street + "<br>" + o.floor + "<br>" + o.area + "</p></div>" +
        "<div><h3>Contact</h3><p>Hotline: " + D.site.phone + "<br>" + D.site.email + "</p></div>";
    }

    /* logout */
    var logout = qs("[data-fc-logout]");
    if (logout) {
      logout.addEventListener("click", function () {
        FC.session.clear();
        FC.paintSession();
        window.location.href = "index.html";
      });
    }
  }

  /* ---------------- boot ---------------- */
  function init() {
    if (!window.FC_DATA) return;
    initCartPage();
    initWishlistPage();
    initAccountPage();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})(window, document);
