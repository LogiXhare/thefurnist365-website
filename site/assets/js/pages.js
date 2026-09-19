/* ==========================================================================
   pages.js — about / contact / dealer / catalogue.
   Renders the data-driven bits (offices, clients, category tiles) and runs
   client-side validation for the demo forms. Nothing is submitted anywhere.
   ========================================================================== */

(function (window, document) {
  "use strict";

  var D = window.FC_DATA;
  var FC = window.FC;

  function qs(sel, root) { return (root || document).querySelector(sel); }
  function qsa(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  var BD_PHONE_RE = /^(?:\+?880|0)1[3-9]\d{8}$/;

  /* ---------------- shared renderers ---------------- */
  function renderClients() {
    var host = qs("[data-fc-clients]");
    if (!host) return;
    host.innerHTML = D.clients
      .map(function (c) {
        return '<div class="fc-client"><img src="' + c.image + '" alt="' + c.name + '" loading="lazy"></div>';
      })
      .join("");
  }

  function renderCategoryTiles() {
    var host = qs("[data-fc-page-categories]");
    if (!host) return;
    host.innerHTML = D.categories
      .map(function (c) {
        return (
          '<a class="fc-cat-card" href="shop.html?cat=' + c.slug + '">' +
            '<img src="' + c.image + '" alt="' + c.label + '" loading="lazy">' +
            '<span class="fc-cat-card-label">' + c.label + "</span>" +
          "</a>"
        );
      })
      .join("");
  }

  function renderOffices() {
    var host = qs("[data-fc-offices]");
    if (!host) return;

    var s = D.site;
    var o = s.office;

    var officeCard =
      '<div class="fc-office-card">' +
        "<h2>" + o.label + "</h2>" +
        '<ul class="fc-office-list">' +
          "<li>" + FC.icons.pin +
            "<span>" + FC.officeAddress(o) + "</span>" +
          "</li>" +
          "<li>" + FC.icons.store + "<span>Showroom and office at the same address.</span></li>" +
        "</ul>" +
      "</div>";

    var contactCard =
      '<div class="fc-office-card">' +
        "<h2>Call or message us</h2>" +
        '<ul class="fc-office-list">' +
          "<li>" + FC.icons.phone +
            '<span><strong>Hotline:</strong> <a href="tel:' + s.phoneIntl + '">' + FC.phoneText(s) + "</a></span>" +
          "</li>" +
          "<li>" + FC.icons.whatsapp +
            '<span><strong>WhatsApp:</strong> <a href="https://wa.me/' + s.whatsapp + '" target="_blank" rel="noopener">' + FC.phoneText(s) + "</a></span>" +
          "</li>" +
          "<li>" + FC.icons.mail +
            '<span><a href="mailto:' + s.email + '">' + s.email + "</a></span>" +
          "</li>" +
        "</ul>" +
      "</div>";

    host.innerHTML = officeCard + contactCard;
  }

  function renderStats() {
    var host = qs("[data-fc-stats]");
    if (!host) return;

    var stats = [
      { value: D.categories.length + "", label: "Product collections" },
      { value: D.clients.length + "+", label: "Corporate clients" },
      { value: "5", label: "Segments served" },
      { value: "64", label: "Districts we deliver to" }
    ];

    host.innerHTML = stats
      .map(function (s) {
        return '<div class="fc-stat"><strong>' + s.value + "</strong><span>" + s.label + "</span></div>";
      })
      .join("");
  }

  /* ---------------- validation ---------------- */
  function setError(input, message) {
    var box = document.getElementById(input.id + "-error");
    if (box) box.textContent = message || "";
    if (message) input.setAttribute("aria-invalid", "true");
    else input.removeAttribute("aria-invalid");
    return !message;
  }

  function validateField(input) {
    var v = (input.value || "").trim();
    var label = input.getAttribute("data-label") || "This field";

    if (input.hasAttribute("data-required") && !v) {
      return setError(input, label + " is required.");
    }
    if (!v) return setError(input, "");

    if (input.type === "email" && !EMAIL_RE.test(v)) {
      return setError(input, "Enter a valid email address.");
    }
    if (input.type === "tel" && !BD_PHONE_RE.test(v.replace(/[\s-]/g, ""))) {
      return setError(input, "Enter a valid Bangladeshi mobile number, e.g. 01600144705.");
    }
    return setError(input, "");
  }

  function initForm(form) {
    var noticeSel = form.getAttribute("data-fc-notice");
    var box = noticeSel ? qs(noticeSel) : null;

    var fields = qsa("input, select, textarea", form).filter(function (el) {
      return el.type !== "checkbox" && el.type !== "submit" && el.id;
    });

    fields.forEach(function (el) {
      el.addEventListener("blur", function () { validateField(el); });
    });

    form.addEventListener("submit", function (e) {
      e.preventDefault();

      var ok = true;
      fields.forEach(function (el) {
        if (!validateField(el)) ok = false;
      });

      /* required checkboxes (e.g. dealer terms) */
      qsa('input[type="checkbox"][data-required]', form).forEach(function (box2) {
        var err = document.getElementById(box2.id + "-error");
        if (!box2.checked) {
          if (err) err.textContent = "Please accept this to continue.";
          ok = false;
        } else if (err) {
          err.textContent = "";
        }
      });

      if (!ok) {
        if (box) {
          box.className = "fc-notice fc-notice-error";
          box.textContent = "Please correct the highlighted fields.";
          box.hidden = false;
        }
        return;
      }

      if (box) {
        box.className = "fc-notice fc-notice-success";
        box.innerHTML =
          "<strong>Thanks — your details look good.</strong><br>" +
          "This front-end demo does not send messages anywhere. To reach us for real, " +
          'call <a href="tel:' + D.site.phoneIntl + '">' + FC.phoneText(D.site) + "</a>.";
        box.hidden = false;
        box.scrollIntoView({ behavior: "smooth", block: "center" });
      }
      form.reset();
    });
  }

  /* ---------------- catalogue downloads ---------------- */
  function initCatalogue() {
    qsa("[data-fc-catalogue-download]").forEach(function (btn) {
      btn.addEventListener("click", function (e) {
        e.preventDefault();
        FC.toast("Catalogue PDF is not included in this front-end demo.");
      });
    });
  }

  /* ---------------- boot ---------------- */
  function init() {
    if (!window.FC_DATA) return;

    renderClients();
    renderCategoryTiles();
    renderOffices();
    renderStats();
    initCatalogue();

    qsa("[data-fc-form]").forEach(initForm);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})(window, document);
