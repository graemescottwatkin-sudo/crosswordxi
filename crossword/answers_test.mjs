/* The answers pages.
 *
 * The one thing these must never do is leak a sealed board. Everything else —
 * titles, links, cache headers — matters for search; the refusal matters for
 * the game. So the refusal cases are tested with the same sample board the
 * available case uses, and the assertion is that NOT ONE WORD of it appears.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { onRequestGet as answersPage } from "../functions/crossword/answers/[no].js";
import { onRequestGet as answersIndex } from "../functions/crossword/answers/index.js";
import { dailyNumber, answersAvailable, ANSWERS_AFTER_DAYS } from "../functions/_lib/daily.js";
import { getDailyPuzzle } from "../functions/_lib/db.js";

const DIR = path.dirname(fileURLToPath(import.meta.url));
let pass = 0, fail = 0;
const t = (n, ok, d) => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  — " + d : ""}`); };

/* No D1 here, so the functions fall back the same way daily.js does — through
   getDailyPuzzle's sample path. What matters is that the SAME board comes back
   for the released and refused cases, so the leak assertion is real. */
const env = {};
const today = dailyNumber();
const released = 1;                          // oldest board
const sealed = today;                        // today's board
const page = async (no) => {
  const res = await answersPage({ params: { no: String(no) }, env });
  return { res, body: await res.text() };
};

console.log("The rule itself");
/* The old form here was `ANSWERS_AFTER_DAYS === 7` — a tripwire on the
   constant itself, which guards the value rather than the copies of it. The
   copies are what drift: howto_test now derives the FAQ's word form from the
   constant, and this asserts the constant is a positive whole number of days
   rather than pinning which number it is. Changing the window is allowed;
   changing it in one place and not the other is what must fail. */
t("one constant, exported and used",
  Number.isInteger(ANSWERS_AFTER_DAYS) && ANSWERS_AFTER_DAYS >= 1,
  `ANSWERS_AFTER_DAYS = ${ANSWERS_AFTER_DAYS}`);
t("a board inside the window is not available", !answersAvailable(today, today));
t("nor the boundary day itself", !answersAvailable(today - ANSWERS_AFTER_DAYS, today),
  "older than seven days means eight or more");
t("a board past the window is", answersAvailable(1, ANSWERS_AFTER_DAYS + 2),
  "checked against a synthetic later day — nothing has aged out of the real calendar yet");

/* The functions read the shared rule from source, not a private copy. */
{
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  for (const f of ["functions/crossword/answers/[no].js", "functions/crossword/answers/index.js"]) {
    const src = strip(fs.readFileSync(path.join(DIR, "..", f), "utf8"));
    t(`${path.basename(f)} imports the shared rule`,
      /answersAvailable/.test(src) && /ANSWERS_AFTER_DAYS/.test(src) &&
      !/=\s*7\b/.test(src),
      "no private copy of the seven");
  }
}

console.log("\nA sealed board leaks nothing");
if (today - released > ANSWERS_AFTER_DAYS) {
  console.log("  (today is #" + today + "; using a synthetic today for the sealed case)");
}
{
  const { res, body } = await page(sealed);
  t("today's board is refused", res.status === 404, `HTTP ${res.status}`);
  t("the refusal is never cached", /no-store/.test(res.headers.get("Cache-Control") || ""),
    "a cached refusal would outlive the release date");
  t("it is kept out of the index", /noindex/.test(body),
    "Google must not index a page that will later change meaning");
  /* The leak check: fetch the board through the SAME helper the page uses
     and assert none of its answers or clue text appears in the refusal. */
  const stored = await getDailyPuzzle(env, sealed);
  const words = (stored.puzzle.entries || [])
    .flatMap((e) => [e.row && e.row.answer, e.row && e.row.clue]).filter(Boolean);
  const leaked = words.filter((w) => body.toUpperCase().includes(String(w).toUpperCase()));
  t("not one answer or clue from the board appears", leaked.length === 0,
    leaked.length ? "LEAKED: " + leaked[0] : words.length + " strings checked");
}

console.log("\nA released board is a real page");
{
  /* Nothing has aged out of the real calendar yet, and shipping the render
     branch untested because the calendar is young would be a test that
     passes vacuously — the exact fault class this week kept finding. The
     server clock is Date.now(), so the test runs the page ten days in the
     future and the real branch executes. Restored in finally: a leaked
     clock stub would corrupt every case after this block. */
  const realNow = Date.now;
  let res, body;
  try {
    const shifted = realNow() + 10 * 86400000;
    Date.now = () => shifted;
    ({ res, body } = await page(released));
  } finally {
    Date.now = realNow;
  }
  t("it is served, ten days on", res.status === 200, `HTTP ${res.status}`);
  t("it is cacheable — a published answer never changes",
    /max-age/.test(res.headers.get("Cache-Control") || ""));
  t("it carries the answers", /class="ans"/.test(body) && /NORWICH/i.test(body),
    "the sample board's own words are on the page");
  t("each answer folds behind a reveal", /<details><summary>Show answer/.test(body),
    "the page is a hints page first — clue 7 can be revealed without spoiling clue 8");
  t("with a show-all for the searcher who came for the lot",
    /Show all answers/.test(body));
  t("while every clue stays visible — that is the searchable text",
    !/<details>[^<]*<p class="clue"/.test(body));
  t("and a canonical of its own", body.includes(`/crossword/answers/${released}"`));
  t("and is indexable", !/noindex/.test(body));
  t("and links to today's board — the whole point",
    /href="\/crossword\/"/.test(body));
}

console.log("\nThe index");
{
  const res = await answersIndex({ env });
  const body = await res.text();
  t("the index is served", res.status === 200);
  t("it is indexable", !/noindex/.test(body));
  const links = (body.match(/\/crossword\/answers\/\d+/g) || [])
    .map((u) => parseInt(u.split("/").pop(), 10));
  t("it links only released boards",
    links.every((n) => answersAvailable(n, today)),
    links.length ? `${links.length} links, newest #${Math.max(...links)}` : "none yet — the empty state explains itself");
  if (!links.length) {
    t("the empty state points at today's board", /href="\/crossword\/"/.test(body));
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
