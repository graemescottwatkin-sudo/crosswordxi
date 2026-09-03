/* xi-theme.js — the family's theme, decided in one place and stamped early.
 *
 * LIGHT BY DEFAULT. The tokens switch on data-theme alone, and a page with
 * no attribute fell back to a media query, so a phone set to dark got the
 * dark palette on the hub, the answers pages and Scrambled — pages with no
 * toggle and no say — while the crossword resolved "auto" in its own script
 * and the word search in another. Three resolvers, three answers. This is
 * the one: the family key xi.theme (fcw.theme read as a fallback from the
 * days the crossword owned it), a stored choice honoured, "auto" following
 * the system, and NOTHING STORED meaning LIGHT — the owner's call, and the
 * palette the games were designed in.
 *
 * Loaded in <head>, synchronously and tiny, so the attribute is on the root
 * before the first paint and a dark-system phone never flashes dark first.
 * No dependencies; runs anywhere the tokens are linked.
 */
(function () {
  "use strict";
  var KEY = "xi.theme", LEGACY = "fcw.theme";
  var CHOICES = ["light", "dark", "auto"];
  var media = null;
  try { media = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null; } catch (e) {}

  function stored() {
    var v = null;
    try { v = localStorage.getItem(KEY) || localStorage.getItem(LEGACY); } catch (e) {}
    return CHOICES.indexOf(v) === -1 ? "light" : v;
  }
  function resolve(choice) {
    if (choice === "auto") return media && media.matches ? "dark" : "light";
    return choice;
  }
  function apply() {
    var choice = stored();
    document.documentElement.setAttribute("data-theme", resolve(choice));
    return choice;
  }
  function set(choice) {
    if (CHOICES.indexOf(choice) === -1) choice = "light";
    try { localStorage.setItem(KEY, choice); } catch (e) {}
    return apply();
  }
  /* light -> dark -> auto -> light, the same order in every game. */
  function cycle() {
    return set(CHOICES[(CHOICES.indexOf(stored()) + 1) % CHOICES.length]);
  }
  if (media && media.addEventListener) {
    media.addEventListener("change", function () { if (stored() === "auto") apply(); });
  }
  apply();
  window.XITheme = { get: stored, set: set, cycle: cycle, apply: apply, CHOICES: CHOICES };
})();
