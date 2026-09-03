/* sources_test.mjs — the citation behind a solved clue.
 *
 * Two properties, and the second is the one that matters.
 *
 * A source must not travel before the clue is solved. Around one live row in
 * seventeen has the answer inside its own URL — the international-caps clues
 * cite per-player pages — so a citation sent with the board would hand those
 * answers over. It is released by /api/verify and /api/check-answer at the
 * moment an entry is confirmed correct, and by nothing else.
 *
 * And a source shown to a player is not the same thing as a source recorded
 * in the bank. The bank cites bookmakers on 224 live rows and a wiki anyone
 * can edit on 132 more. Sound as provenance; not a link to put in front of
 * somebody playing a football puzzle. The rule is an allowlist, so a domain
 * nobody has approved shows nothing rather than shipping by default.
 *
 *   node crossword/sources_test.mjs        (from the repo root)
 */
import { publicSource, showableUrl, SOURCE_HOSTS, SOURCE_REFUSED }
  from "../functions/_lib/sources.js";
import { publicPuzzle } from "../functions/_lib/puzzle.js";
import { onRequestPost as verify } from "../functions/api/verify.js";

let pass = 0, fail = 0;
function t(name, ok, note) {
  if (ok) { pass++; console.log(`  ok  ${name}${note ? "  — " + note : ""}`); }
  else { fail++; console.log(`FAIL  ${name}${note ? "  — " + note : ""}`); }
}

const row = (over) => Object.assign({
  id: 1, clue: "Won the FA Cup in 2024", grid: "MANCHESTERUNITED", enum: "(10,6)",
  cat: "FA Cup", era: "Modern", diff: "Medium",
  source: ["https://en.wikipedia.org/wiki/2024_FA_Cup_final"],
  sourceName: "Wikipedia",
  prov: "VERIFIED FIRST-HAND",
}, over || {});

console.log("Which citations a player may be shown");
t("a reference source is shown, with the publisher as its label", (() => {
  const s = publicSource(row());
  return !!s && s.name === "Wikipedia" && s.url.includes("wikipedia.org");
})());
t("a subdomain of an allowed host counts", showableUrl("https://en.wikipedia.org/wiki/X") &&
  showableUrl("https://global.espn.com/soccer/story"));
/* A bookmaker is the case this rule exists for. */
t("a bookmaker is not shown", publicSource(row({
  source: ["https://news.bet365.com/en/article/x"], sourceName: "bet365" })) === null);
t("nor a second bookmaker", publicSource(row({
  source: ["https://news.paddypower.com/x"], sourceName: "Paddy Power" })) === null);
/* A wiki anyone can edit is a weak thing to cite publicly, whatever else it is. */
t("nor a wiki anyone can edit", publicSource(row({
  source: ["https://football.fandom.com/wiki/X"], sourceName: "Football Wiki" })) === null);
t("and every refusal is written down with its reason",
  Object.keys(SOURCE_REFUSED).length >= 3 &&
  Object.values(SOURCE_REFUSED).every((why) => typeof why === "string" && why.length > 10));

/* A ROW IS SHOWN ONLY IF ALL OF IT IS SHOWABLE. A row citing Wikipedia and a
   bookmaker rests partly on the bookmaker, and linking the acceptable half
   presents a better provenance than the row actually has. */
t("a row that cites an allowed source AND a refused one is not shown", publicSource(row({
  source: ["https://en.wikipedia.org/wiki/X", "https://news.bet365.com/y"],
  sourceName: "Wikipedia / bet365" })) === null);
t("but a row citing two allowed sources is, linking the first", (() => {
  const s = publicSource(row({
    source: ["https://www.rsssf.org/x.html", "https://en.wikipedia.org/wiki/Y"],
    sourceName: "RSSSF + Wikipedia" }));
  return !!s && s.url.includes("rsssf.org") && s.name === "RSSSF + Wikipedia";
})());

console.log("\nA domain nobody approved shows nothing, rather than shipping");
t("an unknown domain is refused by default",
  publicSource(row({ source: ["https://some-new-site.example/x"], sourceName: "Somewhere" })) === null);
/* The allowlist is matched on the host, so a lookalike cannot borrow it. */
t("and a lookalike cannot borrow an allowed name",
  !showableUrl("https://notwikipedia.org/x") &&
  !showableUrl("https://wikipedia.org.example.com/x") &&
  !showableUrl("https://evilwikipedia.org/x"));
t("a row with no source at all is simply not shown",
  publicSource(row({ source: [], sourceName: "" })) === null &&
  publicSource(row({ source: undefined })) === null &&
  publicSource(null) === null);
t("a source with no publisher label is not shown either",
  publicSource(row({ sourceName: "" })) === null);
t("the allowlist is a list of hosts, not of URLs",
  SOURCE_HOSTS.every((h) => !h.includes("/") && !h.includes(":")));

console.log("\nA citation never travels before the clue is solved");
/* The board a browser is given is rebuilt from a whitelist. Whatever the bank
   row holds, none of it may reach the page this way. */
{
  const puzzle = {
    width: 3, height: 1,
    cells: { "0,0": { ch: "A", across: 0, down: null, num: 1 } },
    entries: [{ num: 1, dir: "across", x: 0, y: 0, len: 3, cells: [{ x: 0, y: 0 }], row: row() }],
    stats: {},
  };
  const wire = JSON.stringify(publicPuzzle(puzzle));
  t("the board carries no source, no publisher and no provenance",
    !wire.includes("wikipedia") && !wire.includes("sourceName") && !wire.includes("prov"));
  t("and no answer, which is the same rule", !wire.includes("MANCHESTERUNITED"));
}

/* THE RELEASE POINT ITSELF, called for real.

   With no database bound, a practice token resolves to the sample board that
   ships in the repo, so /api/verify can be exercised end to end. The sample's
   row is given a citation for the duration — the same three fields the bank
   writes — which is what makes this a test of the endpoint rather than of
   publicSource a second time. */
{
  const { SAMPLE_PUZZLES } = await import("../functions/_lib/sample-puzzles.js");
  const sample = SAMPLE_PUZZLES.practice[0];
  const first = sample.puzzle.entries[0].row;
  const answer = first.grid;
  const before = { source: first.source, sourceName: first.sourceName, prov: first.prov };

  const ask = async (guess) => {
    const req = new Request("https://x/api/verify", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: "practice:" + sample.rowId, entry: 0, guess }),
    });
    const res = await verify({ request: req, env: {} });
    return { status: res.status, body: await res.json() };
  };

  first.source = ["https://en.wikipedia.org/wiki/Real_Madrid_CF"];
  first.sourceName = "Wikipedia";
  first.prov = "VERIFIED FIRST-HAND";

  const right = await ask(answer);
  t("a solved entry comes back with its citation",
    right.status === 200 && right.body.correct === true &&
    right.body.source && right.body.source.name === "Wikipedia" &&
    right.body.source.url.includes("wikipedia.org"),
    JSON.stringify(right.body.source));
  /* The editorial provenance is not a player's business and does not travel. */
  t("and without the provenance note", !JSON.stringify(right.body).includes("VERIFIED"));

  const wrong = await ask("CHELSEAXXXX".slice(0, answer.length));
  t("a wrong guess is told so, and carries no citation",
    wrong.body.correct === false && !wrong.body.source, JSON.stringify(wrong.body));

  /* The rule is enforced at the release point, not merely in the helper: a
     bookmaker citation on a correctly solved entry still sends nothing. */
  first.source = ["https://news.bet365.com/en/article/x"];
  first.sourceName = "bet365";
  const gambled = await ask(answer);
  t("a bookmaker citation is withheld even from a solved entry",
    gambled.body.correct === true && gambled.body.source === null,
    JSON.stringify(gambled.body));

  Object.assign(first, before);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
