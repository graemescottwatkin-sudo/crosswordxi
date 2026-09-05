/* names_test.mjs — what counts as a name, and what counts as typing it.
 *
 *   node scrambled/names_test.mjs        (from the repo root)
 */
import {
  NAME_SHAPE, isEnglishForm, normalise, matchesSlot, letterBag, enumerationOf, wordsOf,
} from "../../functions/_lib/sc-names.js";

let pass = 0, fail = 0;
function t(name, ok, note) {
  if (ok) { pass++; console.log(`  ok  ${name}${note ? "  — " + note : ""}`); }
  else { fail++; console.log(`FAIL  ${name}${note ? "  — " + note : ""}`); }
}

console.log("\n=== The authoring gate: plain A-Z only ===");
t("a plain name is English form", isEnglishForm("BECKHAM"));
t("two words are fine", isEnglishForm("JACK CHARLTON"));
t("an apostrophe is fine", isEnglishForm("O'SHEA"));
t("a hyphen is fine", isEnglishForm("ALEXANDER-ARNOLD"));
/* The failure this gate exists for: a name pasted off a squad list with the
   combining mark still on it. The scramble would then be built from a
   different letter multiset than the one the player is shown. */
t("an accented name is REFUSED at authoring time", !isEnglishForm("MODRI\u0106"),
  "the scramble would not match the tiles");
t("a digit is refused", !isEnglishForm("PLAYER2"));
t("a name shape that starts with a space is refused", !NAME_SHAPE.test(" BANKS"));

console.log("\n=== Input: forgiving, never fuzzy ===");
t("case falls away", normalise("beckham") === "BECKHAM");
t("spacing falls away", normalise("  jack   charlton ") === "JACKCHARLTON");
t("apostrophes and hyphens fall away", normalise("O'Shea") === "OSHEA");
/* The other direction: a player typing the correct spelling of a man's name
   on their own keyboard has not got it wrong. */
t("a diacritic typed by the player is accepted", normalise("Modri\u0107") === "MODRIC");
t("O-slash has no decomposition and is handled by hand",
  normalise("H\u00F8jbjerg") === "HOJBJERG");
t("the sharp S changes the letter count and is expanded",
  normalise("Wei\u00DF") === "WEISS");
/* Forgiving is not fuzzy. A near miss is still wrong, because a game that
   accepts one cannot tell the player they were close. */
t("a near miss is still wrong", normalise("ODEGARD") !== normalise("ODEGAARD"));

console.log("\n=== Marking a slot ===");
const slot = { name: "COLE", aliases: ["ANDY COLE", "ANDREW COLE"] };
t("the authored name solves it", matchesSlot("cole", slot));
t("an alias solves it", matchesSlot("Andy Cole", slot));
t("a second alias solves it", matchesSlot("ANDREW COLE", slot));
t("something else does not", !matchesSlot("Joe Cole", slot));
t("an empty guess does not", !matchesSlot("   ", slot));

console.log("\n=== Letters and enumeration ===");
t("the bag is order-free", letterBag("STAM") === letterBag("MAST"));
t("and it notices a missing letter", letterBag("STAM") !== letterBag("STAMP"));
t("the enumeration counts words", JSON.stringify(enumerationOf("JACK CHARLTON")) === "[4,8]");
/* Counted with normalise applied per word, so punctuation does not inflate the
   number the player is shown and then fails to match the letters they see. */
t("and does not count an apostrophe",
  JSON.stringify(enumerationOf("O'SHEA")) === "[5]");
/* A HYPHEN IS A WORD BREAK. OXLADE-CHAMBERLAIN was counted as one word of
   seventeen and drawn as one run of letters; it is two words, and the tile
   keeps the hyphen between them. */
t("a hyphen is a word break: OXLADE-CHAMBERLAIN counts (6,11)",
  JSON.stringify(enumerationOf("OXLADE-CHAMBERLAIN")) === "[6,11]");
t("and the splitter keeps which separator stood between the words",
  JSON.stringify(wordsOf("ALEX OXLADE-CHAMBERLAIN")) ===
  JSON.stringify({ words: ["ALEX", "OXLADE", "CHAMBERLAIN"], seps: [" ", "-"] }) &&
  JSON.stringify(wordsOf("VAN DIJK").seps) === JSON.stringify([" "]) &&
  JSON.stringify(wordsOf("GIGGS").seps) === "[]");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
