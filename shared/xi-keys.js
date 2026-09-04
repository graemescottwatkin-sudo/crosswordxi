/* xi-keys.js — the family's on-screen keyboard.
 *
 * WHY THIS IS SHARED AND THE HANDLERS ARE NOT. The keys are the same in every
 * game: the same three rows, the same sizing, the same rule that a device with
 * a real keyboard does not get a drawn one. What a key DOES is not the same at
 * all — the crossword puts a letter in a grid cell and Scrambled appends it to
 * an answer box — so this builds the keyboard and calls back, and each game
 * says what its keys mean.
 *
 * It was the crossword's alone until Scrambled needed it. Copying thirty lines
 * would have been quicker and would have left two keyboards to tune: the
 * crossword's key sizing was got wrong twice and fixed twice, and a copy taken
 * today would inherit the answer while missing every correction after it.
 *
 *   XIKeys.build(document.getElementById("osk"), {
 *     letter: function (ch) { ... },   // a letter was pressed
 *     back:   function () { ... },     // the backspace key
 *     enter:  function () { ... },     // optional; no handler, no enter key
 *   });
 *
 * pointerdown rather than click, and preventDefault on it: a click waits for
 * the pointer to come up, which on a phone is a visible delay per letter, and
 * the default action would move focus off whatever the game has focused.
 */
(function () {
  "use strict";

  var ROWS = ["QWERTYUIOP", "ASDFGHJKL", "ZXCVBNM"];

  /* A DEVICE WITH A REAL KEYBOARD DOES NOT GET A DRAWN ONE. Read once, from
     the pointer rather than from the width: a laptop with a touchscreen has a
     keyboard, and a large tablet in landscape does not. */
  function markTouch() {
    var coarse = window.matchMedia && window.matchMedia("(pointer: coarse)").matches;
    if (coarse) document.body.classList.add("touch");
    return !!coarse;
  }

  function key(cls, label, onPress) {
    var b = document.createElement("button");
    b.type = "button";
    b.className = "osk-key" + (cls ? " " + cls : "");
    b.textContent = label;
    b.addEventListener("pointerdown", function (ev) { ev.preventDefault(); onPress(); });
    return b;
  }

  function build(mount, handlers) {
    if (!mount || !handlers) return false;
    var h = handlers;
    mount.innerHTML = "";
    ROWS.forEach(function (letters, ri) {
      var row = document.createElement("div");
      row.className = "osk-row";
      /* The enter key goes on the left of the last row, opposite backspace,
         so the row still measures ten keys across and the two controls are
         not next to each other — a mis-tap that submits is worse than one
         that deletes. Absent entirely when the game has no use for it. */
      if (ri === 2 && typeof h.enter === "function") {
        row.appendChild(key("wide go", "ENTER", h.enter));
      }
      letters.split("").forEach(function (ch) {
        row.appendChild(key("", ch, function () { h.letter(ch); }));
      });
      if (ri === 2 && typeof h.back === "function") {
        /* U+232B, the erase-to-the-left character. */
        row.appendChild(key("wide", "⌫", h.back));
      }
      mount.appendChild(row);
    });
    return true;
  }

  window.XIKeys = { build: build, markTouch: markTouch, ROWS: ROWS };
})();
