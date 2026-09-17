/* ==========================================================================
   list-editor.js — two things:

   1. FCA.fields — a small declarative form engine (render, read, validate,
      paint server errors). Reused by products.js, menu.js and site.js.
   2. FCA.listEditor — the generic list + editor screen, driven by a schema.
      Categories, Series, Brands, Clients, Hero slides, Footer links and Bed
      sizes are all this one screen with different fields.

   The client-side rules mirror docs/api-admin.md §7 so the owner gets a fast,
   plain-English error. The server is still the authority and will reject
   anything that slips through; its `fields` map is painted onto the same
   inputs by paintServerErrors().
   ========================================================================== */

(function (window, document) {
  "use strict";

  var FCA = window.FCA = window.FCA || {};
  var api = FCA.api;

  function esc(v) { return FCA.util.esc(v); }

  /* ======================================================================
     validation primitives — mirrors of the server's rules
     ====================================================================== */

  var RE = {
    slug: /^[a-z0-9-]+$/,
    productId: /^[a-z0-9][a-z0-9-]{1,63}$/,
    sku: /^[A-Za-z0-9./ -]+$/,
    sub: /^[a-z0-9-]{1,60}$/,
    year: /^\d{4}$/,
    phone: /^0\d{9,10}$/,
    phoneIntl: /^\+?\d{10,15}$/,
    whatsapp: /^\d{10,15}$/,
    email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
    image: /^assets\/img\/(brand|brands|hero|category|product|client)\/[a-z0-9._-]+\.(jpg|jpeg|png|webp|gif|svg)$/
  };

  /* The load-bearing one. Every storefront renderer concatenates data into
     innerHTML unescaped, so the server bans these two characters outright;
     catching it here saves a round trip and explains why. */
  function checkAngle(v) {
    if (/[<>]/.test(v)) return "The characters < and > cannot be used here.";
    return null;
  }

  function checkHref(v) {
    if (!v) return null;
    if (v.length > 300) return "That link is too long.";
    if (/^\s*(javascript|data|vbscript):/i.test(v)) return "That kind of link is not allowed.";
    if (/[\x00-\x1f\x7f]/.test(v)) return "That link contains characters that are not allowed.";
    var ok =
      /^[A-Za-z0-9._-]+\.html(\?[^\s]*)?(#[^\s]*)?$/.test(v) ||
      /^#[^\s]*$/.test(v) ||
      /^tel:\+?[0-9 ()-]+$/.test(v) ||
      /^mailto:[^\s@]+@[^\s@]+$/.test(v) ||
      /^https?:\/\/\S+$/.test(v);
    return ok ? null : "That does not look like a link. Use something like shop.html?cat=living, #, tel:… or https://…";
  }

  function checkImage(v) {
    if (!v) return null;
    return RE.image.test(v) ? null : "That photo is not in one of the site's image folders.";
  }

  /* field spec: {key, label, type, required, max, min, pattern, patternMessage,
                  kind, help, placeholder, options, folder, rows, width} */
  function validateValue(field, value, all) {
    var v = value;

    if (field.type === "tags" || field.type === "repeat") {
      if (field.required && (!v || !v.length)) return field.requiredMessage || ("Add at least one " + (field.itemNoun || "entry") + ".");
      return null;
    }

    if (typeof v === "string") {
      v = v.trim();
      if (field.required && !v) return field.requiredMessage || ("Fill in " + field.label.toLowerCase() + ".");
      if (!v) return null;
      var ang = checkAngle(v);
      if (ang) return ang;
      if (field.max && v.length > field.max) return field.label + " is too long (" + v.length + " of " + field.max + " characters).";
      if (field.pattern && !field.pattern.test(v)) return field.patternMessage || ("That is not a valid " + field.label.toLowerCase() + ".");
      if (field.kind === "href") return checkHref(v);
      if (field.kind === "image") return checkImage(v);
      if (field.kind === "email" && !RE.email.test(v)) return "That does not look like an email address.";
      if (field.kind === "number") {
        var n = Number(v);
        if (!isFinite(n)) return "Enter a number.";
        if (field.min != null && n < field.min) return field.label + " must be at least " + field.min + ".";
        if (field.maxValue != null && n > field.maxValue) return field.label + " is too large.";
      }
    }

    if (field.validate) return field.validate(value, all);
    return null;
  }

  /* ======================================================================
     form engine
     ====================================================================== */

  var uid = 0;

  function form(host, spec, values, ctx) {
    ctx = ctx || {};
    var data = FCA.util.clone(values || {});
    var controls = {};        /* key -> {el, get, set, errorEl, widget} */
    var order = [];

    function fieldId(key) { return "adf-" + (++uid) + "-" + key.replace(/[^a-z0-9]/gi, "-"); }

    function build(fields, container) {
      fields.forEach(function (f) {
        if (f.type === "group") {
          var g = document.createElement("div");
          g.className = f.className || "ad-grid-2";
          container.appendChild(g);
          build(f.fields, g);
          return;
        }
        if (f.type === "fieldset") {
          var fs = document.createElement("fieldset");
          fs.className = "ad-fieldset";
          fs.innerHTML = '<legend class="ad-fieldset-legend">' + esc(f.legend) + "</legend>";
          container.appendChild(fs);
          build(f.fields, fs);
          return;
        }
        if (f.type === "note") {
          var note = document.createElement("div");
          note.className = f.className || "fc-notice";
          note.innerHTML = f.html || esc(f.text);
          container.appendChild(note);
          return;
        }

        var id = fieldId(f.key);
        var errId = id + "-err";
        var wrapEl = document.createElement("div");
        wrapEl.className = "fc-field";
        if (f.width === "full") wrapEl.style.gridColumn = "1 / -1";

        var labelHTML = '<label class="fc-label" for="' + id + '">' + esc(f.label) +
          (f.required ? ' <span class="ad-req" title="required">*</span>' : "") + "</label>";

        var value = data[f.key];
        var widget = null;
        var inner = "";

        switch (f.type) {
          case "textarea":
            inner = '<textarea class="fc-textarea" id="' + id + '" rows="' + (f.rows || 3) + '"' +
              (f.placeholder ? ' placeholder="' + esc(f.placeholder) + '"' : "") +
              ' aria-describedby="' + errId + '">' + esc(value == null ? "" : value) + "</textarea>";
            break;
          case "select":
            inner = '<select class="fc-select" id="' + id + '" aria-describedby="' + errId + '"></select>';
            break;
          case "checkbox":
            inner = '<label class="fc-checkbox"><input type="checkbox" id="' + id + '"' +
              (value ? " checked" : "") + "> " + esc(f.checkboxLabel || f.label) + "</label>";
            break;
          case "radio":
            inner = '<div role="radiogroup" aria-label="' + esc(f.label) + '" id="' + id + '" class="ad-srcpick"></div>';
            break;
          case "image":
            inner = '<div data-ad-image></div>';
            break;
          case "tags":
            inner = '<div data-ad-tags></div>';
            break;
          case "repeat":
            inner = '<div data-ad-repeat></div>';
            break;
          default:
            inner = '<input class="fc-input" id="' + id + '" type="' + (f.inputType || "text") + '"' +
              (f.inputmode ? ' inputmode="' + f.inputmode + '"' : "") +
              (f.placeholder ? ' placeholder="' + esc(f.placeholder) + '"' : "") +
              (f.datalist ? ' list="' + id + '-dl"' : "") +
              (f.readOnly ? " readonly" : "") +
              ' value="' + esc(value == null ? "" : value) + '" aria-describedby="' + errId + '">';
        }

        wrapEl.innerHTML =
          (f.type === "checkbox" ? "" : labelHTML) +
          inner +
          (f.help ? '<p class="ad-help">' + (f.helpHTML || esc(f.help)) + "</p>" : "") +
          '<span class="ad-fielderr" id="' + errId + '" hidden></span>';

        container.appendChild(wrapEl);

        var errorEl = wrapEl.querySelector(".ad-fielderr");
        /* attribute selector rather than "#id": the id is generated from a
           field key and CSS.escape is not worth depending on here */
        var el = wrapEl.querySelector('[id="' + id + '"]');
        var getter, setter;

        if (f.type === "select") {
          var opts = typeof f.options === "function" ? f.options(data, ctx) : (f.options || []);
          el.innerHTML = opts.map(function (o) {
            var ov = typeof o === "string" ? o : o.value;
            var ol = typeof o === "string" ? o : o.label;
            return '<option value="' + esc(ov) + '"' + (String(ov) === String(value == null ? "" : value) ? " selected" : "") + ">" + esc(ol) + "</option>";
          }).join("");
          getter = function () { return el.value; };
          setter = function (v) { el.value = v == null ? "" : v; };
        } else if (f.type === "checkbox") {
          getter = function () { return el.checked; };
          setter = function (v) { el.checked = !!v; };
        } else if (f.type === "radio") {
          var name = id + "-r";
          el.innerHTML = (f.options || []).map(function (o) {
            return '<label class="fc-checkbox"><input type="radio" name="' + name + '" value="' + esc(o.value) + '"' +
              (String(o.value) === String(value) ? " checked" : "") + "> " + esc(o.label) + "</label>";
          }).join("");
          getter = function () {
            var c = el.querySelector("input:checked");
            return c ? c.value : "";
          };
          setter = function (v) {
            var c = el.querySelector('input[value="' + String(v).replace(/"/g, '\\"') + '"]');
            if (c) c.checked = true;
          };
        } else if (f.type === "image") {
          widget = FCA.images.mount(wrapEl.querySelector("[data-ad-image]"), {
            folder: typeof f.folder === "function" ? f.folder(data, ctx) : f.folder,
            multi: false,
            value: value,
            onChange: function (v) {
              data[f.key] = v;
              clearError(f.key);
              onChange(f.key, v);
            }
          });
          getter = function () { return widget.value; };
          setter = function (v) { widget.value = v; };
        } else if (f.type === "tags") {
          widget = tagInput(wrapEl.querySelector("[data-ad-tags]"), {
            value: Array.isArray(value) ? value : [],
            placeholder: f.placeholder || "Type and press Enter",
            label: f.label,
            onChange: function (v) { data[f.key] = v; clearError(f.key); onChange(f.key, v); }
          });
          getter = function () { return widget.value; };
          setter = function (v) { widget.value = v; };
        } else if (f.type === "repeat") {
          widget = repeatInput(wrapEl.querySelector("[data-ad-repeat]"), {
            value: Array.isArray(value) ? value : [],
            fields: f.fields,
            itemNoun: f.itemNoun || "row",
            max: f.maxRows,
            onChange: function (v) { data[f.key] = v; clearError(f.key); onChange(f.key, v); }
          });
          getter = function () { return widget.value; };
          setter = function (v) { widget.value = v; };
        } else {
          if (f.datalist) {
            var dl = document.createElement("datalist");
            dl.id = id + "-dl";
            var dlv = typeof f.datalist === "function" ? f.datalist(data, ctx) : f.datalist;
            dl.innerHTML = (dlv || []).map(function (o) { return '<option value="' + esc(o) + '">'; }).join("");
            wrapEl.appendChild(dl);
          }
          getter = function () { return el.value; };
          setter = function (v) { el.value = v == null ? "" : v; };
        }

        controls[f.key] = { field: f, el: el, errorEl: errorEl, get: getter, set: setter, widget: widget, wrap: wrapEl };
        order.push(f.key);

        /* Validate on blur and on submit — never on keyup. A required field
           shouting while she is typing the first letter is the most common
           nuisance in hand-rolled admins. */
        if (el && el.addEventListener && f.type !== "image" && f.type !== "tags" && f.type !== "repeat") {
          el.addEventListener("blur", function () {
            data[f.key] = getter();
            var msg = validateValue(f, data[f.key], data);
            if (msg) showError(f.key, msg); else clearError(f.key);
          });
          el.addEventListener("input", function () {
            data[f.key] = getter();
            onChange(f.key, data[f.key]);
          });
          el.addEventListener("change", function () {
            data[f.key] = getter();
            onChange(f.key, data[f.key]);
          });
        }
      });
    }

    function onChange(key, value) {
      if (ctx.onChange) ctx.onChange(key, value, data);
    }

    function showError(key, message) {
      var c = controls[key];
      if (!c) return;
      c.errorEl.hidden = false;
      c.errorEl.innerHTML = '<span aria-hidden="true">!</span> ' + esc(message);
      if (c.el && c.el.setAttribute) c.el.setAttribute("aria-invalid", "true");
    }

    function clearError(key) {
      var c = controls[key];
      if (!c) return;
      c.errorEl.hidden = true;
      c.errorEl.textContent = "";
      if (c.el && c.el.removeAttribute) c.el.removeAttribute("aria-invalid");
    }

    function clearErrors() { Object.keys(controls).forEach(clearError); }

    function readAll() {
      Object.keys(controls).forEach(function (k) { data[k] = controls[k].get(); });
      return data;
    }

    function validate() {
      readAll();
      clearErrors();
      var errors = [];
      order.forEach(function (k) {
        var c = controls[k];
        var msg = validateValue(c.field, data[k], data);
        if (msg) { showError(k, msg); errors.push({ key: k, label: c.field.label, message: msg }); }
      });
      if (ctx.validateAll) {
        (ctx.validateAll(data) || []).forEach(function (e) {
          showError(e.key, e.message);
          errors.push({ key: e.key, label: (controls[e.key] && controls[e.key].field.label) || e.key, message: e.message });
        });
      }
      return errors;
    }

    /* The server answers 400 with JSON pointers ("item/priceMin",
       "items/3/href"); the last segment is the field key on this form. */
    function paintServerErrors(fields) {
      var painted = [];
      Object.keys(fields || {}).forEach(function (pointer) {
        var key = pointer.split("/").pop();
        if (controls[key]) {
          showError(key, fields[pointer]);
          painted.push({ key: key, label: controls[key].field.label, message: fields[pointer] });
        }
      });
      return painted;
    }

    function focusFirstError() {
      for (var i = 0; i < order.length; i++) {
        var c = controls[order[i]];
        if (!c.errorEl.hidden) {
          var target = c.el && c.el.focus ? c.el : c.wrap;
          try {
            target.focus({ preventScroll: true });
          } catch (e) { /* not focusable */ }
          var y = c.wrap.getBoundingClientRect().top + window.scrollY - 80;  /* sticky topbar */
          window.scrollTo({ top: Math.max(0, y), behavior: "smooth" });
          return;
        }
      }
    }

    build(spec, host);

    return {
      data: data,
      values: readAll,
      control: function (k) { return controls[k]; },
      validate: validate,
      showError: showError,
      clearError: clearError,
      clearErrors: clearErrors,
      paintServerErrors: paintServerErrors,
      focusFirstError: focusFirstError,
      busyWidgets: function () {
        return Object.keys(controls).some(function (k) {
          return controls[k].widget && controls[k].widget.isBusy && controls[k].widget.isBusy();
        });
      }
    };
  }

  /* ======================================================================
     tag input (a list of short strings)
     ====================================================================== */

  function tagInput(host, opts) {
    var values = (opts.value || []).slice();
    var locked = !!opts.locked;

    function render() {
      host.innerHTML =
        '<div class="ad-tagin' + (locked ? " is-locked" : "") + '">' +
          values.map(function (v, i) {
            return '<span class="ad-tag">' + esc(v) +
              (locked ? "" :
                '<button type="button" data-ad-x="' + i + '" aria-label="Remove ' + esc(v) + '">✕</button>') +
              "</span>";
          }).join("") +
          (locked ? "" :
            '<input type="text" data-ad-new placeholder="' + esc(opts.placeholder || "Type and press Enter") +
            '" aria-label="Add a value to ' + esc(opts.label || "the list") + '">') +
        "</div>" +
        (locked ? "" :
          '<div class="ad-tagin-move" style="display:flex;gap:2px;margin-top:6px">' +
            values.map(function (v, i) {
              return '<span style="display:inline-flex;align-items:center">' +
                '<button type="button" class="ad-iconbtn" data-ad-up="' + i + '"' + (i === 0 ? " disabled" : "") +
                ' title="Move ' + esc(v) + ' earlier" aria-label="Move ' + esc(v) + ' earlier">' + FCA.util.icon("up") + "</button>" +
                '<button type="button" class="ad-iconbtn" data-ad-down="' + i + '"' + (i === values.length - 1 ? " disabled" : "") +
                ' title="Move ' + esc(v) + ' later" aria-label="Move ' + esc(v) + ' later">' + FCA.util.icon("down") + "</button>" +
              "</span>";
            }).join("") +
          "</div>");
    }

    function commit(raw) {
      String(raw).split(",").forEach(function (part) {
        var v = part.trim();
        if (!v) return;
        if (values.indexOf(v) >= 0) return;
        values.push(v);
      });
      render();
      opts.onChange(values.slice());
      var input = host.querySelector("[data-ad-new]");
      if (input) input.focus();
    }

    host.addEventListener("keydown", function (e) {
      var input = e.target.closest("[data-ad-new]");
      if (!input) return;
      if (e.key === "Enter" || e.key === ",") {
        e.preventDefault();
        commit(input.value);
        input.value = "";
      } else if (e.key === "Backspace" && !input.value && values.length) {
        e.preventDefault();
        values.pop();
        render();
        opts.onChange(values.slice());
        var next = host.querySelector("[data-ad-new]");
        if (next) next.focus();
      }
    });

    /* A value typed and then abandoned would be silently lost on save, so
       commit it when the field loses focus too. */
    host.addEventListener("focusout", function (e) {
      var input = e.target.closest ? e.target.closest("[data-ad-new]") : null;
      if (input && input.value.trim()) {
        var v = input.value;
        input.value = "";
        commit(v);
      }
    });

    host.addEventListener("click", function (e) {
      var b = e.target.closest("button");
      if (!b) return;
      var n;
      if ((n = b.getAttribute("data-ad-x")) != null) {
        values.splice(Number(n), 1);
      } else if ((n = b.getAttribute("data-ad-up")) != null) {
        var i = Number(n); if (i <= 0) return;
        values.splice(i - 1, 0, values.splice(i, 1)[0]);
      } else if ((n = b.getAttribute("data-ad-down")) != null) {
        var j = Number(n); if (j >= values.length - 1) return;
        values.splice(j + 1, 0, values.splice(j, 1)[0]);
      } else return;
      render();
      opts.onChange(values.slice());
    });

    render();

    return {
      get value() { return values.slice(); },
      set value(v) { values = (v || []).slice(); render(); },
      setLocked: function (v) { locked = v; render(); }
    };
  }

  /* ======================================================================
     repeat input (a list of small objects: footer links, socials)
     ====================================================================== */

  function repeatInput(host, opts) {
    var rows = FCA.util.clone(opts.value || []);

    function render() {
      host.innerHTML = rows.map(function (row, i) {
        return '<div class="ad-repeat-row" data-ad-row="' + i + '">' +
          '<div class="ad-repeat-head"><b>' + esc(opts.itemNoun) + " " + (i + 1) + "</b>" +
            '<div class="ad-rowactions">' +
              '<button type="button" class="ad-iconbtn" data-ad-up="' + i + '"' + (i === 0 ? " disabled" : "") +
                ' title="Move up" aria-label="Move ' + esc(opts.itemNoun) + " " + (i + 1) + ' up">' + FCA.util.icon("up") + "</button>" +
              '<button type="button" class="ad-iconbtn" data-ad-down="' + i + '"' + (i === rows.length - 1 ? " disabled" : "") +
                ' title="Move down" aria-label="Move ' + esc(opts.itemNoun) + " " + (i + 1) + ' down">' + FCA.util.icon("down") + "</button>" +
              '<button type="button" class="ad-iconbtn ad-iconbtn-danger" data-ad-del="' + i + '"' +
                ' title="Remove" aria-label="Remove ' + esc(opts.itemNoun) + " " + (i + 1) + '">' + FCA.util.icon("trash") + "</button>" +
            "</div></div>" +
          '<div class="ad-grid-2">' +
            opts.fields.map(function (f) {
              var v = row[f.key];
              if (f.type === "select") {
                var os = typeof f.options === "function" ? f.options() : (f.options || []);
                return '<div class="fc-field"><label class="fc-label">' + esc(f.label) + "</label>" +
                  '<select class="fc-select" data-ad-k="' + esc(f.key) + '">' +
                  os.map(function (o) {
                    var ov = typeof o === "string" ? o : o.value;
                    var ol = typeof o === "string" ? o : o.label;
                    return '<option value="' + esc(ov) + '"' + (String(ov) === String(v == null ? "" : v) ? " selected" : "") + ">" + esc(ol) + "</option>";
                  }).join("") + "</select></div>";
              }
              return '<div class="fc-field"><label class="fc-label">' + esc(f.label) + "</label>" +
                '<input class="fc-input" data-ad-k="' + esc(f.key) + '" value="' + esc(v == null ? "" : v) + '"' +
                (f.placeholder ? ' placeholder="' + esc(f.placeholder) + '"' : "") + "></div>";
            }).join("") +
          "</div></div>";
      }).join("") +
      (opts.max && rows.length >= opts.max ? "" :
        '<button class="fc-btn fc-btn-sm fc-btn-outline" type="button" data-ad-add>＋ Add ' + esc(opts.itemNoun) + "</button>");
    }

    host.addEventListener("click", function (e) {
      var b = e.target.closest("button");
      if (!b) return;
      var n;
      if (b.hasAttribute("data-ad-add")) {
        var blank = {};
        opts.fields.forEach(function (f) { blank[f.key] = ""; });
        rows.push(blank);
      } else if ((n = b.getAttribute("data-ad-del")) != null) {
        rows.splice(Number(n), 1);
      } else if ((n = b.getAttribute("data-ad-up")) != null) {
        var i = Number(n); if (i <= 0) return;
        rows.splice(i - 1, 0, rows.splice(i, 1)[0]);
      } else if ((n = b.getAttribute("data-ad-down")) != null) {
        var j = Number(n); if (j >= rows.length - 1) return;
        rows.splice(j + 1, 0, rows.splice(j, 1)[0]);
      } else return;
      render();
      opts.onChange(FCA.util.clone(rows));
    });

    host.addEventListener("input", function (e) {
      var input = e.target.closest("[data-ad-k]");
      if (!input) return;
      var rowEl = input.closest("[data-ad-row]");
      var i = Number(rowEl.getAttribute("data-ad-row"));
      rows[i][input.getAttribute("data-ad-k")] = input.value;
      opts.onChange(FCA.util.clone(rows));
    });
    host.addEventListener("change", function (e) {
      var sel = e.target.closest("select[data-ad-k]");
      if (!sel) return;
      var rowEl = sel.closest("[data-ad-row]");
      rows[Number(rowEl.getAttribute("data-ad-row"))][sel.getAttribute("data-ad-k")] = sel.value;
      opts.onChange(FCA.util.clone(rows));
    });

    render();

    return {
      get value() { return FCA.util.clone(rows); },
      set value(v) { rows = FCA.util.clone(v || []); render(); }
    };
  }

  /* ======================================================================
     save bar — shared by every editor screen
     ====================================================================== */

  /* Below 640px Delete leaves this bar and moves into a "Danger zone" block
     at the bottom of the form, so a thumb reaching for Save at the screen
     edge cannot hit Delete. Both are rendered; CSS shows one. */
  function saveBar(opts) {
    var bar = document.createElement("div");
    bar.className = "ad-savebar";
    bar.innerHTML =
      '<button class="fc-btn fc-btn-sm fc-btn-outline" type="button" data-ad-back>← ' + esc(opts.backLabel || "Back to list") + "</button>" +
      (opts.onDelete ? '<button class="fc-btn fc-btn-sm fc-btn-outline fc-btn-danger ad-savebar-delete" type="button" data-ad-delete>Delete</button>' : "") +
      '<span class="ad-savebar-status" data-ad-savestatus></span>' +
      '<button class="fc-btn ad-savebar-save" type="button" data-ad-save>Save changes</button>';

    bar.querySelector("[data-ad-back]").addEventListener("click", opts.onBack);
    bar.querySelector("[data-ad-save]").addEventListener("click", opts.onSave);
    if (opts.onDelete) bar.querySelector("[data-ad-delete]").addEventListener("click", opts.onDelete);
    return bar;
  }

  function dangerZone(label, onDelete) {
    var fs = document.createElement("fieldset");
    fs.className = "ad-fieldset ad-danger-zone";
    fs.innerHTML = '<legend class="ad-fieldset-legend">Danger zone</legend>';
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "fc-btn fc-btn-block fc-btn-outline fc-btn-danger";
    btn.textContent = label;
    btn.addEventListener("click", onDelete);
    fs.appendChild(btn);
    return fs;
  }

  function setSaveBarStatus(bar, kind, text) {
    var el = bar.querySelector("[data-ad-savestatus]");
    if (!el) return;
    el.className = "ad-savebar-status" + (kind === "failed" ? " is-failed" : kind === "clean" ? " is-clean" : "");
    var glyph = kind === "dirty" ? '<i class="ad-dot" aria-hidden="true"></i> '
      : kind === "saving" ? '<i class="ad-spinner ad-spinner-dark" aria-hidden="true"></i> '
      : kind === "failed" ? '<i class="ad-glyph ad-glyph-bad" aria-hidden="true">!</i> ' : "";
    el.innerHTML = glyph + esc(text);
  }

  function setSaving(bar, busy) {
    var btn = bar.querySelector("[data-ad-save]");
    btn.disabled = busy;
    if (busy) {
      btn.setAttribute("aria-busy", "true");
      btn.innerHTML = '<i class="ad-spinner ad-spinner-dark" aria-hidden="true"></i>Saving…';
    } else {
      btn.removeAttribute("aria-busy");
      btn.textContent = "Save changes";
    }
  }

  /* ======================================================================
     the generic list + editor screen
     ====================================================================== */

  function create(schema) {
    var section = schema.section;
    var seg = schema.segment;

    function items() { return FCA.state.doc[section] || (FCA.state.doc[section] = []); }
    function dirty() { return FCA.app.isDirty(section); }
    function touch() { FCA.app.recomputeDirty(section); }

    FCA.app.register(section, {
      render: function (host, route) {
        if (route.parts[0] === "new") return renderEditor(host, -1);
        if (route.parts[0] === "edit") return renderEditor(host, Number(route.parts[1]));
        return renderList(host);
      }
    });

    /* ---------------- list ---------------- */
    function renderList(host) {
      var list = items();
      var page = document.createElement("div");
      page.className = "ad-page";

      page.innerHTML =
        '<div class="ad-page-head"><div>' +
          '<h1 class="ad-page-title">' + esc(schema.title) + "</h1>" +
          '<p class="ad-page-sub">' + esc(schema.sub) + "</p>" +
        "</div>" +
        (schema.max && list.length >= schema.max ? "" :
          '<a class="fc-btn" href="#/' + seg + '/new">＋ Add ' + esc(schema.singular) + "</a>") +
        "</div>" +
        '<div class="ad-card">' +
          '<div class="ad-toolbar">' +
            '<div class="ad-search">' + FCA.util.icon("search") +
              '<input class="fc-input" type="search" data-ad-q placeholder="Search ' + esc(schema.title.toLowerCase()) +
              '" aria-label="Search ' + esc(schema.title.toLowerCase()) + '">' +
            "</div>" +
            '<span class="ad-toolbar-count" data-ad-count>' + FCA.util.plural(list.length, schema.singular, schema.plural || (schema.singular + "s")) + "</span>" +
          "</div>" +
          '<div data-ad-body></div>' +
        "</div>";

      host.innerHTML = "";
      host.appendChild(page);

      var body = page.querySelector("[data-ad-body]");
      var q = "";

      function draw() {
        var all = items();
        var filtered = all.map(function (it, i) { return { it: it, i: i }; }).filter(function (r) {
          if (!q) return true;
          return String(schema.searchText ? schema.searchText(r.it) : (schema.labelOf(r.it) || ""))
            .toLowerCase().indexOf(q) >= 0;
        });

        page.querySelector("[data-ad-count]").textContent =
          FCA.util.plural(all.length, schema.singular, schema.plural || (schema.singular + "s"));

        if (!all.length) {
          body.innerHTML =
            '<div class="ad-empty">' + FCA.util.icon("box") +
              "<h2>No " + esc(schema.plural || schema.singular + "s") + " yet</h2>" +
              "<p>" + esc(schema.emptyHelp || "") + "</p>" +
              '<a class="fc-btn" href="#/' + seg + '/new">＋ Add ' + esc(schema.singular) + "</a>" +
            "</div>";
          return;
        }
        /* a no-results state is NOT the empty state, or she will think she
           deleted everything */
        if (!filtered.length) {
          body.innerHTML =
            '<div class="ad-empty">' + FCA.util.icon("search") +
              "<h2>Nothing matches “" + esc(q) + "”</h2>" +
              '<button class="fc-btn fc-btn-outline" type="button" data-ad-clearq>Clear search</button>' +
            "</div>";
          return;
        }

        if (schema.layout === "tiles") body.innerHTML = tilesHTML(filtered);
        else body.innerHTML = tableHTML(filtered) + cardsHTML(filtered);
      }

      function actionsHTML(i, label, isFirst, isLast) {
        return '<div class="ad-rowactions">' +
          (schema.ordered
            ? '<button type="button" class="ad-iconbtn" data-ad-up="' + i + '"' + (isFirst ? " disabled" : "") +
              ' title="' + (isFirst ? "Already first" : "Move up") + '" aria-label="Move ' + esc(label) + ' up"' +
              (isFirst ? ' aria-disabled="true"' : "") + ">" + FCA.util.icon("up") + "</button>" +
              '<button type="button" class="ad-iconbtn" data-ad-down="' + i + '"' + (isLast ? " disabled" : "") +
              ' title="' + (isLast ? "Already last" : "Move down") + '" aria-label="Move ' + esc(label) + ' down"' +
              (isLast ? ' aria-disabled="true"' : "") + ">" + FCA.util.icon("down") + "</button>"
            : "") +
          '<a class="ad-iconbtn" href="#/' + seg + "/edit/" + i + '" title="Edit" aria-label="Edit ' + esc(label) + '">' +
            FCA.util.icon("edit") + "</a>" +
          '<button type="button" class="ad-iconbtn ad-iconbtn-danger" data-ad-del="' + i + '" title="Delete" ' +
            'aria-label="Delete ' + esc(label) + '">' + FCA.util.icon("trash") + "</button>" +
        "</div>";
      }

      function tableHTML(rows) {
        var total = items().length;
        return '<div class="ad-table-wrap"><table class="ad-table"><thead><tr>' +
          schema.columns.map(function (c) {
            return "<th" + (c.width ? ' style="width:' + c.width + '"' : "") + ">" + esc(c.label) + "</th>";
          }).join("") +
          '<th class="ad-right" style="width:140px">Actions</th></tr></thead><tbody>' +
          rows.map(function (r) {
            return "<tr>" + schema.columns.map(function (c) { return "<td>" + c.render(r.it, r.i) + "</td>"; }).join("") +
              '<td class="ad-right">' + actionsHTML(r.i, schema.labelOf(r.it), r.i === 0, r.i === total - 1) + "</td></tr>";
          }).join("") +
          "</tbody></table></div>";
      }

      function cardsHTML(rows) {
        var total = items().length;
        return '<div class="ad-list-cards">' + rows.map(function (r) {
          return '<div class="ad-list-card"><div class="ad-list-card-top">' +
            (schema.cardThumb ? schema.cardThumb(r.it) : "") +
            "<div>" + (schema.cardBody ? schema.cardBody(r.it, r.i) :
              '<div class="ad-cell-main">' + esc(schema.labelOf(r.it)) + "</div>") + "</div>" +
            "</div>" +
            '<div class="ad-list-card-actions">' +
              '<a class="fc-btn fc-btn-sm fc-btn-outline" href="#/' + seg + "/edit/" + r.i + '">Edit</a>' +
              (schema.ordered
                ? '<button type="button" class="ad-iconbtn" data-ad-up="' + r.i + '"' + (r.i === 0 ? " disabled" : "") +
                  ' aria-label="Move ' + esc(schema.labelOf(r.it)) + ' up">' + FCA.util.icon("up") + "</button>" +
                  '<button type="button" class="ad-iconbtn" data-ad-down="' + r.i + '"' + (r.i === total - 1 ? " disabled" : "") +
                  ' aria-label="Move ' + esc(schema.labelOf(r.it)) + ' down">' + FCA.util.icon("down") + "</button>"
                : "") +
              '<button type="button" class="ad-iconbtn ad-iconbtn-danger" data-ad-del="' + r.i + '" ' +
                'aria-label="Delete ' + esc(schema.labelOf(r.it)) + '">' + FCA.util.icon("trash") + "</button>" +
            "</div></div>";
        }).join("") + "</div>";
      }

      function tilesHTML(rows) {
        var total = items().length;
        return '<div class="ad-tiles">' + rows.map(function (r) {
          return '<div class="ad-tile">' +
            (schema.tileShot ? schema.tileShot(r.it) : "") +
            '<span class="ad-tile-name">' + esc(schema.labelOf(r.it)) + "</span>" +
            '<div class="ad-tile-actions">' + actionsHTML(r.i, schema.labelOf(r.it), r.i === 0, r.i === total - 1) + "</div>" +
          "</div>";
        }).join("") + "</div>";
      }

      page.querySelector("[data-ad-q]").addEventListener("input", FCA.util.debounce(function (e) {
        q = e.target.value.trim().toLowerCase();
        draw();
      }, 120));

      body.addEventListener("click", function (e) {
        var b = e.target.closest("button");
        if (!b) return;
        var n;
        if (b.hasAttribute("data-ad-clearq")) {
          q = "";
          page.querySelector("[data-ad-q]").value = "";
          draw();
          return;
        }
        if ((n = b.getAttribute("data-ad-up")) != null) { move(Number(n), -1); return; }
        if ((n = b.getAttribute("data-ad-down")) != null) { move(Number(n), 1); return; }
        if ((n = b.getAttribute("data-ad-del")) != null) { del(Number(n)); return; }
      });

      function move(i, d) {
        var list = items();
        var j = i + d;
        if (j < 0 || j >= list.length) return;
        list.splice(j, 0, list.splice(i, 1)[0]);
        touch();
        draw();
        syncBar();
      }

      function del(i) {
        var list = items();
        var item = list[i];
        FCA.ui.confirmDelete({
          title: "Delete this " + schema.singular + "?",
          recordHTML: (schema.confirmRecord ? schema.confirmRecord(item) : '<div class="ad-cell-main">' + esc(schema.labelOf(item)) + "</div>"),
          consequence: schema.consequence ? schema.consequence(item) : "It will disappear from the website the next time you save."
        }).then(function (yes) {
          if (!yes) return;
          var removed = list.splice(i, 1)[0];
          touch();
          draw();
          syncBar();
          /* Nothing is irreversible until Save — so the undo is real. */
          FCA.ui.toast(schema.singular.charAt(0).toUpperCase() + schema.singular.slice(1) + " deleted.", {
            actionLabel: "Undo",
            onAction: function () {
              list.splice(Math.min(i, list.length), 0, removed);
              touch();
              draw();
              syncBar();
            }
          });
        });
      }

      /* the list itself is savable: reorder and delete live in the working
         copy until she presses Save */
      var bar = saveBar({
        backLabel: "Dashboard",
        onBack: function () { FCA.app.navigate("#/"); },
        onSave: doSave
      });
      page.appendChild(bar);

      function syncBar() {
        if (dirty()) setSaveBarStatus(bar, "dirty", "Unsaved changes");
        else setSaveBarStatus(bar, "clean", "All changes saved");
      }

      function doSave() {
        setSaving(bar, true);
        setSaveBarStatus(bar, "saving", "Saving…");
        FCA.app.saveCollection(section, {
          successMessage: schema.title + " saved.",
          serialise: schema.serialise,
          onFieldErrors: function (fields, message) {
            FCA.ui.banner({
              tag: "validation", kind: "error",
              title: "The server rejected this.",
              bodyHTML: " " + esc(message) + '<ul class="ad-confirm-list">' +
                Object.keys(fields).map(function (k) { return "<li><code>" + esc(k) + "</code> — " + esc(fields[k]) + "</li>"; }).join("") +
                "</ul>"
            });
          }
        }).then(function (ok) {
          setSaving(bar, false);
          setSaveBarStatus(bar, ok ? "clean" : "failed", ok ? "All changes saved" : "Could not save");
          if (ok) draw();
        });
      }

      draw();
      syncBar();
    }

    /* ---------------- editor ---------------- */
    function renderEditor(host, index) {
      var list = items();
      var isNew = index < 0;
      if (!isNew && !list[index]) {
        host.innerHTML = '<div class="ad-page"><div class="ad-empty">' + FCA.util.icon("box") +
          "<h2>That " + esc(schema.singular) + " is not here any more</h2>" +
          '<a class="fc-btn" href="#/' + seg + '">Back to the list</a></div></div>';
        return;
      }

      var original = isNew ? (schema.newItem ? schema.newItem() : {}) : FCA.util.clone(list[index]);

      var page = document.createElement("div");
      page.className = "ad-page";
      page.innerHTML =
        '<div class="ad-page-head"><div>' +
          '<h1 class="ad-page-title">' + esc(isNew ? "New " + schema.singular : schema.labelOf(original) || schema.singular) + "</h1>" +
          '<p class="ad-page-sub">' + esc(schema.title) + " › " + (isNew ? "New" : "Edit") + "</p>" +
        "</div></div>" +
        '<div class="ad-editor"><div class="ad-editor-main"><div data-ad-form></div></div>' +
        (schema.side ? '<aside class="ad-editor-side" data-ad-side></aside>' : "") +
        "</div>";

      host.innerHTML = "";
      host.appendChild(page);

      var f = form(page.querySelector("[data-ad-form]"), schema.fields, original, {
        onChange: function () {
          setSaveBarStatus(bar, "dirty", "Unsaved changes");
          if (schema.side) drawSide();
        },
        validateAll: schema.validateAll
      });

      function drawSide() {
        var side = page.querySelector("[data-ad-side]");
        if (side) side.innerHTML = schema.side(f.values());
      }
      if (schema.side) drawSide();

      var bar = saveBar({
        onBack: function () { FCA.app.navigate("#/" + seg); },
        onSave: doSave,
        onDelete: isNew ? null : doDelete
      });
      page.appendChild(bar);

      if (!isNew) {
        page.querySelector(".ad-editor-main").appendChild(
          dangerZone("Delete this " + schema.singular, doDelete)
        );
      }
      setSaveBarStatus(bar, isNew ? "dirty" : "clean", isNew ? "Not saved yet" : "All changes saved");

      function doDelete() {
        var item = list[index];
        FCA.ui.confirmDelete({
          title: "Delete this " + schema.singular + "?",
          recordHTML: (schema.confirmRecord ? schema.confirmRecord(item) : '<div class="ad-cell-main">' + esc(schema.labelOf(item)) + "</div>"),
          consequence: schema.consequence ? schema.consequence(item) : "It will disappear from the website the next time you save."
        }).then(function (yes) {
          if (!yes) return;
          list.splice(index, 1);
          FCA.app.recomputeDirty(section);
          FCA.app.navigate("#/" + seg);
          FCA.ui.toast(schema.singular + " deleted. Press Save on the list to make it permanent.");
        });
      }

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
        if (f.busyWidgets()) {
          FCA.ui.toast("A photo is still uploading. Wait for it to finish.");
          return;
        }

        var value = schema.fromForm ? schema.fromForm(f.values(), original) : f.values();

        /* commit into the working copy, then PUT the whole collection */
        if (isNew) list.push(value); else list[index] = value;
        FCA.app.recomputeDirty(section);

        setSaving(bar, true);
        setSaveBarStatus(bar, "saving", "Saving…");

        FCA.app.saveCollection(section, {
          successMessage: (schema.singular.charAt(0).toUpperCase() + schema.singular.slice(1)) + " saved.",
          serialise: schema.serialise,
          onFieldErrors: function (fields, message) {
            var painted = f.paintServerErrors(fields);
            FCA.ui.banner({
              tag: "validation", kind: "error",
              title: "The server rejected this.",
              bodyHTML: " " + esc(message) +
                (painted.length ? " — " + painted.map(function (p) { return esc(p.label); }).join(" · ") : "") +
                '<ul class="ad-confirm-list">' +
                  Object.keys(fields).map(function (k) { return "<li><code>" + esc(k) + "</code> — " + esc(fields[k]) + "</li>"; }).join("") +
                "</ul>"
            });
            f.focusFirstError();
          }
        }).then(function (ok) {
          setSaving(bar, false);
          if (ok) {
            setSaveBarStatus(bar, "clean", "All changes saved");
            /* a new record becomes an edit, so a second Save updates rather
               than duplicates */
            if (isNew) FCA.app.navigate("#/" + seg + "/edit/" + (list.length - 1));
          } else {
            setSaveBarStatus(bar, "failed", "Could not save");
          }
        });
      }
    }
  }

  FCA.fields = {
    form: form,
    tagInput: tagInput,
    repeatInput: repeatInput,
    saveBar: saveBar,
    dangerZone: dangerZone,
    setSaveBarStatus: setSaveBarStatus,
    setSaving: setSaving,
    validateValue: validateValue,
    checkHref: checkHref,
    checkImage: checkImage,
    checkAngle: checkAngle,
    RE: RE
  };
  FCA.listEditor = { create: create };

  /* ======================================================================
     the six schema-driven collections
     ====================================================================== */

  function thumb(path, alt) {
    if (!path) return '<div class="ad-thumb is-missing" title="No photo" aria-hidden="true">!</div>';
    return '<div class="ad-thumb"><img src="' + esc(api.assetURL(path)) + '" alt="' + esc(alt || "") + '" loading="lazy"></div>';
  }

  function categorySlugOptions() {
    return (FCA.state.doc.categories || []).map(function (c) { return { value: c.slug, label: c.label + " (" + c.slug + ")" }; });
  }

  /* ---- Categories ---- */
  create({
    section: "categories", segment: "categories",
    title: "Categories", singular: "category", plural: "categories",
    sub: "The tiles on the home page, and the categories products belong to.",
    emptyHelp: "Categories group the products and appear as tiles on the home page.",
    ordered: true, max: 40,
    labelOf: function (c) { return c.label; },
    searchText: function (c) { return c.label + " " + c.slug; },
    columns: [
      { label: "Image", width: "72px", render: function (c) { return thumb(c.image, c.label); } },
      { label: "Label", render: function (c) { return '<div class="ad-cell-main">' + esc(c.label) + "</div>"; } },
      { label: "Web name", render: function (c) { return '<span class="ad-pill ad-pill-muted">' + esc(c.slug) + "</span>"; } }
    ],
    cardThumb: function (c) { return thumb(c.image, c.label); },
    cardBody: function (c) {
      return '<div class="ad-cell-main">' + esc(c.label) + '</div><div class="ad-cell-sub">' + esc(c.slug) + "</div>";
    },
    confirmRecord: function (c) { return thumb(c.image, c.label) + '<div class="ad-cell-main">' + esc(c.label) + "</div>"; },
    consequence: function (c) {
      var used = (FCA.state.doc.products || []).filter(function (p) { return p.category === c.slug; });
      return used.length
        ? "<strong>" + used.length + " product" + (used.length === 1 ? "" : "s") + " use this category</strong> and will point at a category that no longer exists. The server will ask you to confirm again before saving."
        : "The tile disappears from the home page. No product uses it.";
    },
    newItem: function () { return { label: "", slug: "", image: "" }; },
    fields: [
      { key: "label", label: "Name shown on the site", type: "text", required: true, max: 40, width: "full" },
      { key: "slug", label: "Web name", type: "text", required: true, max: 40, pattern: RE.slug,
        patternMessage: "Use lower-case letters, numbers and hyphens only.",
        help: "Used in the address: shop.html?cat=living. Changing it breaks saved links." },
      { key: "image", label: "Tile photo", type: "image", folder: "category", required: true,
        requiredMessage: "Add a photo for the tile.", width: "full" }
    ],
    fromForm: function (v) { return { label: v.label.trim(), slug: v.slug.trim(), image: v.image }; }
  });

  /* ---- Series ---- */
  create({
    section: "series", segment: "series",
    title: "Series", singular: "series entry", plural: "series entries",
    sub: "The three big promotional blocks on the home page.",
    emptyHelp: "A series is a promotional block that links to a filtered shop page.",
    ordered: true, max: 6,
    labelOf: function (s) { return s.title || s.eyebrow || s.slug; },
    searchText: function (s) { return [s.eyebrow, s.title, s.slug].join(" "); },
    columns: [
      { label: "Image", width: "72px", render: function (s) { return thumb(s.image, s.title); } },
      { label: "Eyebrow", render: function (s) { return '<div class="ad-cell-sub">' + esc(s.eyebrow) + "</div>"; } },
      { label: "Title", render: function (s) { return '<div class="ad-cell-main">' + esc(s.title) + "</div>"; } },
      { label: "Key", width: "110px", render: function (s) { return '<span class="ad-pill ad-pill-muted">' + esc(s.slug || "?") + "</span>"; } }
    ],
    cardThumb: function (s) { return thumb(s.image, s.title); },
    cardBody: function (s) {
      return '<div class="ad-cell-main">' + esc(s.title) + '</div><div class="ad-cell-sub">' + esc(s.eyebrow) + " · " + esc(s.slug || "") + "</div>";
    },
    consequence: function (s) {
      var used = (FCA.state.doc.products || []).filter(function (p) { return p.series === s.slug; });
      return used.length
        ? "<strong>" + used.length + " product" + (used.length === 1 ? "" : "s") + " belong to this series.</strong> The server will ask you to confirm again before saving."
        : "The block disappears from the home page.";
    },
    newItem: function () { return { slug: "", eyebrow: "", title: "", text: "", cta: "", href: "", image: "" }; },
    fields: [
      { key: "title", label: "Headline", type: "text", required: true, max: 80, width: "full" },
      { key: "slug", label: "Series key", type: "text", required: true, max: 40, pattern: RE.slug,
        patternMessage: "Use lower-case letters, numbers and hyphens only.",
        help: "This is what a product's Series is matched against. Keep it the same as the ?series= value in the link." },
      { key: "eyebrow", label: "Small line above the headline", type: "text", max: 40 },
      { key: "text", label: "Description", type: "textarea", max: 200, rows: 3, width: "full" },
      { key: "cta", label: "Button text", type: "text", max: 40 },
      { key: "href", label: "Button link", type: "text", kind: "href", placeholder: "shop.html?series=popular" },
      { key: "image", label: "Photo", type: "image", folder: "category", required: true, width: "full" }
    ],
    fromForm: function (v) {
      return { slug: v.slug.trim(), eyebrow: v.eyebrow.trim(), title: v.title.trim(), text: v.text.trim(),
               cta: v.cta.trim(), href: v.href.trim(), image: v.image };
    },
    validateAll: function (v) {
      /* mirrors the hero rule: a button with no link is a dead button */
      if (v.cta && !v.href) return [{ key: "href", message: "Add the link the button should open." }];
      return [];
    }
  });

  /* ---- Hero slides ---- */
  create({
    section: "hero", segment: "hero",
    title: "Hero slides", singular: "slide", plural: "slides",
    sub: "The rotating banner at the top of the home page.",
    emptyHelp: "Slides rotate at the top of the home page.",
    ordered: true, max: 8,
    labelOf: function (h) { return h.title; },
    searchText: function (h) { return [h.title, h.text, h.cta].join(" "); },
    columns: [
      { label: "Image", width: "72px", render: function (h) { return thumb(h.image, h.title); } },
      { label: "Title", render: function (h) { return '<div class="ad-cell-main">' + esc(h.title) + '</div><div class="ad-cell-sub">' + esc(h.text) + "</div>"; } },
      { label: "Button", width: "180px", render: function (h) {
          if (!h.cta) return '<span class="ad-cell-sub">no button</span>';
          return '<div class="ad-cell-main">' + esc(h.cta) + "</div>" +
            (h.href ? '<div class="ad-cell-sub">' + esc(h.href) + "</div>"
                    : '<span class="ad-pill ad-pill-warn">no link</span>');
        } },
      { label: "Align", width: "90px", render: function (h) { return '<span class="ad-pill ad-pill-muted">' + esc(h.align || "left") + "</span>"; } }
    ],
    cardThumb: function (h) { return thumb(h.image, h.title); },
    cardBody: function (h) {
      return '<div class="ad-cell-main">' + esc(h.title) + '</div><div class="ad-cell-sub">' + esc(h.cta || "no button") + "</div>";
    },
    consequence: function () { return "The slide is removed from the home page banner."; },
    newItem: function () { return { title: "", text: "", cta: "", href: "", image: "", align: "left" }; },
    fields: [
      { key: "title", label: "Headline", type: "text", required: true, max: 60, width: "full" },
      { key: "text", label: "Line underneath", type: "text", max: 120, width: "full" },
      { key: "cta", label: "Button text", type: "text", max: 24 },
      { key: "href", label: "Button link", type: "text", kind: "href", placeholder: "shop.html?cat=living" },
      { key: "align", label: "Where the text sits", type: "radio",
        options: [{ value: "left", label: "Left" }, { value: "center", label: "Centre" }, { value: "right", label: "Right" }] },
      { key: "image", label: "Background photo", type: "image", folder: "hero", required: true, width: "full" }
    ],
    fromForm: function (v) {
      return { title: v.title.trim(), text: v.text.trim(), cta: v.cta.trim(), href: v.href.trim(),
               image: v.image, align: v.align || "left" };
    },
    validateAll: function (v) {
      if (v.cta && !v.href) return [{ key: "href", message: "Add the link the button should open." }];
      return [];
    }
  });

  /* ---- Brands ---- */
  create({
    section: "brands", segment: "brands",
    title: "Brands", singular: "brand", plural: "brands",
    sub: "The wordmarks in the brand strip, and the brand a product belongs to.",
    emptyHelp: "Brands appear in the logo strip and on the product page.",
    ordered: true, max: 200, layout: "tiles",
    labelOf: function (b) { return b.name; },
    searchText: function (b) { return [b.name, b.slug, b.categoryLabel].join(" "); },
    columns: [],
    tileShot: function (b) {
      return '<div class="ad-tile-shot">' +
        (b.logo ? '<img src="' + esc(api.assetURL(b.logo)) + '" alt="' + esc(b.name) + '" loading="lazy">'
                : '<span class="ad-cell-sub">no logo</span>') + "</div>";
    },
    consequence: function () {
      return "The wordmark disappears from the brand strip. Any product that names this brand keeps working — the product page simply stops showing a brand.";
    },
    newItem: function () { return { name: "", slug: "", category: "", categoryLabel: "", logo: "" }; },
    fields: [
      { key: "name", label: "Brand name", type: "text", required: true, max: 40, width: "full" },
      { key: "slug", label: "Web name", type: "text", required: true, max: 40, pattern: RE.slug,
        patternMessage: "Use lower-case letters, numbers and hyphens only." },
      { key: "category", label: "Category", type: "select", options: function () {
          return [{ value: "", label: "— none —" }].concat(categorySlugOptions());
        } },
      { key: "categoryLabel", label: "Category label", type: "text", max: 40,
        help: "Shown under the brand. Usually the category's own name." },
      { key: "logo", label: "Wordmark", type: "image", folder: "brands", required: true, width: "full" }
    ],
    fromForm: function (v) {
      return { name: v.name.trim(), slug: v.slug.trim(), category: v.category,
               categoryLabel: v.categoryLabel.trim(), logo: v.logo };
    }
  });

  /* ---- Clients ---- */
  create({
    section: "clients", segment: "clients",
    title: "Clients", singular: "client", plural: "clients",
    sub: "The corporate logo strip on the home page and the about page.",
    emptyHelp: "Client logos run in a strip on the home page.",
    ordered: true, max: 200, layout: "tiles",
    labelOf: function (c) { return c.name; },
    searchText: function (c) { return c.name; },
    columns: [],
    tileShot: function (c) {
      return '<div class="ad-tile-shot">' +
        (c.image ? '<img src="' + esc(api.assetURL(c.image)) + '" alt="' + esc(c.name) + '" loading="lazy">'
                 : '<span class="ad-cell-sub">no logo</span>') + "</div>";
    },
    consequence: function () { return "The logo is removed from the client strip."; },
    newItem: function () { return { name: "", image: "" }; },
    fields: [
      { key: "name", label: "Client name", type: "text", required: true, max: 60, width: "full" },
      { key: "image", label: "Logo", type: "image", folder: "client", required: true, width: "full" }
    ],
    fromForm: function (v) { return { name: v.name.trim(), image: v.image }; }
  });

  /* ---- Footer links (two levels: column -> links) ---- */
  create({
    section: "footerLinks", segment: "footer",
    title: "Footer links", singular: "column", plural: "columns",
    sub: "The link columns in the site footer. The footer grid fits four.",
    emptyHelp: "Each column is a heading with a list of links under it.",
    ordered: true, max: 4,
    labelOf: function (c) { return c.title; },
    searchText: function (c) {
      return c.title + " " + (c.items || []).map(function (i) { return i.label; }).join(" ");
    },
    columns: [
      { label: "Column", render: function (c) { return '<div class="ad-cell-main">' + esc(c.title) + "</div>"; } },
      { label: "Links", render: function (c) {
          return '<div class="ad-cell-sub">' + esc((c.items || []).map(function (i) { return i.label; }).join(" · ")) + "</div>";
        } },
      { label: "Count", width: "80px", render: function (c) { return '<span class="ad-pill">' + (c.items || []).length + "</span>"; } }
    ],
    cardBody: function (c) {
      return '<div class="ad-cell-main">' + esc(c.title) + '</div><div class="ad-cell-sub">' +
        FCA.util.plural((c.items || []).length, "link", "links") + "</div>";
    },
    consequence: function (c) {
      return "The whole column and its " + FCA.util.plural((c.items || []).length, "link", "links") + " disappear from the footer.";
    },
    newItem: function () { return { title: "", items: [] }; },
    fields: [
      { key: "title", label: "Column heading", type: "text", required: true, max: 40, width: "full" },
      { key: "items", label: "Links in this column", type: "repeat", itemNoun: "link", maxRows: 12,
        required: true, requiredMessage: "A column needs at least one link.",
        fields: [
          { key: "label", label: "Text", placeholder: "About Us" },
          { key: "href", label: "Link", placeholder: "about.html" }
        ],
        validate: function (rows) {
          for (var i = 0; i < (rows || []).length; i++) {
            if (!rows[i].label || !rows[i].label.trim()) return "Link " + (i + 1) + " has no text.";
            var h = FCA.fields.checkHref((rows[i].href || "").trim());
            if (h) return "Link " + (i + 1) + ": " + h;
            var a = FCA.fields.checkAngle(rows[i].label);
            if (a) return "Link " + (i + 1) + ": " + a;
          }
          return null;
        } }
    ],
    fromForm: function (v) {
      return {
        title: v.title.trim(),
        items: (v.items || []).map(function (r) { return { label: String(r.label || "").trim(), href: String(r.href || "").trim() }; })
      };
    }
  });

  /* ---- Bed sizes ----
     A real collection in the document (docs/api-admin.md §7.1), not a copy:
     products reference it as "@bedSizes", so editing it here changes every
     product that uses it, which is the whole point. */
  FCA.app.register("bedSizes", {
    render: function (host) {
      var page = document.createElement("div");
      page.className = "ad-page";

      var users = (FCA.state.doc.products || []).filter(function (p) {
        if (p.swatches === "@bedSizes") return true;
        var o = p.options || {};
        return Object.keys(o).some(function (k) { return o[k] === "@bedSizes"; });
      });

      page.innerHTML =
        '<div class="ad-page-head"><div>' +
          '<h1 class="ad-page-title">Bed sizes</h1>' +
          '<p class="ad-page-sub">One shared list. Editing it here changes every product that uses it.</p>' +
        "</div></div>" +
        '<div class="ad-card"><div class="ad-card-body">' +
          '<div class="fc-field">' +
            '<label class="fc-label" id="ad-bs-label">The sizes, in the order buyers see them</label>' +
            '<div data-ad-tags></div>' +
            '<p class="ad-help">The first size is the cheapest and the last is the dearest when a ' +
            "product has a price range — the order matters.</p>" +
          "</div>" +
        "</div></div>" +
        '<div class="ad-card"><div class="ad-card-head"><h2>Used by</h2></div><div class="ad-card-body">' +
          (users.length
            ? '<ul class="ad-where">' + users.map(function (p) {
                return '<li><a href="#/products/edit/' + esc(p.id) + '">' + esc(p.name) + "</a></li>";
              }).join("") + "</ul>"
            : '<p class="ad-help" style="font-size:13.5px">No product uses this list yet. Turn on ' +
              "“Buyer chooses an option” on a product and pick “Use the Bed sizes list”.</p>") +
        "</div></div>";

      host.innerHTML = "";
      host.appendChild(page);

      var bar = saveBar({
        backLabel: "Dashboard",
        onBack: function () { FCA.app.navigate("#/"); },
        onSave: function () {
          setSaving(bar, true);
          setSaveBarStatus(bar, "saving", "Saving…");
          FCA.app.saveCollection("bedSizes", { successMessage: "Bed sizes saved." }).then(function (ok) {
            setSaving(bar, false);
            setSaveBarStatus(bar, ok ? "clean" : "failed", ok ? "All changes saved" : "Could not save");
          });
        }
      });
      page.appendChild(bar);
      setSaveBarStatus(bar, FCA.app.isDirty("bedSizes") ? "dirty" : "clean",
        FCA.app.isDirty("bedSizes") ? "Unsaved changes" : "All changes saved");

      tagInput(page.querySelector("[data-ad-tags]"), {
        value: FCA.state.doc.bedSizes || [],
        label: "bed sizes",
        placeholder: "e.g. King — then press Enter",
        onChange: function (v) {
          FCA.state.doc.bedSizes = v;
          FCA.app.recomputeDirty("bedSizes");
          setSaveBarStatus(bar, FCA.app.isDirty("bedSizes") ? "dirty" : "clean",
            FCA.app.isDirty("bedSizes") ? "Unsaved changes" : "All changes saved");
        }
      });
    }
  });
})(window, document);
