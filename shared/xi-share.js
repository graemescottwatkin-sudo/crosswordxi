/* xi-share.js — how a result leaves the site, in every game.
 *
 * WHAT WAS UNIVERSAL AND WHAT WAS NOT. Every game already built share TEXT and
 * offered a way to copy it. What only Crossword XI had was somewhere to send
 * it — a native share sheet with a copy fallback, and named buttons for the
 * places a football result actually gets posted — and a Challenge control.
 * So three games had the words and no envelope.
 *
 * The buttons, the platform URLs and the copy fallback are the same in every
 * game, so they are here. What is NOT the same is the text: a crossword result
 * is not a word search result, and each game already knows how to write its
 * own. So a game hands over a function that returns its text and a function
 * that returns the board's address, and this owns everything after that.
 *
 *   XIShare.mount(el, {
 *     text:      function () { return "…"; },   // required
 *     url:       function () { return "…"; },   // the board, for a challenge
 *     challenge: function () { … },             // optional; see below
 *   });
 *
 * THE CHALLENGE BUTTON IS EVERYWHERE AND FULLY BACKED IN ONE PLACE. A
 * challenge TABLE needs a score the server computed, and only the crossword
 * has one today — /api/finish is the only thing that writes plays.srv_score.
 * A game with no `challenge` handler therefore sends what it can honestly
 * send: this board's address and what the sender scored on it, which is a
 * challenge in every sense except the standings. As each game's scoring moves
 * server-side it passes a handler and the same button becomes the full thing.
 * The owner asked for the control to be present on that understanding.
 */
(function () {
  "use strict";

  /* Where a football result actually gets posted. Named rather than left to
     the native sheet alone, because the sheet does not exist on desktop. */
  var TARGETS = [
    { id: "whatsapp", name: "WhatsApp",
      href: function (text) { return "https://wa.me/?text=" + encodeURIComponent(text); } },
    { id: "x", name: "X",
      href: function (text) { return "https://twitter.com/intent/tweet?text=" + encodeURIComponent(text); } },
    { id: "reddit", name: "Reddit",
      /* Reddit takes a title and a link rather than a body, so the result
         becomes the title and the board is the link. */
      href: function (text, url) {
        return "https://reddit.com/submit?url=" + encodeURIComponent(url) +
          "&title=" + encodeURIComponent(text.split("\n")[0]);
      } },
  ];

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function btn(cls, text) {
    var b = el("button", cls, text);
    b.type = "button";
    return b;
  }

  /* COPYING, WHEN THERE IS NOWHERE TO SEND IT. The native sheet on a phone
     already offers WhatsApp, Messages and everything else installed — better
     than a row of buttons guessing which apps somebody has. Desktop has no
     such thing, so it copies instead and says so on the button that was
     pressed. */
  function copyInto(button, text, restore) {
    function done(ok) {
      button.textContent = ok ? "Copied" : "Copy failed";
      setTimeout(function () { button.textContent = restore; }, 1800);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { done(true); },
        function () { done(false); });
      return;
    }
    var ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try { done(document.execCommand("copy")); } catch (e) { done(false); }
    document.body.removeChild(ta);
  }

  function mount(target, opts) {
    if (!target || !opts || typeof opts.text !== "function") return null;
    var urlOf = typeof opts.url === "function"
      ? opts.url
      : function () { return location.href; };

    target.innerHTML = "";
    target.classList.add("xis");

    var row = el("div", "xis-row");
    var share = btn("btn secondary xis-share", "Share result");
    share.addEventListener("click", function () {
      var text = opts.text();
      if (navigator.share) {
        navigator.share({ text: text }).catch(function () {
          copyInto(share, text, "Share result");
        });
        return;
      }
      copyInto(share, text, "Share result");
    });
    row.appendChild(share);

    /* THE CHALLENGE. A game that can make a real one passes a handler; one
       that cannot yet sends the board and the score, which is the same
       invitation without the table.

       `challenge: false` omits it, for a game whose results card already
       carries a challenge form — the crossword's, which asks for a name and
       who it is going to. A second button beside a form that does the same
       job is not universality, it is clutter. */
    var challenge = null;
    if (opts.challenge !== false) {
      challenge = btn("btn secondary xis-challenge", "Challenge");
      challenge.addEventListener("click", function () {
        if (typeof opts.challenge === "function") { opts.challenge(); return; }
        var text = opts.text() + "\n" + urlOf();
        if (navigator.share) {
          navigator.share({ text: text }).catch(function () {
            copyInto(challenge, text, "Challenge");
          });
          return;
        }
        copyInto(challenge, text, "Challenge");
      });
      row.appendChild(challenge);
    }
    target.appendChild(row);

    var to = el("div", "xis-to");
    TARGETS.forEach(function (t) {
      var b = btn("btn outline xis-target", t.name);
      b.addEventListener("click", function () {
        window.open(t.href(opts.text(), urlOf()), "_blank", "noopener");
      });
      to.appendChild(b);
    });
    target.appendChild(to);

    return { share: share, challenge: challenge };
  }

  window.XIShare = { mount: mount, TARGETS: TARGETS };
})();
