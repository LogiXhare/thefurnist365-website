/* ==========================================================================
   auth.js — the login panel, the session poll, logout, and the in-place
   re-authentication that a 401 mid-edit triggers.

   There is one password and no username: the server compares it against a
   pbkdf2 hash in data/admin.json and mints an HttpOnly cookie. Nothing here
   ever sees or stores the password, and the customer demo login in
   assets/js/auth.js shares no code path with this file.
   ========================================================================== */

(function (window, document) {
  "use strict";

  var FCA = window.FCA = window.FCA || {};
  var api = FCA.api;

  var onAuthenticated = null;
  var pollTimer = null;
  var expiresAt = null;
  var warnedExpiry = false;

  /* ------------------------------------------------------------------
     login panel
     ------------------------------------------------------------------ */

  var form, input, submit, errorBox, toggle;

  function showError(message, opts) {
    opts = opts || {};
    errorBox.hidden = false;
    errorBox.innerHTML = "<strong>" + esc(message) + "</strong>" +
      (opts.help ? "<br>" + esc(opts.help) : "");
    if (opts.retry) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "fc-btn fc-btn-sm";
      b.style.marginTop = "10px";
      b.textContent = "Try again";
      b.addEventListener("click", function () { form.requestSubmit ? form.requestSubmit() : submitLogin(); });
      errorBox.appendChild(b);
    }
  }

  function clearError() {
    errorBox.hidden = true;
    errorBox.innerHTML = "";
    input.removeAttribute("aria-invalid");
  }

  function esc(v) { return FCA.util ? FCA.util.esc(v) : String(v == null ? "" : v); }

  function setBusy(busy, label) {
    submit.disabled = busy;
    if (busy) {
      submit.setAttribute("aria-busy", "true");
      submit.innerHTML = '<i class="ad-spinner ad-spinner-dark" aria-hidden="true"></i>' + esc(label || "Signing in…");
      /* readonly, not disabled: a disabled input loses its value on some
         mobile browsers when the page is restored from the back/forward
         cache, and she would have to type the password again. */
      input.readOnly = true;
    } else {
      submit.removeAttribute("aria-busy");
      submit.textContent = label || "Sign in";
      input.readOnly = false;
    }
  }

  function lockOut(seconds) {
    var left = seconds;
    submit.disabled = true;
    input.readOnly = true;
    (function tick() {
      if (left <= 0) {
        submit.disabled = false;
        input.readOnly = false;
        submit.textContent = "Sign in";
        clearError();
        return;
      }
      var m = Math.floor(left / 60), s = left % 60;
      submit.textContent = "Try again in " + (m ? m + "m " : "") + s + "s";
      left--;
      setTimeout(tick, 1000);
    })();
  }

  function submitLogin() {
    var pw = input.value;
    if (!pw) {
      showError("Enter the admin password.");
      input.setAttribute("aria-invalid", "true");
      input.focus();
      return;
    }
    clearError();
    setBusy(true);

    api.login(pw).then(function (res) {
      expiresAt = res.expiresAt || null;
      warnedExpiry = false;
      setBusy(false);
      input.value = "";
      startPoll();
      if (onAuthenticated) onAuthenticated();
      if (FCA.ui) FCA.ui.toast("Signed in.");
    }).catch(function (err) {
      setBusy(false);
      if (err.code === "rate_limited") {
        showError(err.message || "Too many attempts.");
        lockOut(300);
        return;
      }
      if (err.code === "network") {
        showError("Cannot reach the server.", { help: "Is it running? Start it with: python serve.py", retry: true });
        return;
      }
      if (err.code === "no_admin_password") return;   /* blocking screen took over */

      /* Never "wrong password for this user" — there is no user. */
      showError(err.message || "That password is not correct.");
      input.setAttribute("aria-invalid", "true");
      input.value = "";
      input.focus();
    });
  }

  function wireLogin() {
    form = document.getElementById("ad-login-form");
    input = document.getElementById("ad-login-password");
    submit = document.getElementById("ad-login-submit");
    errorBox = document.getElementById("ad-login-error");
    toggle = document.getElementById("ad-login-toggle");

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      submitLogin();
    });

    toggle.addEventListener("click", function () {
      var showing = input.type === "text";
      input.type = showing ? "password" : "text";
      toggle.textContent = showing ? "Show" : "Hide";
      toggle.setAttribute("aria-pressed", showing ? "false" : "true");
      toggle.setAttribute("aria-label", showing ? "Show the password" : "Hide the password");
      input.focus();
    });
  }

  function showLogin() {
    FCA.app.showOnly("ad-login");
    setBusy(false);
    setTimeout(function () { try { input.focus(); } catch (e) {} }, 30);
  }

  /* ------------------------------------------------------------------
     session poll + expiry warning
     ------------------------------------------------------------------ */

  function startPoll() {
    clearInterval(pollTimer);
    pollTimer = setInterval(check, 5 * 60 * 1000);
  }

  function check() {
    api.session().then(function (s) {
      if (!s.authenticated) {
        /* The cookie is gone. Do not redirect — that would throw away her
           work. Ask for the password in place. */
        reauth();
        return;
      }
      expiresAt = s.expiresAt || expiresAt;
      warnIfExpiringSoon();
    }).catch(function () { /* a failed poll is not worth interrupting her for */ });
  }

  function warnIfExpiringSoon() {
    if (!expiresAt || warnedExpiry) return;
    var ms = new Date(expiresAt).getTime() - Date.now();
    if (isNaN(ms) || ms > 10 * 60 * 1000 || ms < 0) return;
    warnedExpiry = true;
    FCA.ui.banner({
      tag: "expiry",
      kind: "warn",
      title: "You will be signed out in about 10 minutes.",
      body: "Save anything you are part-way through. You can sign straight back in without losing it.",
      actions: [{
        label: "Stay signed in",
        onClick: function (node) {
          /* any authenticated request slides the session forward */
          api.loadMeta().then(function () {
            node.parentNode.removeChild(node);
            warnedExpiry = false;
            FCA.ui.toast("Session extended.");
          }).catch(function () {});
        }
      }]
    });
  }

  /* ------------------------------------------------------------------
     in-place re-authentication (§7.7)
     ------------------------------------------------------------------ */

  var reauthPending = null;

  function reauth() {
    if (reauthPending) return reauthPending;

    /* Flush the working copy before anything else — if this browser tab dies
       while the dialog is open, the draft banner brings her work back. */
    if (FCA.app && FCA.app.flushDraft) FCA.app.flushDraft();

    var body = document.createElement("div");
    body.innerHTML =
      "<p>For safety you are signed out after a while. <strong>Your unsaved changes are safe</strong> " +
      "— sign back in and they will still be here.</p>" +
      '<div class="fc-field">' +
        '<label class="fc-label" for="ad-reauth-pw">Admin password</label>' +
        '<input class="fc-input" id="ad-reauth-pw" type="password" autocomplete="current-password" data-ad-autofocus>' +
        '<span class="ad-fielderr" id="ad-reauth-err" hidden></span>' +
      "</div>" +
      '<p class="ad-help"><button type="button" class="ad-linklike" data-ad-giveup ' +
      'style="border:0;background:none;color:var(--fc-text-soft);text-decoration:underline;padding:6px 0">' +
      "Log out and discard my changes</button></p>";

    reauthPending = FCA.ui.modal({
      title: "Your session ended.",
      bodyNode: body,
      dismissible: false,   /* the only exits are signing in, or giving up */
      actions: [{
        label: "Sign in",
        keepOpen: true,
        onSelect: function (close) {
          var pw = body.querySelector("#ad-reauth-pw");
          var err = body.querySelector("#ad-reauth-err");
          var btn = document.querySelector('.fc-modal [data-ad-action="0"]');
          err.hidden = true;
          if (!pw.value) { err.hidden = false; err.textContent = "Enter the password."; pw.focus(); return false; }
          btn.disabled = true;
          btn.textContent = "Signing in…";
          api.login(pw.value).then(function (res) {
            expiresAt = res.expiresAt || null;
            warnedExpiry = false;
            close(true);
          }).catch(function (e) {
            btn.disabled = false;
            btn.textContent = "Sign in";
            err.hidden = false;
            err.textContent = e.message || "That password is not correct.";
            pw.value = "";
            pw.focus();
          });
          return false;   /* we close it ourselves, on success only */
        }
      }]
    }).then(function (ok) {
      reauthPending = null;
      if (!ok) return false;
      startPoll();
      FCA.ui.toast("Signed back in.");
      return true;
    });

    body.querySelector("[data-ad-giveup]").addEventListener("click", function () {
      try { sessionStorage.clear(); } catch (e) {}
      location.reload();
    });

    return reauthPending;
  }

  /* api.js calls this on any 401 and replays the request when it resolves
     true, so a session that dies mid-save costs nothing. */
  api.handlers.reauth = function () { return reauth(); };

  /* ------------------------------------------------------------------
     boot
     ------------------------------------------------------------------ */

  function start(cb) {
    onAuthenticated = cb;
    wireLogin();

    api.session().then(function (s) {
      if (s.authenticated) {
        expiresAt = s.expiresAt || null;
        startPoll();
        cb();
      } else {
        showLogin();
      }
    }).catch(function (err) {
      if (err.code === "no_admin_password" || err.code === "store_unreadable") return;  /* blocking screen shown */
      if (err.code === "network") {
        FCA.app.showOnly("ad-login");
        showError("Cannot reach the server.", { help: "Is it running? Start it with: python serve.py", retry: true });
        return;
      }
      /* Anything else (a 404 because the API is not wired yet) is worth
         saying out loud rather than silently drawing a login that cannot
         work. */
      FCA.app.showOnly("ad-login");
      showError("The admin API did not answer.", {
        help: "The server replied " + err.status + " " + err.code + ". The panel needs /api/admin to be running."
      });
    });
  }

  function logout() {
    var go = Promise.resolve(true);
    if (FCA.app.dirtySections().length) {
      go = FCA.ui.modal({
        title: "Log out with unsaved changes?",
        bodyHTML: "<p>You have unsaved changes. They will be lost.</p>",
        actions: [
          { label: "Stay signed in", value: false },
          { label: "Log out", kind: "danger", value: true }
        ]
      });
    }
    go.then(function (yes) {
      if (!yes) return;
      try { sessionStorage.clear(); } catch (e) {}
      api.logout().catch(function () { /* logging out twice is not an error */ })
        .then(function () { location.reload(); });
    });
  }

  FCA.auth = { start: start, logout: logout, reauth: reauth };
})(window, document);
