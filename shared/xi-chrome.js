/* xi-chrome.js v1 — the bar, the drawer and the footer, built once.
 *
 * WHY THE MARKUP IS BUILT HERE RATHER THAN WRITTEN INTO EACH PAGE. A squad list
 * copied into two HTML files is two lists, and game three makes it three. The
 * night this was written had already produced: a palette declared twice, the
 * word search's name in six places that had to be changed together, a build tag
 * three regexes disagreed about, and an INSERT whose columns and placeholders
 * stopped matching. Every one of them was the same fault. The squad is declared
 * once, below, and both games ask for it.
 *
 * RELEASED GAMES ARE NAMED; UNRELEASED ONES ARE NOT. live_check asserts the
 * site names no unbuilt game, and the hub already obeys it. A shirt number and
 * a status is all an unreleased slot gets — which happens to read as a team
 * sheet filling up.
 *
 * NO FRAMEWORK, NO BUILD STEP. Pages skips the build because there is no
 * package.json, by design. This is a plain script that runs on both games.
 */
(function () {
  "use strict";

  /* THE SQUAD. One list. `href` present means released and named; absent means
     a number and a status, never a name. Order is the shirt number. */
  var SQUAD = [
    { n: 1,  name: "Crossword XI",   href: "/crossword/" },
    { n: 2,  name: "Wordsearch XI",  href: "/wordsearch/" },
    { n: 3,  status: "Nearly ready" },
    { n: 4,  status: "In build" },
    { n: 5,  status: "In build" },
    { n: 6,  status: "In build" },
    { n: 7,  status: "On the drawing board" },
    { n: 8,  status: "On the drawing board" },
    { n: 9,  status: "Not yet signed" },
    { n: 10, status: "Not yet signed" },
    { n: 11, status: "Not yet signed" }
  ];

  /* The pages every game shares. Kept here for the same reason as the squad:
     a footer written into each page is a footer that drifts. */
  var PAGES = [
    { name: "How to play", href: "/crossword/how-to-play" },
    { name: "Answers",     href: "/crossword/answers/" },
    { name: "Privacy",     href: "/crossword/privacy" }
  ];

  var WORDMARK = 'The <span class="xi">XI</span> Games';

  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }

  /* Is this slot the page we are on? Compared on the path only: a query string
     or a token must not stop the drawer marking where you are. */
  function isHere(href) {
    return href && location.pathname.indexOf(href) === 0;
  }

  function squadList() {
    var ul = el("ul", "xic-squad");
    SQUAD.forEach(function (g) {
      var li = document.createElement("li");
      var shirt = '<span class="xic-shirt">' + g.n + "</span>";
      if (g.href) {
        var a = el("a", "xic-slot", shirt + "<span>" + g.name + "</span>");
        a.href = g.href;
        if (isHere(g.href)) a.setAttribute("aria-current", "page");
        li.appendChild(a);
      } else {
        /* A span, not a disabled link: there is nowhere to go, and a link that
           goes nowhere is a promise the site cannot keep. */
        li.appendChild(el("span", "xic-slot soon",
          shirt + '<span class="xic-status">' + g.status + "</span>"));
      }
      ul.appendChild(li);
    });
    return ul;
  }

  var scrim, drawer, opener;

  function close() {
    if (!drawer) return;
    drawer.classList.remove("open");
    scrim.classList.remove("open");
    drawer.setAttribute("aria-hidden", "true");
    if (opener) { opener.setAttribute("aria-expanded", "false"); opener.focus(); }
  }

  function open(btn) {
    opener = btn;
    drawer.classList.add("open");
    scrim.classList.add("open");
    drawer.setAttribute("aria-hidden", "false");
    btn.setAttribute("aria-expanded", "true");
    var first = drawer.querySelector(".xic-close");
    if (first) first.focus();
  }

  /* ---- The account, in the chrome so it is the same in every game ---------
     The session cookie has been scoped Domain=.thexigames.com since accounts
     existed, so signing in on one game already signs you in on all of them.
     What was per-game was the CONTROL: the crossword had one and nothing else
     did, so on the word search or Scrambled there was no way in and no way to
     tell whether you were signed in at all.

     The endpoints were already the family's — /api/auth/session, /api/auth/
     google and /api/auth/signout sit at the repository root and every game
     reaches them. Only the button was missing.

     THIS IS THE UNIVERSAL MINIMUM, not a replacement for the crossword's
     account panel: that one also edits a display name and picks a club, and it
     keeps doing so. Worth knowing there are now two sign-in paths on the
     crossword; consolidating them is follow-up work, not something to do
     inside a shared file that every game loads. */
  var acct = null;

  function accountRow() {
    var row = el("div", "xic-acct");
    row.innerHTML = '<span class="xic-acct-state">…</span>';
    return row;
  }

  function paintAccount(row) {
    if (!row) return;
    var state = row.querySelector(".xic-acct-state");
    if (!state) return;
    if (acct && acct.user) {
      state.textContent = "Signed in as " + (acct.user.displayName || "you");
      var out = el("button", "xic-acct-btn", "Sign out");
      out.type = "button";
      out.addEventListener("click", function () {
        fetch("/api/auth/signout", {
          method: "POST",
          headers: { "X-XI-Games": "1" },
          credentials: "same-origin",
        }).then(function () { location.reload(); })
          .catch(function () { state.textContent = "Could not sign out."; });
      });
      row.appendChild(out);
      return;
    }
    if (!acct || !acct.googleClientId) {
      /* Not configured, or the session call failed. Say nothing rather than
         offering a button that cannot work. */
      row.hidden = true;
      return;
    }
    state.textContent = "Not signed in";
    var mount = el("div", "xic-gsi");
    row.appendChild(mount);
    loadGoogle(acct.googleClientId, mount);
  }

  function loadGoogle(clientId, mount) {
    function render() {
      if (!window.google || !window.google.accounts) return;
      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: function (resp) {
          fetch("/api/auth/google", {
            method: "POST",
            headers: { "X-XI-Games": "1", "Content-Type": "application/json" },
            credentials: "same-origin",
            body: JSON.stringify({ credential: resp.credential }),
          }).then(function () { location.reload(); })
            .catch(function () { /* stay signed out; the page still works */ });
        },
      });
      window.google.accounts.id.renderButton(mount, { type: "standard", size: "medium" });
    }
    if (window.google && window.google.accounts) return render();
    var sc = document.createElement("script");
    sc.src = "https://accounts.google.com/gsi/client";
    sc.async = true; sc.defer = true;
    sc.onload = render;
    /* A blocked or unreachable sign-in service must not take the drawer with
       it. The row simply goes away. */
    sc.onerror = function () { mount.parentNode.hidden = true; };
    document.head.appendChild(sc);
  }

  function buildDrawer() {
    scrim = el("div", "xic-scrim");
    scrim.addEventListener("click", close);

    drawer = el("aside", "xic-drawer");
    drawer.setAttribute("aria-hidden", "true");
    drawer.setAttribute("aria-label", "The XI Games");

    var head = el("div", "xic-dhead");
    var home = el("a", "xic-home", WORDMARK);
    home.href = "/";
    head.appendChild(home);
    var x = el("button", "xic-close", "&times;");
    x.setAttribute("aria-label", "Close");
    x.addEventListener("click", close);
    head.appendChild(x);
    drawer.appendChild(head);

    drawer.appendChild(el("div", "xic-dlabel", "The squad"));
    drawer.appendChild(squadList());

    var foot = el("div", "xic-dfoot");
    PAGES.forEach(function (p) {
      var a = el("a", "xic-slot", "<span>" + p.name + "</span>");
      a.href = p.href;
      foot.appendChild(a);
    });
    /* THE DRAWER MUST BUILD WHERE THERE IS NO FETCH. The squad list, the
       wordmark and the pages are the drawer's job; the account is an extra. An
       environment without fetch — an old browser, a suite driving the chrome in
       jsdom — must get a working drawer and no account row, not an exception
       thrown halfway through building it. The same rule the game already keeps
       about blocked localStorage. */
    var acctRow = accountRow();
    drawer.appendChild(acctRow);
    drawer.appendChild(foot);
    if (typeof fetch !== "function") {
      acctRow.hidden = true;
    } else {
      fetch("/api/auth/session", { headers: { "X-XI-Games": "1" }, credentials: "same-origin" })
        .then(function (r) { return r.json(); })
        .then(function (d) { acct = d; paintAccount(acctRow); })
        .catch(function () { acctRow.hidden = true; });
    }

    document.body.appendChild(scrim);
    document.body.appendChild(drawer);

    /* Escape closes it. A drawer that traps a keyboard player is worse than no
       drawer, and the close button is focused on open so Escape is reachable
       without a mouse. */
    document.addEventListener("keydown", function (ev) {
      if (ev.key === "Escape" && drawer.classList.contains("open")) close();
    });
  }

  /* Fill a bar that the page has already placed. The page owns WHERE the bar
     sits — in the crossword that is two different views — and this owns what is
     in it, so the two games cannot drift apart. */
  function fillBar(bar) {
    var burger = el("button", "xic-burger",
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
      'stroke-linecap="round" aria-hidden="true">' +
      '<path d="M4 7h16M4 12h16M4 17h16"/></svg>');
    burger.type = "button";
    burger.setAttribute("aria-label", "Games and settings");
    burger.setAttribute("aria-expanded", "false");
    burger.addEventListener("click", function () { open(burger); });
    bar.insertBefore(burger, bar.firstChild);

    /* The wordmark goes home from every view, including mid-board. That is the
       fix for being stranded on a puzzle with no route out. */
    if (!bar.querySelector(".xic-home")) {
      var home = el("a", "xic-home", WORDMARK);
      home.href = "/";
      bar.insertBefore(home, burger.nextSibling);
    }
  }

  function buildFooter(foot) {
    var inner = el("div", "xic-foot-in");

    var games = el("div", null, "<h2>The XI Games</h2>");
    var gl = el("ul");
    SQUAD.filter(function (g) { return g.href; }).forEach(function (g) {
      var li = document.createElement("li");
      var a = el("a", null, g.name);
      a.href = g.href;
      li.appendChild(a);
      gl.appendChild(li);
    });
    games.appendChild(gl);

    var more = el("div", null, "<h2>More</h2>");
    var ml = el("ul");
    PAGES.forEach(function (p) {
      var li = document.createElement("li");
      var a = el("a", null, p.name);
      a.href = p.href;
      li.appendChild(a);
      ml.appendChild(li);
    });
    more.appendChild(ml);

    inner.appendChild(games);
    inner.appendChild(more);
    inner.appendChild(el("div", "xic-note",
      "The <b>XI</b> Games &middot; unofficial football puzzles. " +
      "Not affiliated with or endorsed by any club, league, competition or " +
      "governing body."));
    foot.appendChild(inner);
  }

  function init() {
    if (!document.querySelector(".xic-drawer")) buildDrawer();
    Array.prototype.forEach.call(document.querySelectorAll(".xic-bar"), fillBar);
    Array.prototype.forEach.call(document.querySelectorAll(".xic-foot"), function (f) {
      if (!f.querySelector(".xic-foot-in")) buildFooter(f);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  /* Exposed for the suites, and for a game that renders a bar after boot. */
  window.XIChrome = { init: init, squad: SQUAD, pages: PAGES, close: close };
})();
