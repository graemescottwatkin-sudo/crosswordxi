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
  from "../../functions/_lib/sources.js";
import { publicPuzzle } from "../../functions/_lib/puzzle.js";
import { onRequestPost as verify } from "../../functions/api/verify.js";

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
  const { SAMPLE_PUZZLES } = await import("../../functions/_lib/sample-puzzles.js");
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
  /* THE VERDICT SAYS A CITATION EXISTS AND NOT WHAT IT IS. The link moved
     behind an account on 4 Sep — sharing sources is fine, one account taking
     the lot is not — so what rides with a yes is `{ locked: true }`, which is
     what lets the page draw a register button on the rows that have one and
     stay silent on the rows that do not. */
  t("a solved entry is told a citation exists",
    right.status === 200 && right.body.correct === true &&
    right.body.source && right.body.source.locked === true,
    JSON.stringify(right.body.source));
  t("and the verdict carries neither the link nor the publisher",
    !JSON.stringify(right.body).includes("wikipedia") &&
    !JSON.stringify(right.body).includes("Wikipedia"),
    JSON.stringify(right.body));
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

/* ---- THE PRESS: an account, a ceiling, and a count ----------------------
 *
 * "i dont mind sharing sources but i dont want it mass requested by a single
 * user." So the link is asked for at /api/source, by an account, fifty a day.
 *
 * The check that matters most is not the cap. It is that /api/source asks for
 * the ANSWER again: one live row in seventeen has its answer inside its own
 * URL, so an endpoint handing a citation over for an entry NUMBER would be a
 * way to read those answers without solving anything — a worse leak than the
 * one the allowlist exists to prevent, opened by the feature meant to protect
 * sources. */
console.log("\nAsking for a source");
{
  const { onRequestPost: source } = await import("../../functions/api/source.js");
  const { SOURCE_PRESSES_A_DAY } = await import("../../functions/_lib/sources.js");
  const { SAMPLE_PUZZLES } = await import("../../functions/_lib/sample-puzzles.js");
  const sample = SAMPLE_PUZZLES.practice[0];
  const first = sample.puzzle.entries[0].row;
  const answer = first.grid;
  const before = { source: first.source, sourceName: first.sourceName };
  first.source = ["https://en.wikipedia.org/wiki/Real_Madrid_CF"];
  first.sourceName = "Wikipedia";

  /* A database of one table, following the statement it is given: the count
     has to come back out of the same rows the increment wrote, or a cap that
     never counts would pass every check here. */
  function memDB(user) {
    const rows = new Map();
    return {
      _rows: rows,
      prepare(sql) {
        return { bind: (...a) => ({
          first: async () => {
            if (/FROM sessions/.test(sql)) return user;
            if (/FROM source_press/.test(sql)) return rows.get(a[0] + "|" + a[1]) || null;
            /* The board itself. A practice token resolves out of the sample
               when there is no database at all, and this fake HAS one — so it
               has to answer for the puzzle too, or every check below fails on
               "Unknown puzzle" rather than on what it is testing. */
            if (/FROM puzzles/.test(sql)) return { payload: JSON.stringify(sample) };
            return null;
          },
          run: async () => {
            if (/INSERT INTO source_press/.test(sql)) {
              const k = a[0] + "|" + a[1];
              const cur = rows.get(k);
              /* The real statement increments ON CONFLICT. Modelled off the
                 SQL rather than assumed, so a statement that stopped
                 incrementing would show up here. */
              if (!cur) rows.set(k, { user_id: a[0], day: a[1], presses: 1 });
              else if (/DO UPDATE SET presses = presses \+ 1/.test(sql)) cur.presses += 1;
            }
            return {};
          },
          all: async () => ({ results: [] }),
        }) };
      },
    };
  }
  /* THE SESSION IS A COOKIE, and currentUser reads it before it reads the
     database — so a request without one is signed out however the fake would
     have answered. Sent here, and the signed-out env simply has no session row
     to find. */
  const ask = async (env, guess, hdr) => {
    const req = new Request("https://x/api/source", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: "cxi_session=s1",
        ...(hdr === undefined ? { "X-XI-Games": "1" } : hdr),
      },
      body: JSON.stringify({ token: "practice:" + sample.rowId, entry: 0, guess }),
    });
    const res = await source({ request: req, env });
    return { status: res.status, body: await res.json() };
  };

  const signedIn = { DB: memDB({ id: "u1", is_admin: 0 }) };
  const signedOut = { DB: memDB(null) };

  /* THE LEAK IT MUST NOT OPEN. */
  const guessed = await ask(signedIn, "X".repeat(answer.length));
  t("a wrong answer gets no citation, however signed in you are",
    guessed.status === 200 && guessed.body.correct === false && !guessed.body.source,
    JSON.stringify(guessed.body));
  t("and a wrong answer is not charged a press",
    signedIn.DB._rows.size === 0, signedIn.DB._rows.size + " rows written");

  const out = await ask(signedOut, answer);
  t("signed out is asked to register, and told nothing else",
    out.status === 401 && out.body.needsAccount === true && !out.body.source &&
    !JSON.stringify(out.body).includes("wikipedia"),
    JSON.stringify(out.body));

  const got = await ask(signedIn, answer);
  t("an account that solved the clue is given the link",
    got.status === 200 && got.body.source && got.body.source.url.includes("wikipedia.org") &&
    got.body.source.name === "Wikipedia", JSON.stringify(got.body.source));
  t("and the press is counted", got.body.used === 1 &&
    [...signedIn.DB._rows.values()][0].presses === 1, JSON.stringify(got.body.used));

  t("no CSRF header is refused", (await ask(signedIn, answer, {})).status === 403);

  /* THE CEILING. Pressed to the limit and once past it. */
  const capEnv = { DB: memDB({ id: "u2", is_admin: 0 }) };
  let last;
  for (let i = 0; i < SOURCE_PRESSES_A_DAY; i++) last = await ask(capEnv, answer);
  t(`${SOURCE_PRESSES_A_DAY} presses are allowed, and the last one still works`,
    last.status === 200 && !!last.body.source && last.body.used === SOURCE_PRESSES_A_DAY,
    "used " + last.body.used);
  const over = await ask(capEnv, answer);
  t("the next one is refused, and carries no link",
    over.status === 429 && over.body.capped === true && !over.body.source &&
    !JSON.stringify(over.body).includes("wikipedia"),
    JSON.stringify(over.body));
  t("and the refusal names the ceiling so the player knows what happened",
    String(over.body.error || "").includes(String(SOURCE_PRESSES_A_DAY)), over.body.error);
  /* Read defensively so a missing row reports as a failed check rather than
     throwing: a suite that crashes here hides every check after it, and one
     sabotage found exactly that. */
  const capRow = [...capEnv.DB._rows.values()][0];
  t("a refused press is not counted either",
    !!capRow && capRow.presses === SOURCE_PRESSES_A_DAY,
    capRow ? capRow.presses + " counted" : "nothing counted at all");

  /* A row the allowlist refuses costs nothing: there was never a link. */
  first.source = ["https://news.bet365.com/en/article/x"];
  first.sourceName = "bet365";
  const none = { DB: memDB({ id: "u3", is_admin: 0 }) };
  const gambled = await ask(none, answer);
  t("a row with no showable citation spends no press",
    gambled.status === 200 && gambled.body.source === null && none.DB._rows.size === 0);

  Object.assign(first, before);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
