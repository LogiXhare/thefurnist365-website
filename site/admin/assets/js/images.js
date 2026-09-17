/* ==========================================================================
   images.js — the one image widget: gallery strip, drag/drop, upload with
   progress, "choose existing", reorder, remove-with-undo.

   Used multi by Products (the gallery) and single by Hero / Categories /
   Series / Clients / Brands / the menu promo panel.

   Uploads POST immediately — a file cannot live in a JS object — and that is
   the one place the explicit-save model bends, so the widget says so out
   loud: "Uploaded. Press Save changes to use it." An abandoned form leaves an
   orphan file on disk; that is deliberate and harmless (a stale image hurts
   nobody, a wrongly deleted one does).

   Transport is base64 inside JSON, per docs/api-admin.md §4 — the server is
   stdlib-only and cgi.FieldStorage is gone in Python 3.13.
   ========================================================================== */

(function (window, document) {
  "use strict";

  var FCA = window.FCA = window.FCA || {};
  var api = FCA.api;

  var RASTER = ["jpg", "jpeg", "png", "webp", "gif"];

  function limits() {
    var m = FCA.state && FCA.state.meta;
    return (m && m.limits) || {};
  }
  function maxBytes() { return limits().uploadBytes || 6291456; }
  function maxGallery() { return limits().maxGallery || 12; }

  function mb(bytes) { return (bytes / 1048576).toFixed(1) + " MB"; }
  function ext(name) {
    var m = /\.([a-z0-9]+)$/i.exec(String(name || ""));
    return m ? m[1].toLowerCase() : "";
  }
  function basename(p) { return String(p || "").split("/").pop(); }
  function esc(v) { return FCA.util.esc(v); }

  /* SVG is only accepted into the two brand folders, and only after the
     server scrubs it. Saying so up front beats a 415 after the upload. */
  function allowedExts(folder) {
    return (folder === "brands" || folder === "brand") ? RASTER.concat(["svg"]) : RASTER;
  }

  function typeMessage(folder) {
    return allowedExts(folder).indexOf("svg") >= 0
      ? "Only JPG, PNG, WEBP, GIF and SVG files can be used."
      : "Only JPG, PNG, WEBP and GIF files can be used.";
  }

  /* Checked before the request: never make her upload 8 MB on mobile data to
     be told no. */
  function precheck(file, folder) {
    var e = ext(file.name);
    var okExt = allowedExts(folder).indexOf(e) >= 0;
    var okType = !file.type || /^image\//.test(file.type);
    if (!okExt || !okType) return { ok: false, message: typeMessage(folder) };
    if (file.size > maxBytes()) {
      return {
        ok: false,
        message: "Too big (" + mb(file.size) + "). Maximum is " + mb(maxBytes()) + ".",
        help: "Try saving the photo smaller before uploading."
      };
    }
    if (file.size === 0) return { ok: false, message: "That file is empty." };
    return { ok: true };
  }

  function readAsBase64(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onerror = function () { reject(new Error("The file could not be read.")); };
      reader.onload = function () {
        var s = String(reader.result);
        var comma = s.indexOf(",");
        resolve(comma >= 0 ? s.slice(comma + 1) : s);
      };
      reader.readAsDataURL(file);
    });
  }

  /* ======================================================================
     widget
     ====================================================================== */

  /* opts: { folder, multi, value, onChange, label } */
  function mount(host, opts) {
    var folder = opts.folder;
    var multi = !!opts.multi;
    var onChange = opts.onChange || function () {};

    /* Internal model: always an array. Single-image callers get a string
       back, so the caller never deals with the difference. */
    var paths = multi
      ? (Array.isArray(opts.value) ? opts.value.slice() : (opts.value ? [opts.value] : []))
      : (opts.value ? [opts.value] : []);

    /* Tiles that are mid-upload or failed are not in `paths` yet — they live
       here until they land. */
    var pending = [];   /* {id, name, previewURL, pct, error, help, file, abort} */
    var seq = 0;

    var wrap = document.createElement("div");
    host.innerHTML = "";
    host.appendChild(wrap);

    function emit() {
      onChange(multi ? paths.slice() : (paths[0] || ""));
    }

    function render() {
      var full = multi && (paths.length + pending.length) >= maxGallery();
      var html = '<div class="ad-gallery' + (multi ? "" : " ad-gallery-single") + '">';

      paths.forEach(function (p, i) {
        html +=
          '<div class="ad-shot' + (multi && i === 0 ? " is-main" : "") + '" data-ad-tile="' + i + '">' +
            '<img src="' + esc(api.assetURL(p)) + '" alt="' + esc(basename(p)) + '" loading="lazy">' +
            (multi && i === 0 ? '<span class="ad-shot-badge">MAIN</span>' : "") +
            '<div class="ad-shot-actions">' +
              (multi
                ? '<button type="button" class="ad-iconbtn" data-ad-main="' + i + '"' +
                  (i === 0 ? " disabled" : "") + ' title="' + (i === 0 ? "Already the main photo" : "Make this the main photo") +
                  '" aria-label="' + (i === 0 ? "Already the main photo" : "Make " + esc(basename(p)) + " the main photo") + '">' +
                  FCA.util.icon(i === 0 ? "starFill" : "star") + "</button>" +
                  '<button type="button" class="ad-iconbtn" data-ad-up="' + i + '"' + (i === 0 ? " disabled" : "") +
                  ' title="Move earlier" aria-label="Move ' + esc(basename(p)) + ' earlier">' + FCA.util.icon("up") + "</button>" +
                  '<button type="button" class="ad-iconbtn" data-ad-down="' + i + '"' + (i === paths.length - 1 ? " disabled" : "") +
                  ' title="Move later" aria-label="Move ' + esc(basename(p)) + ' later">' + FCA.util.icon("down") + "</button>"
                : "") +
              '<button type="button" class="ad-iconbtn ad-iconbtn-danger" data-ad-remove="' + i + '" ' +
                'title="Remove" aria-label="Remove ' + esc(basename(p)) + '">' + FCA.util.icon("close") + "</button>" +
            "</div>" +
          "</div>";
      });

      pending.forEach(function (t) {
        if (t.error) {
          html +=
            '<div class="ad-shot is-error" data-ad-pending="' + t.id + '">' +
              (t.previewURL ? '<img src="' + esc(t.previewURL) + '" alt="">' : esc(t.name)) +
              '<div class="ad-shot-err" role="alert"><b>' + esc(t.error) + "</b>" +
                (t.help ? "<span>" + esc(t.help) + "</span><br>" : "") +
                (t.file ? '<button type="button" data-ad-retry="' + t.id + '">Retry</button> ' : "") +
                '<button type="button" data-ad-drop-pending="' + t.id + '">Remove</button>' +
              "</div>" +
            "</div>";
        } else {
          html +=
            '<div class="ad-shot is-busy" data-ad-pending="' + t.id + '">' +
              (t.previewURL ? '<img src="' + esc(t.previewURL) + '" alt="">' : "") +
              '<span class="ad-shot-pct">' + (t.pct || 0) + "%</span>" +
              '<div class="ad-shot-actions"><button type="button" class="ad-iconbtn ad-iconbtn-danger" ' +
                'data-ad-cancel="' + t.id + '" title="Cancel this upload" aria-label="Cancel uploading ' + esc(t.name) + '">' +
                FCA.util.icon("close") + "</button></div>" +
              '<div class="ad-shot-bar"><i style="width:' + (t.pct || 0) + '%"></i></div>' +
            "</div>";
        }
      });

      if (!full) {
        html +=
          '<button class="ad-drop" type="button" data-ad-drop>' +
            FCA.util.icon("upload") +
            "<b>" + (paths.length && !multi ? "Replace photo" : "Add photo") + "</b>" +
            "<span>or drop a file here</span>" +
          "</button>";
      }
      html += "</div>";

      html +=
        '<div class="ad-media-foot">' +
          '<button class="fc-btn fc-btn-sm fc-btn-outline" type="button" data-ad-browse>Choose an existing photo</button>' +
          '<span class="ad-help" data-ad-queue></span>' +
        "</div>" +
        '<p class="ad-help">' +
          (multi ? "The first photo is the main one — it is what the shop grid shows. " : "") +
          esc(typeMessage(folder)) + " Up to " + mb(maxBytes()) + "." +
          " Uploaded photos are only used after you press <b>Save changes</b>." +
        "</p>";

      /* the help line above deliberately contains one <b>; build it as HTML */
      wrap.innerHTML = html;
      var queue = wrap.querySelector("[data-ad-queue]");
      var busy = pending.filter(function (t) { return !t.error; }).length;
      if (queue && busy) queue.textContent = "Uploading " + (uploadedInBatch + 1) + " of " + (uploadedInBatch + busy) + "…";

      var input = document.createElement("input");
      input.type = "file";
      input.accept = allowedExts(folder).map(function (e) { return "." + e; }).join(",") + ",image/*";
      if (multi) input.multiple = true;
      input.className = "fc-visually-hidden";
      input.addEventListener("change", function () {
        enqueue(Array.prototype.slice.call(input.files));
        input.value = "";
      });
      wrap.appendChild(input);
      wrap._input = input;
    }

    /* ---- events (delegated, so a re-render never loses them) ---- */
    wrap.addEventListener("click", function (e) {
      var t = e.target.closest("button");
      if (!t) return;
      var n;

      if (t.hasAttribute("data-ad-drop")) { wrap._input.click(); return; }
      if (t.hasAttribute("data-ad-browse")) { browse(); return; }

      if ((n = t.getAttribute("data-ad-main")) != null) {
        var i = Number(n);
        paths.unshift(paths.splice(i, 1)[0]);
        render(); emit();
        FCA.ui.toast("Main photo changed.");
        return;
      }
      if ((n = t.getAttribute("data-ad-up")) != null) { swap(Number(n), Number(n) - 1); return; }
      if ((n = t.getAttribute("data-ad-down")) != null) { swap(Number(n), Number(n) + 1); return; }

      if ((n = t.getAttribute("data-ad-remove")) != null) { removeAt(Number(n)); return; }

      if ((n = t.getAttribute("data-ad-cancel")) != null) {
        var tile = findPending(n);
        if (tile && tile.abort) tile.abort();
        return;
      }
      if ((n = t.getAttribute("data-ad-drop-pending")) != null) {
        dropPending(n);
        render();
        return;
      }
      if ((n = t.getAttribute("data-ad-retry")) != null) {
        var rt = findPending(n);
        if (!rt) return;
        rt.error = null;
        rt.pct = 0;
        render();
        runQueue();
        return;
      }
    });

    /* ---- drag & drop ---- */
    ["dragenter", "dragover"].forEach(function (evt) {
      wrap.addEventListener(evt, function (e) {
        if (!e.dataTransfer || Array.prototype.indexOf.call(e.dataTransfer.types || [], "Files") < 0) return;
        e.preventDefault();
        var drop = wrap.querySelector("[data-ad-drop]");
        if (drop) { drop.classList.add("is-over"); drop.querySelector("b").textContent = "Drop to upload"; }
      });
    });
    ["dragleave", "drop"].forEach(function (evt) {
      wrap.addEventListener(evt, function (e) {
        var drop = wrap.querySelector("[data-ad-drop]");
        if (drop) { drop.classList.remove("is-over"); }
        if (evt === "drop") {
          e.preventDefault();
          var files = e.dataTransfer && e.dataTransfer.files;
          if (files && files.length) enqueue(Array.prototype.slice.call(files));
        } else if (drop) {
          drop.querySelector("b").textContent = paths.length && !multi ? "Replace photo" : "Add photo";
        }
      });
    });

    function swap(a, b) {
      if (b < 0 || b >= paths.length) return;
      var tmp = paths[a]; paths[a] = paths[b]; paths[b] = tmp;
      render(); emit();
    }

    /* No modal for a removal: the tile becomes an Undo placeholder for 8
       seconds. It only drops the path from the working copy — the file on
       disk is never touched by this panel. */
    function removeAt(i) {
      var removed = paths.splice(i, 1)[0];
      render(); emit();
      FCA.ui.toast("Photo removed.", {
        actionLabel: "Undo",
        onAction: function () {
          paths.splice(Math.min(i, paths.length), 0, removed);
          render(); emit();
        }
      });
    }

    function findPending(id) {
      for (var i = 0; i < pending.length; i++) if (String(pending[i].id) === String(id)) return pending[i];
      return null;
    }
    function dropPending(id) {
      for (var i = 0; i < pending.length; i++) {
        if (String(pending[i].id) === String(id)) {
          if (pending[i].previewURL) URL.revokeObjectURL(pending[i].previewURL);
          pending.splice(i, 1);
          return;
        }
      }
    }

    /* ---- the upload queue ----
       Sequential, not parallel: a phone on 3G uploading six files at once
       tends to time all six out. */
    var running = false;
    var uploadedInBatch = 0;

    function enqueue(files) {
      if (!files.length) return;
      if (!multi) { pending.length = 0; files = files.slice(0, 1); }

      var room = multi ? maxGallery() - paths.length - pending.length : 1;
      if (room <= 0) {
        FCA.ui.toast("That is the maximum of " + maxGallery() + " photos.");
        return;
      }
      if (files.length > room) {
        FCA.ui.toast("Only " + room + " more " + (room === 1 ? "photo fits" : "photos fit") + " here.");
        files = files.slice(0, room);
      }

      files.forEach(function (file) {
        var check = precheck(file, folder);
        pending.push({
          id: ++seq,
          name: file.name,
          previewURL: URL.createObjectURL(file),
          pct: 0,
          file: check.ok ? file : null,
          error: check.ok ? null : check.message,
          help: check.ok ? null : check.help
        });
      });
      render();
      runQueue();
    }

    function runQueue() {
      if (running) return;
      var next = null;
      for (var i = 0; i < pending.length; i++) {
        if (!pending[i].error && pending[i].file) { next = pending[i]; break; }
      }
      if (!next) { uploadedInBatch = 0; return; }

      running = true;
      readAsBase64(next.file).then(function (b64) {
        return api.upload({
          folder: folder,
          filename: next.file.name,
          data: b64,
          onProgress: function (pct) {
            next.pct = pct;
            var bar = wrap.querySelector('[data-ad-pending="' + next.id + '"] .ad-shot-bar i');
            var lbl = wrap.querySelector('[data-ad-pending="' + next.id + '"] .ad-shot-pct');
            if (bar) bar.style.width = pct + "%";
            if (lbl) lbl.textContent = pct + "%";
          },
          onAbortHandle: function (abort) { next.abort = abort; }
        });
      }).then(function (res) {
        running = false;
        uploadedInBatch++;
        dropPending(next.id);
        if (!multi) paths.length = 0;
        paths.push(res.path);
        render();
        emit();
        runQueue();
      }).catch(function (err) {
        running = false;
        if (err.code === "aborted") {
          dropPending(next.id);
          render();
          runQueue();
          return;
        }
        next.error = uploadErrorText(err);
        next.help = err.code === "too_large" ? "Try saving the photo smaller before uploading." : null;
        render();
        runQueue();
      });
    }

    function uploadErrorText(err) {
      switch (err.code) {
        case "network": return "No connection. The photo was not uploaded.";
        case "too_large": return "Too big. Maximum is " + mb(err.body.limit || maxBytes()) + ".";
        case "bad_image": return err.message || typeMessage(folder);
        case "empty_file": return "That file is empty.";
        case "bad_folder": return "This photo cannot go in that folder.";
        default: return "Upload failed — the server said: " + (err.message || err.code) + ".";
      }
    }

    /* ---- choose an existing photo ---- */
    function browse() {
      var body = document.createElement("div");
      body.innerHTML = '<div class="ad-gallery">' + FCA.ui.skeletonRows(2) + "</div>";

      var dialog = FCA.ui.modal({
        title: "Choose an existing photo",
        bodyNode: body,
        actions: [{ label: "Cancel", kind: "outline", value: null }]
      });

      api.listImages(folder).then(function (r) {
        var items = r.items || [];
        if (!items.length) {
          body.innerHTML = '<p class="ad-help" style="font-size:13.5px">There are no photos in this folder yet. Upload one instead.</p>';
          return;
        }
        body.innerHTML = '<div class="ad-gallery">' + items.map(function (it) {
          return '<button type="button" class="ad-shot" data-ad-pick="' + esc(it.path) + '" ' +
            'title="' + esc(basename(it.path)) + (it.usedBy && it.usedBy.length ? " — in use" : " — not used anywhere") + '">' +
            '<img src="' + esc(api.assetURL(it.path)) + '" alt="' + esc(basename(it.path)) + '" loading="lazy">' +
            "</button>";
        }).join("") + "</div>";

        body.addEventListener("click", function (e) {
          var b = e.target.closest("[data-ad-pick]");
          if (!b) return;
          var p = b.getAttribute("data-ad-pick");
          if (multi) {
            if (paths.indexOf(p) >= 0) { FCA.ui.toast("That photo is already here."); return; }
            if (paths.length >= maxGallery()) { FCA.ui.toast("That is the maximum of " + maxGallery() + " photos."); return; }
            paths.push(p);
          } else {
            paths = [p];
          }
          render(); emit();
          var wrapEl = document.querySelector(".fc-modal");
          if (wrapEl && wrapEl._close) wrapEl._close(null);
        });
      }).catch(function (err) {
        body.innerHTML = '<p class="ad-help" style="font-size:13.5px">Could not list the photos: ' + esc(err.message) + "</p>";
      });

      return dialog;
    }

    render();

    return {
      get value() { return multi ? paths.slice() : (paths[0] || ""); },
      set value(v) {
        paths = multi ? (Array.isArray(v) ? v.slice() : (v ? [v] : [])) : (v ? [v] : []);
        render();
      },
      isBusy: function () { return pending.some(function (t) { return !t.error; }); },
      hasErrors: function () { return pending.some(function (t) { return !!t.error; }); },
      destroy: function () {
        pending.forEach(function (t) { if (t.previewURL) URL.revokeObjectURL(t.previewURL); });
        pending.length = 0;
      }
    };
  }

  FCA.images = { mount: mount, precheck: precheck, maxBytes: maxBytes, maxGallery: maxGallery };
})(window, document);
