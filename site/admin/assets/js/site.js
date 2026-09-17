/* ==========================================================================
   site.js — Company info (the `site` singleton).

   One flat form in four fieldsets. Two details that matter:

   * `phoneIntl` and `whatsapp` are DERIVED from `phone` (01600144705 →
     +8801600144705 / 8801600144705) behind an "enter them myself"
     disclosure. Three chances to typo a phone number become one.
   * `socials[].icon` is a select built from GET /api/admin/meta `iconKeys`,
     which is the key set of ICONS in components.js. An icon outside it is a
     warning on the server and renders as a generic box, so a free-text field
     here would be a trap.
   ========================================================================== */

(function (window, document) {
  "use strict";

  var FCA = window.FCA = window.FCA || {};

  function esc(v) { return FCA.util.esc(v); }
  function site() { return FCA.state.doc.site || (FCA.state.doc.site = {}); }
  function meta() { return FCA.state.meta || {}; }

  var OFFICE_KEYS = ["label", "street", "floor", "area", "address", "hotline", "email"];

  /* Bangladesh local format 01XXXXXXXXX → +880XXXXXXXXXX */
  function deriveIntl(phone) {
    var digits = String(phone || "").replace(/\D/g, "");
    if (!digits) return "";
    if (digits.charAt(0) === "0") return "+880" + digits.slice(1);
    if (digits.indexOf("880") === 0) return "+" + digits;
    return "+" + digits;
  }
  function deriveWhatsapp(phone) { return deriveIntl(phone).replace(/^\+/, ""); }

  function toForm(s) {
    var v = {
      name: s.name || "", tagline: s.tagline || "", legalName: s.legalName || "",
      year: s.year || "", currency: s.currency || "",
      phone: s.phone || "", phoneIntl: s.phoneIntl || "", whatsapp: s.whatsapp || "",
      email: s.email || "",
      socials: FCA.util.clone(s.socials || [])
    };
    var o = s.office || {};
    OFFICE_KEYS.forEach(function (k) { v["office." + k] = o[k] || ""; });
    /* If the derived values already match, the manual box stays closed. */
    v._manualPhones = !!(s.phone && (s.phoneIntl !== deriveIntl(s.phone) || s.whatsapp !== deriveWhatsapp(s.phone)));
    return v;
  }

  function toStored(v) {
    var out = {
      name: v.name.trim(), tagline: v.tagline.trim(), legalName: v.legalName.trim(),
      year: v.year.trim(), currency: v.currency.trim(),
      phone: v.phone.trim(),
      phoneIntl: (v._manualPhones ? v.phoneIntl : deriveIntl(v.phone)).trim(),
      whatsapp: (v._manualPhones ? v.whatsapp : deriveWhatsapp(v.phone)).trim(),
      email: v.email.trim(),
      office: {},
      socials: (v.socials || []).map(function (s) {
        return { label: String(s.label || "").trim(), href: String(s.href || "").trim(), icon: s.icon || "box" };
      }).filter(function (s) { return s.label || s.href; })
    };
    OFFICE_KEYS.forEach(function (k) { out.office[k] = String(v["office." + k] || "").trim(); });
    return out;
  }

  FCA.app.register("site", {
    render: function (host) {
      var v = toForm(site());
      var iconKeys = meta().iconKeys || ["box"];

      var page = document.createElement("div");
      page.className = "ad-page";
      page.innerHTML =
        '<div class="ad-page-head"><div>' +
          '<h1 class="ad-page-title">Company info</h1>' +
          '<p class="ad-page-sub">The name, phone number and address used in the header, the footer ' +
          "and the contact page.</p>" +
        "</div></div>" +
        '<div class="ad-editor"><div class="ad-editor-main"><div data-ad-form></div></div>' +
        '<aside class="ad-editor-side" data-ad-side></aside></div>';

      host.innerHTML = "";
      host.appendChild(page);

      var RE = FCA.fields.RE;

      var spec = [
        { type: "fieldset", legend: "1 · Identity", fields: [
          { key: "name", label: "Business name", type: "text", required: true, max: 60, width: "full" },
          { type: "group", fields: [
            { key: "legalName", label: "Legal name in the footer", type: "text", max: 60 },
            { key: "tagline", label: "Tagline", type: "text", max: 120 },
            { key: "year", label: "Copyright year", type: "text", required: true, max: 4,
              pattern: RE.year, patternMessage: "Enter a four-digit year, like 2026." },
            { key: "currency", label: "Currency symbol", type: "text", required: true, max: 3,
              help: "Shown before every price, e.g. ৳" }
          ] }
        ] },

        { type: "fieldset", legend: "2 · Contact", fields: [
          { type: "group", fields: [
            { key: "phone", label: "Hotline", type: "text", required: true, max: 15,
              pattern: RE.phone, patternMessage: "Enter it as 01600144705 — 11 digits starting with 0.",
              placeholder: "01600144705" },
            { key: "email", label: "Email", type: "text", required: true, kind: "email", max: 160 }
          ] },
          { key: "_manualPhones", label: "Enter the international numbers myself", type: "checkbox",
            checkboxLabel: "Enter the international numbers myself",
            help: "Normally these are worked out from the hotline above, so there is only one number to keep right." },
          { type: "group", className: "ad-grid-2", fields: [
            { key: "phoneIntl", label: "International number", type: "text", max: 16,
              pattern: RE.phoneIntl, patternMessage: "Digits only, optionally starting with +." },
            { key: "whatsapp", label: "WhatsApp number", type: "text", max: 15,
              pattern: RE.whatsapp, patternMessage: "Digits only, no + and no spaces." }
          ] }
        ] },

        { type: "fieldset", legend: "3 · Office", fields: [
          { key: "office.label", label: "Heading in the footer", type: "text", max: 160, width: "full" },
          { type: "group", fields: [
            { key: "office.street", label: "Street", type: "text", max: 160 },
            { key: "office.floor", label: "Floor / flat", type: "text", max: 160 },
            { key: "office.area", label: "Area and postcode", type: "text", max: 160 },
            { key: "office.hotline", label: "Office phone", type: "text", max: 160 }
          ] },
          { key: "office.address", label: "One-line address", type: "text", max: 160, width: "full",
            help: "Shown in the thin bar at the very top of every page." },
          { key: "office.email", label: "Office email", type: "text", max: 160, kind: "email", width: "full" }
        ] },

        { type: "fieldset", legend: "4 · Social links", fields: [
          { key: "socials", label: "Links in the footer", type: "repeat", itemNoun: "link", maxRows: 6,
            fields: [
              { key: "label", label: "Name", placeholder: "Facebook" },
              { key: "href", label: "Address", placeholder: "https://facebook.com/…" },
              { key: "icon", label: "Icon", type: "select", options: function () { return iconKeys; } }
            ],
            validate: function (rows) {
              for (var i = 0; i < (rows || []).length; i++) {
                if (!String(rows[i].label || "").trim()) return "Link " + (i + 1) + " has no name.";
                if (String(rows[i].label).length > 24) return "Link " + (i + 1) + ": that name is too long.";
                var h = FCA.fields.checkHref(String(rows[i].href || "").trim());
                if (h) return "Link " + (i + 1) + ": " + h;
              }
              return null;
            } }
        ] }
      ];

      var f = FCA.fields.form(page.querySelector("[data-ad-form]"), spec, v, {
        onChange: function (key) {
          if (key === "phone" || key === "_manualPhones") syncPhones();
          FCA.fields.setSaveBarStatus(bar, "dirty", "Unsaved changes");
          drawSide();
        }
      });

      /* keep the two derived numbers in step, and read-only while derived */
      function syncPhones() {
        var vals = f.values();
        var manual = !!vals._manualPhones;
        var intl = f.control("phoneIntl");
        var wa = f.control("whatsapp");
        if (!manual) {
          intl.set(deriveIntl(vals.phone));
          wa.set(deriveWhatsapp(vals.phone));
        }
        [intl, wa].forEach(function (c) {
          if (c.el) {
            c.el.readOnly = !manual;
            c.el.style.background = manual ? "" : "var(--fc-alt-bg)";
          }
        });
      }
      syncPhones();

      function drawSide() {
        var vals = f.values();
        page.querySelector("[data-ad-side]").innerHTML =
          '<div class="ad-card"><div class="ad-card-head"><h2>How it reads on the site</h2></div>' +
            '<div class="ad-card-body">' +
              '<p class="ad-preview-name" style="text-align:left;margin:0 0 4px">' + esc(vals.name || "—") + "</p>" +
              '<p class="ad-help" style="margin:0 0 12px">' + esc(vals.tagline || "") + "</p>" +
              '<ul class="ad-where">' +
                "<li>Hotline: " + esc(vals.phone || "—") + "</li>" +
                "<li>Calls as: " + esc(vals.phoneIntl || "—") + "</li>" +
                "<li>WhatsApp: " + esc(vals.whatsapp || "—") + "</li>" +
                "<li>" + esc(vals.email || "—") + "</li>" +
                "<li>" + esc(vals["office.address"] || "—") + "</li>" +
                "<li>Prices show as " + esc((vals.currency || "৳")) + " 23,500.00</li>" +
              "</ul>" +
            "</div></div>";
      }
      drawSide();

      var bar = FCA.fields.saveBar({
        backLabel: "Dashboard",
        onBack: function () { FCA.app.navigate("#/"); },
        onSave: doSave
      });
      page.appendChild(bar);
      FCA.fields.setSaveBarStatus(bar, FCA.app.isDirty("site") ? "dirty" : "clean",
        FCA.app.isDirty("site") ? "Unsaved changes" : "All changes saved");

      function doSave() {
        FCA.ui.clearBanners("validation");
        var errors = f.validate();
        if (errors.length) {
          FCA.ui.banner({
            tag: "validation", kind: "error",
            title: FCA.util.plural(errors.length, "field needs", "fields need") + " attention.",
            bodyHTML: " " + errors.map(function (e) { return esc(e.label); }).join(" · ")
          });
          f.focusFirstError();
          return;
        }

        FCA.state.doc.site = toStored(f.values());
        FCA.app.recomputeDirty("site");

        FCA.fields.setSaving(bar, true);
        FCA.fields.setSaveBarStatus(bar, "saving", "Saving…");
        FCA.app.saveCollection("site", {
          successMessage: "Company info saved.",
          onFieldErrors: function (fieldsMap, message) {
            /* office.* and socials/N/href arrive as JSON pointers; the form
               engine matches on the last segment, so office fields land on
               the right input only when the key matches — say the rest out
               loud rather than silently dropping it. */
            var painted = f.paintServerErrors(fieldsMap);
            FCA.ui.banner({
              tag: "validation", kind: "error",
              title: "The server would not accept this.",
              bodyHTML: " " + esc(message) +
                (painted.length ? " — " + painted.map(function (p) { return esc(p.label); }).join(" · ") : "") +
                '<ul class="ad-confirm-list">' + Object.keys(fieldsMap).map(function (k) {
                  return "<li><code>" + esc(k) + "</code> — " + esc(fieldsMap[k]) + "</li>";
                }).join("") + "</ul>"
            });
            f.focusFirstError();
          }
        }).then(function (ok) {
          FCA.fields.setSaving(bar, false);
          FCA.fields.setSaveBarStatus(bar, ok ? "clean" : "failed", ok ? "All changes saved" : "Could not save");
        });
      }
    }
  });

  FCA.site = { toStored: toStored, toForm: toForm, deriveIntl: deriveIntl, deriveWhatsapp: deriveWhatsapp };
})(window, document);
