/* ==========================================================================
   auth.js — login / register for the front-end demo.
   There is NO backend: credentials are checked against FC_DATA.demoUser and
   any accounts registered here are kept in localStorage only.
   ========================================================================== */

(function (window, document) {
  "use strict";

  var D = window.FC_DATA;
  var FC = window.FC;
  var USERS_KEY = "fc365.users";

  function qs(sel, root) { return (root || document).querySelector(sel); }
  function qsa(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  /* ---------------- local "user table" ---------------- */
  function readUsers() {
    try {
      var raw = window.localStorage.getItem(USERS_KEY);
      var list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list : [];
    } catch (err) {
      return [];
    }
  }

  function writeUsers(list) {
    try { window.localStorage.setItem(USERS_KEY, JSON.stringify(list)); } catch (err) {}
  }

  /* The built-in demo account plus anything registered in this browser. */
  function allUsers() {
    return [
      { email: D.demoUser.email, password: D.demoUser.password, name: D.demoUser.name }
    ].concat(readUsers());
  }

  function findUser(email) {
    var needle = String(email).trim().toLowerCase();
    var list = allUsers();
    for (var i = 0; i < list.length; i++) {
      if (list[i].email.toLowerCase() === needle) return list[i];
    }
    return null;
  }

  /* ---------------- validation helpers ---------------- */
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  function setError(input, message) {
    var box = document.getElementById(input.id + "-error");
    if (box) box.textContent = message || "";
    if (message) {
      input.setAttribute("aria-invalid", "true");
    } else {
      input.removeAttribute("aria-invalid");
    }
    return !message;
  }

  function requireValue(input, message) {
    return setError(input, input.value.trim() ? "" : message);
  }

  function requireEmail(input) {
    var v = input.value.trim();
    if (!v) return setError(input, "Email address is required.");
    if (!EMAIL_RE.test(v)) return setError(input, "Enter a valid email address.");
    return setError(input, "");
  }

  function notice(el, type, message) {
    if (!el) return;
    el.className = "fc-notice fc-notice-" + type;
    el.textContent = message;
    el.hidden = false;
  }

  function hide(el) {
    if (el) el.hidden = true;
  }

  /* ---------------- tabs ---------------- */
  function initTabs() {
    var tabs = qsa("button.fc-auth-tab[data-fc-auth-tab]");
    if (!tabs.length) return;

    function select(name, focus) {
      tabs.forEach(function (tab) {
        var active = tab.getAttribute("data-fc-auth-tab") === name;
        tab.setAttribute("aria-selected", String(active));
        tab.setAttribute("tabindex", active ? "0" : "-1");
        if (active && focus) tab.focus();
      });
      qsa("[data-fc-auth-panel]").forEach(function (panel) {
        panel.hidden = panel.getAttribute("data-fc-auth-panel") !== name;
      });
      var heading = qs("[data-fc-auth-heading]");
      var sub = qs("[data-fc-auth-sub]");
      if (heading && sub) {
        if (name === "register") {
          heading.textContent = "Create an account";
          sub.textContent = "Register to save your wishlist and speed up future orders.";
        } else {
          heading.textContent = "Login to your account";
          sub.textContent = "Welcome back. Enter your details to continue.";
        }
      }
    }

    tabs.forEach(function (tab) {
      tab.addEventListener("click", function () {
        select(tab.getAttribute("data-fc-auth-tab"), false);
      });
      /* left/right arrows move between tabs */
      tab.addEventListener("keydown", function (e) {
        var i = tabs.indexOf(tab);
        if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
          e.preventDefault();
          var next = e.key === "ArrowRight" ? (i + 1) % tabs.length : (i - 1 + tabs.length) % tabs.length;
          select(tabs[next].getAttribute("data-fc-auth-tab"), true);
        }
      });
    });

    /* in-copy links such as "Create one here" switch panels too */
    qsa("[data-fc-goto]").forEach(function (link) {
      link.addEventListener("click", function (e) {
        e.preventDefault();
        select(link.getAttribute("data-fc-goto"), true);
      });
    });

    /* ?tab=register or #register opens the register panel directly */
    var wanted = FC.param("tab") || window.location.hash.replace("#", "");
    select(wanted === "register" ? "register" : "login", false);
  }

  /* ---------------- password reveal ---------------- */
  function initPasswordToggles() {
    qsa("[data-fc-password-toggle]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var input = document.getElementById(btn.getAttribute("data-fc-password-toggle"));
        if (!input) return;
        var show = input.type === "password";
        input.type = show ? "text" : "password";
        btn.textContent = show ? "Hide" : "Show";
        btn.setAttribute("aria-label", (show ? "Hide" : "Show") + " password");
      });
    });
  }

  /* ---------------- password strength meter ---------------- */
  function initStrength() {
    var input = qs("#reg-password");
    var wrap = qs("[data-fc-strength]");
    if (!input || !wrap) return;

    var segs = qsa(".fc-strength-seg", wrap);
    var label = qs(".fc-strength-label", wrap);

    input.addEventListener("input", function () {
      var v = input.value;
      var score = 0;
      if (v.length >= 8) score++;
      if (/[A-Z]/.test(v) && /[a-z]/.test(v)) score++;
      if (/\d/.test(v)) score++;
      if (/[^A-Za-z0-9]/.test(v)) score++;

      var tier = score <= 1 ? "weak" : score <= 2 ? "fair" : "good";
      segs.forEach(function (seg, i) {
        seg.className = "fc-strength-seg" + (i < score ? " is-on-" + tier : "");
      });
      if (label) {
        label.textContent = !v
          ? "Use at least 8 characters."
          : tier === "weak"
          ? "Weak password"
          : tier === "fair"
          ? "Fair password"
          : "Strong password";
      }
    });
  }

  /* ---------------- login ---------------- */
  function initLogin() {
    var form = qs("[data-fc-login-form]");
    if (!form) return;

    var box = qs("[data-fc-login-notice]");
    var email = qs("#login-email");
    var password = qs("#login-password");

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      hide(box);

      var ok = requireEmail(email) && requireValue(password, "Password is required.");
      if (!ok) return;

      var user = findUser(email.value);
      if (!user || user.password !== password.value) {
        notice(box, "error", "Wrong email or password. Try the demo account shown on this page.");
        password.select();
        return;
      }

      FC.session.set({ name: user.name, email: user.email });
      FC.paintSession();
      notice(box, "success", "Signed in as " + user.name + ". Redirecting to your account…");

      var redirect = FC.param("redirect") || "account.html";
      window.setTimeout(function () { window.location.href = redirect; }, 900);
    });

    /* one-click fill for the demo credentials */
    var fill = qs("[data-fc-fill-demo]");
    if (fill) {
      fill.addEventListener("click", function () {
        email.value = D.demoUser.email;
        password.value = D.demoUser.password;
        setError(email, "");
        setError(password, "");
        notice(box, "success", "Demo credentials filled in. Press Login to continue.");
        password.focus();
      });
    }
  }

  /* ---------------- register ---------------- */
  function initRegister() {
    var form = qs("[data-fc-register-form]");
    if (!form) return;

    var box = qs("[data-fc-register-notice]");
    var first = qs("#reg-first");
    var last = qs("#reg-last");
    var email = qs("#reg-email");
    var phone = qs("#reg-phone");
    var password = qs("#reg-password");
    var confirm = qs("#reg-confirm");
    var terms = qs("#reg-terms");

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      hide(box);

      var ok = true;
      ok = requireValue(first, "First name is required.") && ok;
      ok = requireValue(last, "Last name is required.") && ok;
      ok = requireEmail(email) && ok;

      /* Bangladeshi mobile numbers: 01XXXXXXXXX, optionally +880 */
      var phoneVal = phone.value.trim();
      if (!phoneVal) {
        ok = setError(phone, "Phone number is required.") && ok;
      } else if (!/^(?:\+?880|0)1[3-9]\d{8}$/.test(phoneVal.replace(/[\s-]/g, ""))) {
        ok = setError(phone, "Enter a valid Bangladeshi mobile number, e.g. 01XXXXXXXXX.") && ok;
      } else {
        ok = setError(phone, "") && ok;
      }

      if (password.value.length < 8) {
        ok = setError(password, "Use at least 8 characters.") && ok;
      } else {
        ok = setError(password, "") && ok;
      }

      if (confirm.value !== password.value) {
        ok = setError(confirm, "Passwords do not match.") && ok;
      } else {
        ok = setError(confirm, "") && ok;
      }

      var termsError = qs("#reg-terms-error");
      if (!terms.checked) {
        if (termsError) termsError.textContent = "Please accept the terms and conditions.";
        ok = false;
      } else if (termsError) {
        termsError.textContent = "";
      }

      if (!ok) return;

      if (findUser(email.value)) {
        notice(box, "error", "An account with that email already exists in this browser.");
        return;
      }

      var user = {
        name: first.value.trim() + " " + last.value.trim(),
        email: email.value.trim(),
        phone: phoneVal,
        password: password.value
      };

      var list = readUsers();
      list.push(user);
      writeUsers(list);

      FC.session.set({ name: user.name, email: user.email });
      FC.paintSession();
      notice(box, "success", "Account created for " + user.name + ". Redirecting…");
      form.reset();

      window.setTimeout(function () { window.location.href = "account.html"; }, 1000);
    });
  }

  /* ---------------- boot ---------------- */
  function init() {
    if (!qs("[data-fc-auth]")) return;

    /* already signed in? offer the account page instead of a second login */
    var user = FC.session.get();
    if (user) {
      var box = qs("[data-fc-login-notice]");
      notice(
        box,
        "success",
        "You are already signed in as " + user.name + "."
      );
    }

    initTabs();
    initPasswordToggles();
    initStrength();
    initLogin();
    initRegister();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})(window, document);
