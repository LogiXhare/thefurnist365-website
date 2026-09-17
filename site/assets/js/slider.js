/* ==========================================================================
   slider.js — hero slider: autoplay, arrows, dots, swipe, keyboard.
   Renders from FC_DATA.hero into [data-fc-hero].
   ========================================================================== */

(function (window, document) {
  "use strict";

  var D = window.FC_DATA;
  var FC = window.FC;

  function render(root) {
    var slides = D.hero
      .map(function (slide, i) {
        return (
          '<div class="fc-hero-slide' + (i === 0 ? " is-active" : "") + '" data-hero-slide="' + i + '" aria-hidden="' + (i === 0 ? "false" : "true") + '">' +
            '<div class="fc-hero-bg">' +
              '<img src="' + slide.image + '" alt="" ' + (i === 0 ? 'fetchpriority="high"' : 'loading="lazy"') + ">" +
            "</div>" +
            '<div class="fc-container">' +
              '<div class="fc-hero-content">' +
                '<h2 class="fc-hero-title">' + slide.title + "</h2>" +
                '<p class="fc-hero-text">' + slide.text + "</p>" +
                '<div class="fc-hero-cta"><a class="fc-btn fc-btn-lg" href="' + slide.href + '">' + slide.cta + "</a></div>" +
              "</div>" +
            "</div>" +
          "</div>"
        );
      })
      .join("");

    var dots = D.hero
      .map(function (slide, i) {
        return (
          '<button type="button" class="fc-hero-dot' + (i === 0 ? " is-active" : "") + '" data-hero-dot="' + i + '" aria-label="Go to slide ' + (i + 1) + '"></button>'
        );
      })
      .join("");

    root.innerHTML =
      '<div class="fc-hero-track" data-hero-track>' + slides + "</div>" +
      '<button type="button" class="fc-hero-arrow fc-hero-prev" data-hero-prev aria-label="Previous slide">' + FC.icons.arrowLeft + "</button>" +
      '<button type="button" class="fc-hero-arrow fc-hero-next" data-hero-next aria-label="Next slide">' + FC.icons.arrowRight + "</button>" +
      '<div class="fc-hero-dots" role="tablist">' + dots + "</div>";
  }

  function init() {
    var root = document.querySelector("[data-fc-hero]");
    if (!root) return;

    render(root);

    var slides = Array.prototype.slice.call(root.querySelectorAll("[data-hero-slide]"));
    var dots = Array.prototype.slice.call(root.querySelectorAll("[data-hero-dot]"));
    if (slides.length < 2) return;

    var index = 0;
    var timer = null;
    var DELAY = 6000;
    var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    function go(next) {
      index = (next + slides.length) % slides.length;
      slides.forEach(function (s, i) {
        var active = i === index;
        s.classList.toggle("is-active", active);
        s.setAttribute("aria-hidden", active ? "false" : "true");
      });
      dots.forEach(function (d, i) {
        d.classList.toggle("is-active", i === index);
      });
    }

    function start() {
      if (reduced) return;
      stop();
      timer = window.setInterval(function () { go(index + 1); }, DELAY);
    }
    function stop() {
      if (timer) { window.clearInterval(timer); timer = null; }
    }

    root.querySelector("[data-hero-next]").addEventListener("click", function () {
      go(index + 1);
      start();
    });
    root.querySelector("[data-hero-prev]").addEventListener("click", function () {
      go(index - 1);
      start();
    });
    dots.forEach(function (dot) {
      dot.addEventListener("click", function () {
        go(parseInt(dot.getAttribute("data-hero-dot"), 10));
        start();
      });
    });

    root.addEventListener("mouseenter", stop);
    root.addEventListener("mouseleave", start);
    root.addEventListener("focusin", stop);
    root.addEventListener("focusout", start);

    /* pause while the tab is hidden */
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) stop();
      else start();
    });

    /* touch swipe */
    var startX = null;
    root.addEventListener("touchstart", function (e) {
      startX = e.touches[0].clientX;
      stop();
    }, { passive: true });
    root.addEventListener("touchend", function (e) {
      if (startX === null) return;
      var dx = e.changedTouches[0].clientX - startX;
      if (Math.abs(dx) > 45) go(dx < 0 ? index + 1 : index - 1);
      startX = null;
      start();
    });

    /* keyboard when the slider has focus */
    root.setAttribute("tabindex", "-1");
    root.addEventListener("keydown", function (e) {
      if (e.key === "ArrowRight") { go(index + 1); start(); }
      if (e.key === "ArrowLeft") { go(index - 1); start(); }
    });

    start();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})(window, document);
