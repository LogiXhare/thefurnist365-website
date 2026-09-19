/* ==========================================================================
   components.js — shared chrome: icon set, header, mega menu, mobile drawer,
   mini-cart, search modal, footer. Every page gets the same markup from here.
   Mount points: <div data-fc-header></div> and <div data-fc-footer></div>
   ========================================================================== */

(function (window, document) {
  "use strict";

  var D = window.FC_DATA;

  /* ---------------- inline SVG icons ---------------- */
  var ICONS = {
    search:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
    user:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4.5 21c0-4.1 3.4-6.5 7.5-6.5s7.5 2.4 7.5 6.5"/></svg>',
    heart:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><path d="M12 20s-7.5-4.6-7.5-9.4A4.1 4.1 0 0 1 12 8a4.1 4.1 0 0 1 7.5 2.6C19.5 15.4 12 20 12 20Z"/></svg>',
    cart:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 7h12l-1.2 11.2a2 2 0 0 1-2 1.8H9.2a2 2 0 0 1-2-1.8Z"/><path d="M9 7a3 3 0 0 1 6 0"/></svg>',
    compare:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8h11l-3-3m3 3-3 3"/><path d="M20 16H9l3-3m-3 3 3 3"/></svg>',
    caret:
      '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m2 4.5 4 4 4-4"/></svg>',
    burger:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
    close:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>',
    phone:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6.5 3h3l1.5 4-2 1.5a11 11 0 0 0 5 5L15.5 11l4 1.5v3a2 2 0 0 1-2.2 2A15 15 0 0 1 4.5 5.2 2 2 0 0 1 6.5 3Z"/></svg>',
    mail:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3.5 6.5 8.5 6 8.5-6"/></svg>',
    pin:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s7-6.1 7-11a7 7 0 1 0-14 0c0 4.9 7 11 7 11Z"/><circle cx="12" cy="10" r="2.5"/></svg>',
    pdf:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z"/><path d="M14 3v5h5"/><path d="M12 11v6m0 0-2.2-2.2M12 17l2.2-2.2"/></svg>',
    store:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9h16v10a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1Z"/><path d="M3 9l2-5h14l2 5"/></svg>',
    eye:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 12S6 6.5 12 6.5 21.5 12 21.5 12 18 17.5 12 17.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="2.8"/></svg>',
    sun:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 3v2m0 14v2M3 12h2m14 0h2M5.6 5.6l1.4 1.4m10 10 1.4 1.4m0-12.8-1.4 1.4m-10 10-1.4 1.4"/></svg>',
    moon:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 13.5A8 8 0 1 1 10.5 4a6.5 6.5 0 0 0 9.5 9.5Z"/></svg>',
    arrowUp:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5m0 0-6 6m6-6 6 6"/></svg>',
    arrowLeft:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 12H5m0 0 6-6m-6 6 6 6"/></svg>',
    arrowRight:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14m0 0-6-6m6 6-6 6"/></svg>',
    whatsapp:
      '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2a10 10 0 0 0-8.5 15.2L2 22l4.9-1.4A10 10 0 1 0 12 2Zm5.3 14c-.2.6-1.2 1.2-1.7 1.2-.5.1-1 .1-1.7-.1a9.6 9.6 0 0 1-4-2.6 8.4 8.4 0 0 1-1.8-3c-.2-.6 0-1.2.3-1.6l.5-.6c.2-.2.4-.2.6-.2h.4c.2 0 .4 0 .5.4l.7 1.7c.1.2 0 .4-.1.5l-.3.4-.3.3c-.1.1-.2.3 0 .5a7 7 0 0 0 1.3 1.6 6 6 0 0 0 1.8 1.1c.2.1.4.1.5 0l.7-.8c.2-.2.4-.2.6-.1l1.6.8c.3.1.4.3.4.5s0 .6-.2 1Z"/></svg>',
    facebook:
      '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M14 9h3V6h-3c-2.2 0-4 1.8-4 4v2H8v3h2v6h3v-6h2.5l.5-3H13v-2c0-.6.4-1 1-1Z"/></svg>',
    instagram:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="4.5"/><circle cx="12" cy="12" r="3.4"/><circle cx="17" cy="7" r="1" fill="currentColor" stroke="none"/></svg>',
    youtube:
      '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M21.4 8.2a2.5 2.5 0 0 0-1.8-1.8C18 6 12 6 12 6s-6 0-7.6.4A2.5 2.5 0 0 0 2.6 8.2C2.2 9.8 2.2 12 2.2 12s0 2.2.4 3.8a2.5 2.5 0 0 0 1.8 1.8C6 18 12 18 12 18s6 0 7.6-.4a2.5 2.5 0 0 0 1.8-1.8c.4-1.6.4-3.8.4-3.8s0-2.2-.4-3.8ZM10.2 15V9l5.2 3-5.2 3Z"/></svg>',
    linkedin:
      '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6.5 8H4v12h2.5V8Zm-1.2-1.3a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3ZM20 13.6c0-3.2-1.7-4.6-3.9-4.6-1.5 0-2.4.8-2.8 1.5V8H10.8v12h2.5v-6.4c0-1.4.7-2.2 1.9-2.2s1.8.8 1.8 2.2V20H20v-6.4Z"/></svg>',
    box:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 8l9-4 9 4-9 4Z"/><path d="M3 8v8l9 4 9-4V8"/><path d="M12 12v8"/></svg>'
  };

  /* ---------------- money helper ---------------- */
  function money(value) {
    var n = Number(value) || 0;
    return (
      D.site.currency +
      "&nbsp;" +
      n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    );
  }

  /* Price markup for a product (single price or range). */
  function priceHTML(product) {
    if (product.priceMin != null && product.priceMax != null) {
      return (
        '<span class="fc-price fc-price-range">' +
        "<span>" + money(product.priceMin) + "</span>" +
        '<span aria-hidden="true">–</span>' +
        "<span>" + money(product.priceMax) + "</span>" +
        "</span>"
      );
    }
    return '<span class="fc-price"><span>' + money(product.price) + "</span></span>";
  }

  /* ---------------- product card ---------------- */
  function productCard(product) {
    var href = "product.html?id=" + encodeURIComponent(product.id);
    var swatches = "";
    if (product.swatches && product.swatches.length) {
      swatches =
        '<div class="fc-swatches">' +
        product.swatches
          .map(function (s) {
            return '<a class="fc-swatch" href="' + href + "&amp;opt=" + encodeURIComponent(s) + '">' + s + "</a>";
          })
          .join("") +
        "</div>";
    }

    var labels = product.badge
      ? '<div class="fc-product-labels"><span class="fc-badge fc-badge-new">' + product.badge + "</span></div>"
      : "";

    return (
      '<article class="fc-product" data-product-id="' + product.id + '">' +
        '<div class="fc-product-media">' +
          labels +
          '<a href="' + href + '" aria-label="' + product.name + '">' +
            '<img src="' + product.image + '" alt="' + product.name + '" loading="lazy" width="600" height="600">' +
          "</a>" +
          '<div class="fc-product-actions">' +
            '<button type="button" class="fc-product-action" data-fc-wishlist="' + product.id + '" title="Add to wishlist" aria-label="Add ' + product.name + ' to wishlist">' + ICONS.heart + "</button>" +
            '<button type="button" class="fc-product-action" data-fc-quickview="' + product.id + '" title="Quick view" aria-label="Quick view of ' + product.name + '">' + ICONS.eye + "</button>" +
            '<button type="button" class="fc-product-action" data-fc-compare="' + product.id + '" title="Compare" aria-label="Compare ' + product.name + '">' + ICONS.compare + "</button>" +
          "</div>" +
        "</div>" +
        '<div class="fc-product-body">' +
          '<span class="fc-product-cat">' + product.categoryLabel + "</span>" +
          '<h3 class="fc-product-title"><a href="' + href + '">' + product.name + "</a></h3>" +
          priceHTML(product) +
          swatches +
          '<div class="fc-product-cta">' +
            '<a class="fc-btn fc-btn-sm fc-btn-outline" href="' + href + '">Select options</a>' +
          "</div>" +
          '<p class="fc-product-note">This product has multiple variants. The options may be chosen on the product page</p>' +
        "</div>" +
      "</article>"
    );
  }

  /* ---------------- mega menu ---------------- */
  function megaHTML(item) {
    if (!item.groups || !item.groups.length) return "";

    var cols = item.groups
      .map(function (g) {
        return (
          '<div class="fc-mega-col">' +
            '<h4 class="fc-mega-col-title">' + g.title + "</h4>" +
            '<ul class="fc-mega-list">' +
              g.items
                .map(function (l) {
                  return '<li><a href="' + l.href + '">' + l.label + "</a></li>";
                })
                .join("") +
            "</ul>" +
          "</div>"
        );
      })
      .join("");

    var promo = item.promo
      ? '<a class="fc-mega-promo" href="' + item.promo.href + '" style="background-image:linear-gradient(180deg,rgba(0,0,0,.05),rgba(0,0,0,.6)),url(' + item.promo.image + ')">' +
          '<span class="fc-mega-promo-title">' + item.promo.title + "</span>" +
          "<p>" + item.promo.text + "</p>" +
        "</a>"
      : "";

    var colCount = item.cols || item.groups.length;
    var klass = colCount === 1 && !item.promo ? "fc-mega fc-dropdown" : "fc-mega";

    return (
      '<div class="' + klass + '" style="--fc-mega-cols:' + (colCount + (item.promo ? 1 : 0)) + '">' +
        '<div class="fc-mega-cols">' + cols + promo + "</div>" +
      "</div>"
    );
  }

  /* ---------------- brand logo ----------------
     The client's traced artwork, shipped as SVG in two lockups: the full
     stacked one (icon + "FURNIST 365" wordmark) used everywhere the brand
     mark appears, and the tower mark alone for the sticky mini-navbar, where
     the row is too short for the wordmark to read at all. `size` picks the
     lockup and drives the height set in header.css; it defaults to "lg".
     The header used to swap to the tower-only mark below 640px, but that
     dropped the "FURNIST 365" name entirely on phones — the client asked for
     the full lockup on every screen size, so it renders here unconditionally
     and header.css keeps it legible at the mobile row heights instead.
     width/height are the viewBox ratios scaled x4: HTML dimension attributes
     must be integers, and these reserve the exact box so nothing shifts.
     alt is empty on purpose — every call site wraps this in an <a> that already
     carries aria-label="<site name> home".

     Each lockup ships twice. The artwork draws the tower, "THE" and "365" in
     near-black, which disappears on the dark theme's ground, and no CSS
     filter can lift just those without also wrecking the orange plate — so
     the -dark files recolour exactly that one path to cream and leave
     "FURNIST" dark, because it sits on the orange plate in both themes.
     CSS shows one and hides the other; both are in the markup so the swap
     costs no request when the viewer toggles. */
  var LOGO_ART = {
    full: { file: "logo.svg", dark: "logo-dark.svg", w: "814", h: "705" },
    mark: { file: "logo-mark.svg", dark: "logo-mark-dark.svg", w: "351", h: "467" }
  };

  function logoImg(art, size) {
    var dims = ' alt="" width="' + art.w + '" height="' + art.h + '">';
    return (
      '<img class="fc-logo-img fc-logo-' + size + ' fc-logo-on-dark"' +
        ' src="assets/img/brand/' + art.dark + '"' + dims +
      '<img class="fc-logo-img fc-logo-' + size + ' fc-logo-on-light"' +
        ' src="assets/img/brand/' + art.file + '"' + dims
    );
  }

  function logo(size) {
    var key = size || "lg";
    if (key === "sm") {
      return logoImg(LOGO_ART.mark, key);
    }

    return logoImg(LOGO_ART.full, key);
  }

  /* ---------------- header ---------------- */
  function headerHTML() {
    var s = D.site;

    /* search category options built from the top-level menu */
    var catOptions =
      '<option value="">All Categories</option>' +
      D.menu
        .filter(function (m) { return m.label !== "More"; })
        .map(function (m) {
          return '<option value="' + D.slug(m.label) + '">' + m.label + "</option>";
        })
        .join("");

    var navItems = D.menu
      .map(function (item) {
        var hasMega = item.groups && item.groups.length;
        return (
          '<li class="fc-nav-item' + (item.alignRight ? " fc-nav-item-right" : "") + '" data-nav="' + D.slug(item.label) + '">' +
            '<a class="fc-nav-link" href="' + item.href + '"' + (hasMega ? ' aria-expanded="false"' : "") + ">" +
              item.label +
              (hasMega ? '<span class="fc-nav-caret">' + ICONS.caret + "</span>" : "") +
            "</a>" +
            megaHTML(item) +
          "</li>"
        );
      })
      .join("");

    return (
      '<div class="fc-header-wrap">' +
        /* ---- top bar ---- */
        '<div class="fc-topbar">' +
          '<div class="fc-container fc-topbar-inner">' +
            '<div class="fc-topbar-left">' +
              '<span class="fc-topbar-item">' + ICONS.pin +
                /* own element so it can ellipsise: a bare text node inside a
                   flex row is an anonymous item and text-overflow skips it */
                '<span class="fc-topbar-address">' + s.office.address + "</span>" +
              "</span>" +
            "</div>" +
            '<div class="fc-topbar-right">' +
              '<a class="fc-topbar-item" href="tel:' + s.phoneIntl + '">' + ICONS.phone + "Hotline: " + s.phone + "</a>" +
              '<span class="fc-topbar-sep"></span>' +
              '<a class="fc-topbar-item" href="catalogue.html">' + ICONS.pdf + "E-catalogue</a>" +
              '<span class="fc-topbar-sep"></span>' +
              '<a class="fc-topbar-item" href="contact.html#showroom">' + ICONS.store + "Showroom</a>" +
              '<span class="fc-topbar-sep"></span>' +
              '<a class="fc-topbar-item" href="login.html" data-fc-account-link>' + ICONS.user + '<span data-fc-account-label>Login / Register</span></a>' +
              '<span class="fc-topbar-sep"></span>' +
              '<button type="button" class="fc-topbar-item fc-theme-toggle" data-fc-theme-toggle aria-pressed="false">' +
                '<span class="fc-theme-icon-dark">' + ICONS.sun + "</span>" +
                '<span class="fc-theme-icon-light">' + ICONS.moon + "</span>" +
                '<span data-fc-theme-label>Light mode</span>' +
              "</button>" +
            "</div>" +
          "</div>" +
        "</div>" +

        /* ---- main header ---- */
        '<div class="fc-header">' +
          '<div class="fc-container fc-header-inner">' +
            '<button type="button" class="fc-burger" data-fc-open-drawer aria-label="Open menu" aria-controls="fc-drawer" aria-expanded="false">' + ICONS.burger + "</button>" +
            '<a class="fc-logo" href="index.html" aria-label="' + s.name + ' home">' +
              logo("lg") +
            "</a>" +
            '<div class="fc-search">' +
              '<form class="fc-search-form" role="search" data-fc-search-form action="shop.html" method="get">' +
                '<label class="fc-visually-hidden" for="fc-search-cat">Product category</label>' +
                '<select class="fc-search-cat" id="fc-search-cat" name="cat">' + catOptions + "</select>" +
                '<label class="fc-visually-hidden" for="fc-search-input">Search products</label>' +
                '<input class="fc-search-input" id="fc-search-input" type="search" name="q" placeholder="Products search" autocomplete="off">' +
                '<button class="fc-search-btn" type="submit" aria-label="Search">' + ICONS.search + "</button>" +
              "</form>" +
            "</div>" +
            '<div class="fc-header-tools">' +
              '<button type="button" class="fc-tool fc-mobile-search-toggle" data-fc-open-search aria-label="Search">' + ICONS.search + "</button>" +
              '<a class="fc-tool" href="wishlist.html" aria-label="Wishlist">' +
                '<span class="fc-tool-icon">' + ICONS.heart + '<span class="fc-count-bubble" data-fc-wishlist-count>0</span></span>' +
              "</a>" +
              '<a class="fc-tool" href="login.html" data-fc-account-link>' +
                '<span class="fc-tool-icon">' + ICONS.user + "</span>" +
                '<span class="fc-tool-text"><span class="fc-tool-label">Account</span><span class="fc-tool-value" data-fc-account-label>Login</span></span>' +
              "</a>" +
              '<button type="button" class="fc-tool" data-fc-open-cart aria-label="Open cart" aria-controls="fc-minicart" aria-expanded="false">' +
                '<span class="fc-tool-icon">' + ICONS.cart + '<span class="fc-count-bubble" data-fc-cart-count>0</span></span>' +
                '<span class="fc-tool-text"><span class="fc-tool-label">Cart</span><span class="fc-tool-value" data-fc-cart-total>' + money(0) + "</span></span>" +
              "</button>" +
            "</div>" +
          "</div>" +
        "</div>" +

        /* ---- nav bar ---- */
        '<div class="fc-navbar" data-fc-navbar>' +
          '<div class="fc-container fc-navbar-inner">' +
            '<a class="fc-navbar-sticky-logo" href="index.html" aria-label="' + s.name + ' home">' + logo("sm") + "</a>" +
            '<nav class="fc-nav" aria-label="Main navigation">' +
              '<ul class="fc-nav-list">' + navItems + "</ul>" +
            "</nav>" +
            '<div class="fc-navbar-aside">' +
              '<a href="dealer.html">Become a Dealer</a>' +
              '<a class="fc-navbar-hotline" href="tel:' + s.phoneIntl + '">' + ICONS.phone + s.phone + "</a>" +
            "</div>" +
          "</div>" +
        "</div>" +
        '<div class="fc-navbar-spacer" data-fc-navbar-spacer></div>' +
      "</div>" +

      /* ---- mobile drawer ---- */
      '<div class="fc-drawer" id="fc-drawer" data-fc-drawer aria-hidden="true">' +
        '<div class="fc-drawer-head">' +
          '<a href="index.html" aria-label="' + s.name + ' home">' + logo("sm") + "</a>" +
          '<button type="button" class="fc-drawer-close" data-fc-close-drawer aria-label="Close menu">' + ICONS.close + "</button>" +
        "</div>" +
        '<div class="fc-drawer-body">' +
          '<ul class="fc-drawer-list">' +
            D.menu
              .map(function (item, i) {
                var hasSub = item.groups && item.groups.length;
                var subId = "fc-drawer-sub-" + i;
                var sub = hasSub
                  ? '<ul class="fc-drawer-sub" id="' + subId + '" hidden>' +
                      item.groups
                        .map(function (g) {
                          return (
                            '<li class="fc-drawer-sub-group">' +
                              '<p class="fc-drawer-sub-title">' + g.title + "</p>" +
                              g.items
                                .map(function (l) {
                                  return '<a href="' + l.href + '">' + l.label + "</a>";
                                })
                                .join("") +
                            "</li>"
                          );
                        })
                        .join("") +
                    "</ul>"
                  : "";
                return (
                  "<li>" +
                    '<div class="fc-drawer-row">' +
                      '<a class="fc-drawer-link" href="' + item.href + '">' + item.label + "</a>" +
                      (hasSub
                        ? '<button type="button" class="fc-drawer-toggle" data-fc-drawer-toggle aria-expanded="false" aria-controls="' + subId + '" aria-label="Toggle ' + item.label + ' submenu">' + ICONS.caret + "</button>"
                        : "") +
                    "</div>" +
                    sub +
                  "</li>"
                );
              })
              .join("") +
          "</ul>" +
        "</div>" +
        '<div class="fc-drawer-foot">' +
          '<a href="login.html" data-fc-account-link><strong data-fc-account-label>Login / Register</strong></a>' +
          '<a href="dealer.html">Become a Dealer</a>' +
          '<a href="tel:' + s.phoneIntl + '">Hotline: ' + s.phone + "</a>" +
        "</div>" +
      "</div>" +

      /* ---- mini cart ---- */
      '<aside class="fc-minicart" id="fc-minicart" data-fc-minicart aria-hidden="true" aria-label="Shopping cart">' +
        '<div class="fc-minicart-head">' +
          "<h3>Shopping cart</h3>" +
          '<button type="button" class="fc-drawer-close" data-fc-close-cart aria-label="Close cart">' + ICONS.close + "</button>" +
        "</div>" +
        '<div class="fc-minicart-body" data-fc-minicart-body></div>' +
        '<div class="fc-minicart-foot">' +
          '<div class="fc-minicart-total"><span>Subtotal</span><span data-fc-cart-total>' + money(0) + "</span></div>" +
          '<a class="fc-btn fc-btn-block" href="cart.html">View cart</a>' +
        "</div>" +
      "</aside>" +

      /* ---- search modal (mobile) ---- */
      '<div class="fc-search-modal" data-fc-search-modal aria-hidden="true">' +
        '<button type="button" class="fc-search-modal-close" data-fc-close-search aria-label="Close search">' + ICONS.close + "</button>" +
        '<div class="fc-search-modal-inner">' +
          '<form class="fc-search-form" role="search" data-fc-search-form action="shop.html" method="get">' +
            '<label class="fc-visually-hidden" for="fc-search-modal-input">Search products</label>' +
            '<input class="fc-search-input" id="fc-search-modal-input" type="search" name="q" placeholder="Products search" autocomplete="off">' +
            '<button class="fc-search-btn" type="submit" aria-label="Search">' + ICONS.search + "</button>" +
          "</form>" +
          '<div class="fc-search-results" data-fc-search-results></div>' +
        "</div>" +
      "</div>" +

      '<div class="fc-overlay" data-fc-overlay></div>'
    );
  }

  /* ---------------- footer ---------------- */
  function footerHTML() {
    var s = D.site;

    var linkCols = D.footerLinks
      .map(function (col) {
        return (
          "<div>" +
            '<h4 class="fc-footer-title">' + col.title + "</h4>" +
            '<ul class="fc-footer-list">' +
              col.items
                .map(function (l) {
                  return '<li><a href="' + l.href + '">' + l.label + "</a></li>";
                })
                .join("") +
            "</ul>" +
          "</div>"
        );
      })
      .join("");

    var o = s.office;

    var officeCol =
      "<div>" +
        '<h4 class="fc-footer-title">' + o.label + "</h4>" +
        '<ul class="fc-footer-contact">' +
          "<li>" + ICONS.pin +
            "<span>" + o.street + "<br>" + o.floor + "<br>" + o.area + "</span>" +
          "</li>" +
          "<li>" + ICONS.phone +
            '<span><strong>Hotline:</strong> <a href="tel:' + s.phoneIntl + '">' + s.phone + "</a></span>" +
          "</li>" +
          "<li>" + ICONS.mail +
            '<span><a href="mailto:' + s.email + '">' + s.email + "</a></span>" +
          "</li>" +
        "</ul>" +
      "</div>";

    var socials = s.socials
      .map(function (soc) {
        return '<a class="fc-social" href="' + soc.href + '" aria-label="' + soc.label + '">' + (ICONS[soc.icon] || ICONS.box) + "</a>";
      })
      .join("");

    var brandCol =
      "<div>" +
        '<a class="fc-footer-brand" href="index.html" aria-label="' + s.name + ' home">' + logo("md") + "</a>" +
        '<p class="fc-footer-about">' + s.tagline +
          ". Furniture for homes, offices, institutions and hospitals &mdash; " +
          "delivered across Bangladesh.</p>" +
        '<div class="fc-socials">' + socials + "</div>" +
      "</div>";

    return (
      '<footer class="fc-footer">' +
        '<div class="fc-container fc-footer-main">' +
          brandCol +
          linkCols +
          officeCol +
        "</div>" +
        '<div class="fc-footer-bottom">' +
          '<div class="fc-container fc-footer-bottom-inner">' +
            "<span><strong>" + s.legalName + "</strong> " + s.year + " All Rights Reserved.</span>" +
            '<span class="fc-payments"><img src="assets/img/brand/payments.png" alt="Accepted payment methods" loading="lazy"></span>' +
          "</div>" +
        "</div>" +
      "</footer>" +

      '<button type="button" class="fc-to-top" data-fc-to-top aria-label="Back to top">' + ICONS.arrowUp + "</button>" +
      '<div class="fc-float-contact">' +
        '<a class="fc-float-btn" href="https://wa.me/' + s.whatsapp + '" target="_blank" rel="noopener" aria-label="Chat on WhatsApp">' + ICONS.whatsapp + "</a>" +
        '<a class="fc-float-btn fc-float-btn-call" href="tel:' + s.phoneIntl + '" aria-label="Call hotline">' + ICONS.phone + "</a>" +
      "</div>" +
      '<div class="fc-toast-stack" data-fc-toasts aria-live="polite"></div>'
    );
  }

  /* ---------------- theme ----------------
     Dark is the house look, so "no stored choice" means dark and the OS
     setting is never consulted. The <head> of every page applies the stored
     choice before first paint; this only handles the toggle itself and the
     label, which cannot run earlier because the header is built here. */
  var THEME_KEY = "fc365-theme";

  function currentTheme() {
    return document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
  }

  function paintToggle(btn) {
    var light = currentTheme() === "light";
    var label = btn.querySelector("[data-fc-theme-label]");
    btn.setAttribute("aria-pressed", light ? "true" : "false");
    if (label) label.textContent = light ? "Dark mode" : "Light mode";
  }

  function bindThemeToggle() {
    var btn = document.querySelector("[data-fc-theme-toggle]");
    if (!btn) return;
    paintToggle(btn);

    btn.addEventListener("click", function () {
      var next = currentTheme() === "light" ? "dark" : "light";
      var root = document.documentElement;

      /* Suppress transitions across the swap, then clear on a timer —
         rAF does not reliably fire in a backgrounded tab, and a class left
         on would kill every hover transition for the rest of the session. */
      root.classList.add("fc-theme-switching");
      if (next === "light") root.setAttribute("data-theme", "light");
      else root.removeAttribute("data-theme");
      window.setTimeout(function () {
        root.classList.remove("fc-theme-switching");
      }, 80);

      try {
        window.localStorage.setItem(THEME_KEY, next);
      } catch (e) {
        /* private mode or storage blocked: the choice simply will not stick */
      }
      paintToggle(btn);
    });
  }

  /* ---------------- mount ---------------- */
  function mount() {
    var head = document.querySelector("[data-fc-header]");
    var foot = document.querySelector("[data-fc-footer]");
    if (head) head.innerHTML = headerHTML();
    if (foot) foot.innerHTML = footerHTML();
    bindThemeToggle();

    /* mark the active top-level nav item */
    var current = document.body.getAttribute("data-fc-nav");
    if (current) {
      var el = document.querySelector('.fc-nav-item[data-nav="' + current + '"]');
      if (el) el.classList.add("is-current");
    }
  }

  window.FC = window.FC || {};
  window.FC.icons = ICONS;
  window.FC.money = money;
  window.FC.priceHTML = priceHTML;
  window.FC.productCard = productCard;
  window.FC.mountChrome = mount;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount);
  } else {
    mount();
  }
})(window, document);
