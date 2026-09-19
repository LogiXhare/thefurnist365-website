/* ==========================================================================
   home.js — renders the homepage sections from FC_DATA:
   category tiles, series blocks, new arrivals, inspiration, clients, USPs.
   ========================================================================== */

(function (window, document) {
  "use strict";

  var D = window.FC_DATA;
  var FC = window.FC;

  function fill(selector, html) {
    var el = document.querySelector(selector);
    if (el) el.innerHTML = html;
  }

  /* ---------- category tiles ---------- */
  function renderCategories() {
    fill(
      "[data-fc-categories]",
      D.categories
        .map(function (c) {
          return (
            '<a class="fc-cat-card" href="shop.html?cat=' + c.slug + '">' +
              '<img src="' + c.image + '" alt="' + c.label + '" loading="lazy" width="600" height="600">' +
              '<span class="fc-cat-card-label">' + c.label + "</span>" +
            "</a>"
          );
        })
        .join("")
    );
  }

  /* ---------- series blocks ---------- */
  function renderSeries() {
    fill(
      "[data-fc-series]",
      D.series
        .map(function (s) {
          return (
            '<div class="fc-series-row" data-fc-reveal>' +
              '<div class="fc-series-media">' +
                '<img src="' + s.image + '" alt="' + s.eyebrow + '" loading="lazy">' +
              "</div>" +
              '<div class="fc-series-body">' +
                '<span class="fc-section-eyebrow">' + s.eyebrow + "</span>" +
                '<h3 class="fc-series-title">' + s.title + "</h3>" +
                '<p class="fc-series-text">' + s.text + "</p>" +
                '<a class="fc-btn" href="' + s.href + '">' + s.cta + "</a>" +
              "</div>" +
            "</div>"
          );
        })
        .join("")
    );
  }

  /* ---------- new arrivals ---------- */
  function renderProducts() {
    fill("[data-fc-new-arrivals]", D.products.map(FC.productCard).join(""));
  }

  /* ---------- inspiration / shorts ---------- */
  function renderShorts() {
    var play =
      '<span class="fc-short-play"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7Z"/></svg></span>';

    var shorts = [
      { label: "Living room styling", image: "assets/img/category/living-room.webp" },
      { label: "Bedroom set tour", image: "assets/img/category/bed-room.jpg" },
      { label: "Dining collection", image: "assets/img/category/dining-room.jpg" },
      { label: "Office fit-out", image: "assets/img/category/office-furniture.jpg" }
    ];

    fill(
      "[data-fc-shorts]",
      shorts
        .map(function (s) {
          return (
            '<a class="fc-short" href="#" data-fc-reveal>' +
              '<img src="' + s.image + '" alt="' + s.label + '" loading="lazy">' +
              play +
              '<span class="fc-short-label">' + s.label + "</span>" +
            "</a>"
          );
        })
        .join("")
    );
  }

  /* ---------- corporate clients ---------- */
  function renderClients() {
    fill(
      "[data-fc-clients]",
      D.clients
        .map(function (c) {
          return (
            '<div class="fc-client">' +
              '<img src="' + c.image + '" alt="' + c.name + '" loading="lazy">' +
            "</div>"
          );
        })
        .join("")
    );
  }

  /* ---------- USP strip ---------- */
  function renderUsps() {
    var usps = [
      { icon: "box", title: "Nationwide Delivery", text: "Delivered across Bangladesh" },
      { icon: "store", title: "Office Visit", text: "See it before you buy" },
      { icon: "pdf", title: "E-catalogue", text: "Browse the full range" },
      { icon: "phone", title: "Hotline Support", text: D.site.phone }
    ];

    fill(
      "[data-fc-usps]",
      usps
        .map(function (u) {
          return (
            '<div class="fc-usp">' +
              '<span class="fc-usp-icon">' + (FC.icons[u.icon] || FC.icons.box) + "</span>" +
              "<div><h4>" + u.title + "</h4><p>" + u.text + "</p></div>" +
            "</div>"
          );
        })
        .join("")
    );
  }

  function init() {
    renderCategories();
    renderSeries();
    renderProducts();
    renderShorts();
    renderClients();
    renderUsps();
    FC.cart.refresh();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})(window, document);
