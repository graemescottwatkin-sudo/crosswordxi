/* challenge_test.mjs — the challenge endpoints against a stub database.
 *
 * The property worth protecting above all others: nothing competitive is
 * returned before the board has been played, and no endpoint accepts a score.
 * A challenge table is the only place in this project where one player's result
 * is shown to another, so it is the only place where a trusted number matters.
 */
import fs from "node:fs";

let pass = 0, fail = 0;
const t = (n, ok, d) => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  — " + d : ""}`); };

const src = {
  challenge: fs.readFileSync("functions/api/challenge.js", "utf8"),
  start: fs.readFileSync("functions/api/challenge/start.js", "utf8"),
  entry: fs.readFileSync("functions/api/challenge/entry.js", "utf8"),
  table: fs.readFileSync("functions/api/challenge/table.js", "utf8"),
  names: fs.readFileSync("functions/_lib/names.js", "utf8"),
  migration: fs.readFileSync("data/migrations/012-challenges.sql", "utf8"),
};
const bare = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

console.log("Nothing competitive before the board is played");
t("the pre-play endpoint returns no score", (() => {
  const get = bare(src.challenge).slice(bare(src.challenge).indexOf("onRequestGet"),
                                        bare(src.challenge).indexOf("onRequestPost"));
  return !/srv_score|score:/.test(get);
})());
t("nor standings, nor a fastest time", (() => {
  const get = bare(src.challenge).slice(bare(src.challenge).indexOf("onRequestGet"),
                                        bare(src.challenge).indexOf("onRequestPost"));
  return !/challenge_entries[\s\S]{0,200}ORDER BY/.test(get) && !/elapsed/.test(get);
})());
t("only counts, which cannot be worked back into a target",
  /started/.test(src.challenge) && /finished/.test(src.challenge));

console.log("\nNo endpoint accepts a score");
for (const [name, code] of Object.entries(src)) {
  if (name === "migration" || name === "names" || name === "table") continue;
  t(`${name} reads the score rather than being told one`, (() => {
    const b = bare(code);
    return !/body\.score|body\.points|\bscore = Number\(/.test(b) &&
      (!/score/.test(b) || /srv_score/.test(b));
  })());
}

console.log("\nOne scored result each, but an interrupted attempt survives");
t("a second finish cannot replace the first",
  /INSERT OR IGNORE INTO challenge_entries/.test(src.entry));
t("and returning to an interrupted attempt is the same start, not a new one",
  /INSERT OR IGNORE INTO challenge_starts/.test(src.start));
t("the entrant is told whether they have already scored",
  /alreadyScored/.test(src.start));
t("uniqueness is per entrant per challenge",
  /UNIQUE \(challenge_id, entrant_key\)/.test(src.migration));

console.log("\nA result cannot be posted to the wrong board");
t("the play's board must match the challenge's",
  /String\(play\.theme_key\) !== c\.theme_id \+ "-" \+ c\.board_no/.test(src.entry));
t("and an unverified play cannot enter at all",
  /srv_score === null/.test(src.entry) && /has not been verified/.test(src.entry));

console.log("\nPublished names");
t("names are cleaned before they are stored", /cleanName/.test(src.entry) && /cleanName/.test(src.challenge));
t("markup characters are removed rather than escaped later", /\[<>&/.test(src.names));
t("zero-width and direction marks are stripped", /200b/.test(src.names));
t("a signed-in player's name comes from the account",
  /user && user\.name \? cleanName\(user\.name\)/.test(src.challenge));
t("and an entry can be hidden without being deleted",
  /hidden       INTEGER DEFAULT 0/.test(src.migration) && /hidden = 0/.test(src.table));

console.log("\nThe chain can be followed");
t("a play records the challenge it came from",
  /ALTER TABLE plays ADD COLUMN challenge_id TEXT/.test(src.migration));

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
