/* ==========================================================================
   product.js — single product page. Reads ?id= from the URL and renders the
   gallery, purchase panel, tabs and related products from FC_DATA.
   ========================================================================== */

(function (window, document) {
  "use strict";

  var D = window.FC_DATA;
  var FC = window.FC;

  function qs(sel, root) { return (root || document).querySelector(sel); }
  function qsa(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  var product = null;
  var brand = null;

  /* ---------------- brand ---------------- */

  /* product.brand is a loose slug reference: it may be absent, or name a brand
     that was dropped from D.brands. Every brand block below is opt-in on this
     returning an object, so an unknown slug just renders the page as before. */
  function findBrand() {
    var list = D.brands || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i].slug === product.brand) return list[i];
    }
    return null;
  }

  function brandHref() {
    return "shop.html?brand=" + encodeURIComponent(brand.slug);
  }

  /* ---------------- gallery ---------------- */
  function renderGallery() {
    var main = qs("[data-fc-gallery-main]");
    var thumbs = qs("[data-fc-gallery-thumbs]");
    if (!main) return;

    var images = product.gallery && product.gallery.length ? product.gallery : [product.image];

    main.innerHTML =
      (product.badge ? '<span class="fc-badge fc-badge-new fc-gallery-badge">' + product.badge + "</span>" : "") +
      '<img src="' + images[0] + '" alt="' + product.name + '" data-fc-gallery-img>';

    if (!thumbs) return;

    if (images.length < 2) {
      thumbs.hidden = true;
      return;
    }

    thumbs.innerHTML = images
      .map(function (src, i) {
        return (
          '<button type="button" class="fc-gallery-thumb' + (i === 0 ? " is-active" : "") + '" ' +
            'data-fc-thumb="' + src + '" aria-label="View image ' + (i + 1) + ' of ' + images.length + '">' +
            '<img src="' + src + '" alt="" loading="lazy">' +
          "</button>"
        );
      })
      .join("");

    thumbs.addEventListener("click", function (e) {
      var btn = e.target.closest("[data-fc-thumb]");
      if (!btn) return;
      var img = qs("[data-fc-gallery-img]");
      if (img) img.setAttribute("src", btn.getAttribute("data-fc-thumb"));
      qsa(".fc-gallery-thumb", thumbs).forEach(function (t) {
        t.classList.toggle("is-active", t === btn);
      });
    });
  }

  /* ---------------- purchase panel ---------------- */
  function renderPanel() {
    var host = qs("[data-fc-single-panel]");
    if (!host) return;

    var optionKeys = product.options ? Object.keys(product.options) : [];
    var optionsHTML = optionKeys
      .map(function (key) {
        var id = "opt-" + D.slug(key);
        return (
          '<div class="fc-field">' +
            '<label class="fc-label" for="' + id + '">' + key + "</label>" +
            '<select class="fc-select" id="' + id + '" data-fc-option="' + key + '">' +
              product.options[key]
                .map(function (v) { return "<option>" + v + "</option>"; })
                .join("") +
            "</select>" +
          "</div>"
        );
      })
      .join("");

    var isRange = product.priceMin != null;
    var firstKey = optionKeys.length ? optionKeys[0] : "";
    var firstValue = firstKey ? product.options[firstKey][0] : "";

    /* The logo carries no text, so the accessible name lives on the link. */
    var brandLogo = brand
      ? '<a class="fc-single-brand" href="' + brandHref() + '" aria-label="Browse all ' + brand.name + ' products">' +
          '<img src="' + brand.logo + '" alt="' + brand.name + '">' +
        "</a>"
      : "";

    host.innerHTML =
      '<div class="fc-single-brandline">' +
        '<span class="fc-single-eyebrow">' + product.categoryLabel + "</span>" +
        brandLogo +
      "</div>" +
      '<h1 class="fc-single-title">' + product.name + "</h1>" +

      '<div class="fc-single-meta-top">' +
        "<span>SKU: " + product.sku + "</span>" +
        '<span class="fc-stock">In stock</span>' +
      "</div>" +

      '<div class="fc-single-price">' +
        FC.priceHTML(product) +
        (isRange
          ? '<p class="fc-unit-price">Selected: <strong data-fc-unit-price>' + FC.money(FC.cart.unitPrice(product, firstValue)) + "</strong></p>"
          : "") +
      "</div>" +

      '<p class="fc-single-short">' + product.short + "</p>" +

      '<div class="fc-single-options">' + optionsHTML + "</div>" +

      '<div class="fc-buy-row">' +
        '<div class="fc-qty">' +
          '<button type="button" data-fc-qty-down aria-label="Decrease quantity">&minus;</button>' +
          '<label class="fc-visually-hidden" for="single-qty">Quantity</label>' +
          '<input type="number" id="single-qty" data-fc-qty value="1" min="1" step="1" inputmode="numeric">' +
          '<button type="button" data-fc-qty-up aria-label="Increase quantity">+</button>' +
        "</div>" +
        '<button class="fc-btn fc-btn-lg" type="button" data-fc-single-add>Add to cart</button>' +
        '<button class="fc-wish-btn" type="button" data-fc-single-wish aria-pressed="false">' +
          FC.icons.heart + "<span>Wishlist</span>" +
        "</button>" +
      "</div>" +

      '<ul class="fc-single-assurance">' +
        "<li>" + FC.icons.box + "<span>Delivered nationwide across Bangladesh. Delivery is quoted at order confirmation.</span></li>" +
        "<li>" + FC.icons.phone + '<span>Questions? Hotline <a href="tel:' + D.site.phoneIntl + '">' + FC.phoneText(D.site) + "</a> (WhatsApp &amp; Call).</span></li>" +
        "<li>" + FC.icons.store + '<span>See this piece in person &mdash; <a href="contact.html#showroom">visit a showroom</a>.</span></li>' +
      "</ul>" +

      '<dl class="fc-single-metalist">' +
        "<div><dt>SKU</dt><dd>" + product.sku + "</dd></div>" +
        "<div><dt>Category</dt><dd>" + product.categoryLabel + "</dd></div>" +
        (brand ? '<div><dt>Brand</dt><dd><a href="' + brandHref() + '">' + brand.name + "</a></dd></div>" : "") +
        (product.series ? "<div><dt>Series</dt><dd>" + product.series + " series</dd></div>" : "") +
        "<div><dt>Availability</dt><dd>In stock</dd></div>" +
      "</dl>";

    wirePanel(firstKey);
  }

  function currentVariant() {
    var sel = qs("[data-fc-option]");
    return sel ? sel.value : "";
  }

  function wirePanel(firstKey) {
    /* live unit price when the first option changes */
    var firstSelect = qs('[data-fc-option="' + firstKey + '"]');
    var unitEl = qs("[data-fc-unit-price]");
    if (firstSelect && unitEl) {
      firstSelect.addEventListener("change", function () {
        unitEl.innerHTML = FC.money(FC.cart.unitPrice(product, firstSelect.value));
      });
    }

    /* quantity stepper */
    var qty = qs("[data-fc-qty]");
    var up = qs("[data-fc-qty-up]");
    var down = qs("[data-fc-qty-down]");
    if (qty && up && down) {
      up.addEventListener("click", function () {
        qty.value = String((parseInt(qty.value, 10) || 1) + 1);
      });
      down.addEventListener("click", function () {
        qty.value = String(Math.max(1, (parseInt(qty.value, 10) || 1) - 1));
      });
      qty.addEventListener("change", function () {
        var v = parseInt(qty.value, 10);
        qty.value = String(!v || v < 1 ? 1 : v);
      });
    }

    /* add to cart */
    var add = qs("[data-fc-single-add]");
    if (add) {
      add.addEventListener("click", function () {
        var q = qty ? qty.value : 1;
        FC.cart.add(product.id, q, currentVariant());
        FC.toast(product.name + " added to cart.");
      });
    }

    /* wishlist toggle */
    var wish = qs("[data-fc-single-wish]");
    if (wish) {
      paintWish(wish);
      wish.addEventListener("click", function () {
        FC.cart.toggleWishlist(product.id);
        paintWish(wish);
        FC.toast(FC.cart.inWishlist(product.id) ? "Added to wishlist." : "Removed from wishlist.");
      });
    }
  }

  function paintWish(btn) {
    var on = FC.cart.inWishlist(product.id);
    btn.classList.toggle("is-active", on);
    btn.setAttribute("aria-pressed", String(on));
    var label = qs("span", btn);
    if (label) label.textContent = on ? "In wishlist" : "Wishlist";
  }

  /* ---------------- tabs ---------------- */
  function renderTabs() {
    var desc = qs("[data-fc-tab-description]");
    var info = qs("[data-fc-tab-info]");

    if (desc) {
      desc.innerHTML =
        "<h3>About this product</h3>" +
        "<p>" + product.short + "</p>" +
        "<p>Built by " + D.site.name + " for " + product.categoryLabel.toLowerCase() +
          " use, the " + product.sku +
          (product.series
            ? " belongs to our " + product.series + " series. Finishing, hardware and internal layout follow the same standard across the series, so pieces can be combined into a matching set."
            : " is finished to the same standard as the rest of our range.") +
          "</p>" +
        "<h3>Materials &amp; finish</h3>" +
        "<p>" + product.material + "</p>";
    }

    if (info) {
      info.innerHTML =
        '<div style="overflow-x:auto">' +
          '<table class="fc-spec-table">' +
            "<tbody>" +
              "<tr><th scope=\"row\">SKU</th><td>" + product.sku + "</td></tr>" +
              "<tr><th scope=\"row\">Category</th><td>" + product.categoryLabel + "</td></tr>" +
              (brand ? '<tr><th scope="row">Brand</th><td><a href="' + brandHref() + '">' + brand.name + "</a></td></tr>" : "") +
              (product.series ? "<tr><th scope=\"row\">Series</th><td>" + product.series + "</td></tr>" : "") +
              "<tr><th scope=\"row\">Material</th><td>" + product.material + "</td></tr>" +
              "<tr><th scope=\"row\">Dimensions</th><td>" + product.dimensions + "</td></tr>" +
              "<tr><th scope=\"row\">Warranty</th><td>" + product.warranty + "</td></tr>" +
              (product.options
                ? Object.keys(product.options)
                    .map(function (k) {
                      return "<tr><th scope=\"row\">" + k + "</th><td>" + product.options[k].join(", ") + "</td></tr>";
                    })
                    .join("")
                : "") +
            "</tbody>" +
          "</table>" +
        "</div>";
    }

    /* tab behaviour */
    var tabs = qsa("[data-fc-tab]");
    if (!tabs.length) return;

    function select(name, focus) {
      tabs.forEach(function (tab) {
        var active = tab.getAttribute("data-fc-tab") === name;
        tab.setAttribute("aria-selected", String(active));
        tab.setAttribute("tabindex", active ? "0" : "-1");
        if (active && focus) tab.focus();
      });
      qsa("[data-fc-tabpanel]").forEach(function (panel) {
        panel.hidden = panel.getAttribute("data-fc-tabpanel") !== name;
      });
    }

    tabs.forEach(function (tab) {
      tab.addEventListener("click", function () {
        select(tab.getAttribute("data-fc-tab"), false);
      });
      tab.addEventListener("keydown", function (e) {
        if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
        e.preventDefault();
        var i = tabs.indexOf(tab);
        var next = e.key === "ArrowRight" ? (i + 1) % tabs.length : (i - 1 + tabs.length) % tabs.length;
        select(tabs[next].getAttribute("data-fc-tab"), true);
      });
    });

    select("description", false);
  }

  /* ---------------- related ---------------- */
  function renderRelated() {
    var host = qs("[data-fc-related]");
    if (!host) return;

    var others = D.products.filter(function (p) { return p.id !== product.id; });
    var same = others.filter(function (p) { return p.category === product.category; });
    if (same.length < 4) {
      others
        .filter(function (p) { return p.series === product.series && same.indexOf(p) < 0; })
        .forEach(function (p) { same.push(p); });
    }
    if (same.length < 4) {
      others.forEach(function (p) { if (same.indexOf(p) < 0) same.push(p); });
    }

    host.innerHTML = same.slice(0, 4).map(FC.productCard).join("");
    FC.cart.refresh();
  }

  /* ---------------- not found ---------------- */
  function showNotFound(id) {
    var wrap = qs("[data-fc-single]");
    var nf = qs("[data-fc-notfound]");
    if (wrap) wrap.hidden = true;
    if (nf) {
      nf.hidden = false;
      var msg = qs("[data-fc-notfound-msg]", nf);
      if (msg) {
        msg.textContent = id
          ? 'We could not find a product with the id "' + id + '".'
          : "No product was specified.";
      }
    }
    document.title = "Product not found - " + D.site.name;
  }

  /* ---------------- boot ---------------- */
  function init() {
    if (!window.FC_DATA || !qs("[data-fc-single]")) return;

    var id = FC.param("id");
    product = FC.cart.findProduct(id);

    if (!product) {
      showNotFound(id);
      return;
    }

    brand = findBrand();

    document.title = product.name + " - " + D.site.name;
    var crumb = qs("[data-fc-single-crumb]");
    if (crumb) crumb.textContent = product.name;
    var catCrumb = qs("[data-fc-single-catcrumb]");
    if (catCrumb) {
      catCrumb.textContent = product.categoryLabel;
      catCrumb.setAttribute("href", "shop.html?cat=" + product.category);
    }

    renderGallery();
    renderPanel();
    renderTabs();
    renderRelated();

    /* ?opt=King preselects a swatch coming from a product card */
    var opt = FC.param("opt");
    if (opt) {
      var sel = qs("[data-fc-option]");
      if (sel) {
        for (var i = 0; i < sel.options.length; i++) {
          if (sel.options[i].value === opt) {
            sel.selectedIndex = i;
            sel.dispatchEvent(new Event("change"));
            break;
          }
        }
      }
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})(window, document);
