/* verified_test.mjs — the score Wordsearch XI's server computes, and the two
 * leaks that had to close before it could compute anything.
 *
 * This game could not have a verified score. The board travelled whole — grid,
 * every answer, every answer's exact placement, and the secret bonus word — so
 * the page judged its own drags and the score it reported was a number the
 * browser chose. Withholding the placements was not enough on its own either:
 * /api/wordsearch/puzzle?id=<today's id> handed the same board back complete,
 * to anyone, because released() passes a board first scheduled today.
 *
 * So the checks here are in three groups, and the first two are the ones that
 * would still matter if the scoring were abandoned tomorrow:
 *
 *   what the browser is given          the grid and the words, nothing more
 *   what the other routes will not give today's board, by any door
 *   what the score is made of          rows this server wrote, and cheating it
 *
 *   node football/wordsearch/verified_test.mjs        (from the repo root)
 */
import { publicPuzzle, foundAnswer } from "../../functions/_lib/ws-public.js";
import {
  XIWS_SCORING, judge, selectionCells, placementCells,
  startRound, recordFind, recordFoul, foundWords, verifiedScore,
} from "../../functions/_lib/ws-round.js";
import { dailyBoard, isTodaysDaily, catalog } from "../../functions/_lib/wsdata.js";
import { onRequestPost as findPost } from "../../functions/api/wordsearch/find.js";
import { onRequestPost as roundPost } from "../../functions/api/wordsearch/round.js";
import { onRequestPost as finishPost } from "../../functions/api/wordsearch/finish.js";
import { onRequestGet as dailyGet } from "../../functions/api/wordsearch/daily.js";
import { onRequestGet as puzzleGet } from "../../functions/api/wordsearch/puzzle.js";

let pass = 0, fail = 0;
function t(name, ok, note) {
  if (ok) { pass++; console.log(`  ok  ${name}${note ? "  — " + note : ""}`); }
  else { fail++; console.log(`FAIL  ${name}${note ? "  — " + note : ""}`); }
}

const { puzzle: BOARD, day: DAY } = await dailyBoard({});
const ANS = BOARD.answers;
const cellsOf = (item) => {
  const p = item.placement;
  return { from: [p.start_row, p.start_col], to: [p.end_row, p.end_col] };
};

console.log("What the browser is given");
{
  const pub = publicPuzzle(BOARD);
  const wire = JSON.stringify(pub);
  t("the grid travels, because the grid IS the puzzle",
    Array.isArray(pub.grid) && pub.grid.length > 0);
  t("and the word list travels, because a word search shows its words",
    pub.answers.length === ANS.length && pub.answers.every((a) => a.display && a.grid));
  /* THE WHOLE POINT. */
  t("no answer carries where it is",
    pub.answers.every((a) => a.placement === undefined) && !wire.includes("placement"),
    "the solving is knowing where; sending it is sending the answer");
  t("and no start or end square rides along under another name",
    !wire.includes("start_row") && !wire.includes("end_row") && !wire.includes("direction"));
  /* THE SECRET IS A CLUE. */
  /* THE WORD IS IN THE GRID — that is what a word search IS, and searching
     the whole payload for it always finds it. The first version of this check
     did exactly that and failed forever for the right reason badly stated.
     What must not travel is the bonus as a FIELD: the answer named, rather
     than hidden among fourteen rows of letters like every other word. */
  const withoutGrid = JSON.stringify({ ...pub, grid: undefined });
  t("the bonus travels as its clue, and not as its word",
    pub.bonus.has === true && !!pub.bonus.clue &&
    pub.bonus.display === undefined && pub.bonus.grid === undefined &&
    !withoutGrid.includes(BOARD.bonus.grid),
    `clue kept, "${BOARD.bonus.display}" withheld`);
  t("a board with no bonus says so rather than inventing one",
    publicPuzzle({ ...BOARD, bonus: null }).bonus === null);
  t("and nothing is served for no board at all", publicPuzzle(null) === null);
}

console.log("\nAnd the endpoint serves that, not the board");
{
  const res = await dailyGet({ env: {} });
  const sent = await res.json();
  /* The grid is set aside for the same reason as above: every word is in it,
     which is the puzzle rather than a leak. */
  const wire = JSON.stringify({ ...sent, puzzle: { ...sent.puzzle, grid: undefined } });
  t("/api/wordsearch/daily sends no placement and no secret",
    !wire.includes("placement") && !wire.includes("start_row") &&
    !wire.includes(BOARD.bonus.grid) && !wire.includes(BOARD.bonus.display),
    "this endpoint sent all of it, to every player, before a word was found");
  t("and the grid it does send is the whole grid, unaltered",
    JSON.stringify(sent.puzzle.grid) === JSON.stringify(BOARD.grid),
    "hiding letters would be a different game, not a safer one");
}

console.log("\nWhat the other doors will not give");
{
  /* The leak that made withholding pointless: the same board, whole, from the
     free-play route, because a board first scheduled TODAY counts as released
     and the archive gate saw it as zero days old. */
  t("today's board is today's daily, and the server can say so",
    await isTodaysDaily({}, BOARD.id) === true, BOARD.id);
  t("and yesterday's board is not",
    await isTodaysDaily({}, "XIWS-0001") === false);
  const list = await catalog({});
  t("free play does not list the board in flight",
    !list.some((p) => p.id === BOARD.id),
    `${list.length} boards listed, none of them today's`);
}

console.log("\nThe judging, which the page used to do for itself");
{
  const a = ANS[0], sel = cellsOf(a);
  const hit = judge(BOARD, sel.from, sel.to, []);
  t("a selection on a word finds that word", !!hit && hit.item.grid === a.grid, a.display);
  t("and it is not the bonus", hit.bonus === false);
  const b = cellsOf(BOARD.bonus);
  const bh = judge(BOARD, b.from, b.to, []);
  t("a selection on the secret finds the secret, and says so",
    !!bh && bh.bonus === true && bh.item.grid === BOARD.bonus.grid);
  t("a selection on nothing finds nothing",
    judge(BOARD, [0, 0], [0, 1], []) === null);
  /* A word already found is out of play: otherwise one word is eleven finds. */
  t("a word already found is not found again",
    judge(BOARD, sel.from, sel.to, [a.grid]) === null);
  /* The line has to be a line. */
  t("a bent selection is not a selection", selectionCells([0, 0], [2, 5]).length === 0);
  t("a single square is a line of one", selectionCells([3, 3], [3, 3]).length === 1);
  t("and a diagonal is counted square by square",
    selectionCells([0, 0], [3, 3]).join(" ") === "0,0 1,1 2,2 3,3");
  t("a placement covers exactly its word's length",
    placementCells(a.placement, a.grid.length).length === a.grid.length);
}

console.log("\nThe foul rule, which is the page's own file");
{
  t("the Worker imports the page's scoring, so there is one statement of it",
    XIWS_SCORING.MAX_SCORE === 114 && typeof XIWS_SCORING.computeScore === "function");
  /* +1, +2, +3, then +4 for every one after, capped at fifteen. */
  t("consecutive fouls escalate 1, 2, 3, then 4",
    XIWS_SCORING.penaltyFor([1000]) === 1 &&
    XIWS_SCORING.penaltyFor([1000, 2000]) === 3 &&
    XIWS_SCORING.penaltyFor([1000, 2000, 3000]) === 6 &&
    XIWS_SCORING.penaltyFor([1000, 2000, 3000, 4000]) === 10);
  t("and are capped at fifteen minutes for the board",
    XIWS_SCORING.penaltyFor([1, 2, 3, 4, 5, 6, 7, 8].map((n) => n * 1000)) === 15,
    "1+2+3+4+4+4+4+4 would be 26");
  /* SEVEN QUIET SECONDS AND THE RUN IS OVER. This is why the rows carry times
     rather than a counter: a total cannot say which fouls were consecutive. */
  t("seven quiet seconds resets the run, so two apart cost one each",
    XIWS_SCORING.penaltyFor([1000, 9500]) === 2,
    "consecutively they would cost three");
  t("and the reset is on the GAP, not on the count",
    XIWS_SCORING.penaltyFor([1000, 2000, 20000, 21000]) === 6,
    "two runs of two: (1+2) + (1+2)");
}

/* A DATABASE OF THREE TABLES, IN MEMORY, THAT FOLLOWS THE STATEMENT IT IS
   GIVEN. HiLo's first draft of this modelled "first find wins" in its own code,
   so changing the real SQL to DO UPDATE left the suite green — a fake that is
   right while the code is wrong is worse than no fake. */
function memDB() {
  const rounds = new Map(), finds = new Map(), fouls = new Map(), plays = new Map();
  const run = (sql, a) => {
    if (/INSERT INTO ws_round/.test(sql)) {
      rounds.set(a[0], { puzzle_id: a[1], day: a[2], started_ms: a[3] });
    } else if (/INSERT INTO ws_find/.test(sql)) {
      const k = a[0] + "|" + a[1];
      const row = { play_id: a[0], word: a[1], is_bonus: a[2], at_ms: a[3] };
      if (!finds.has(k)) finds.set(k, row);
      else if (/DO UPDATE/i.test(sql)) finds.set(k, row);
    } else if (/INSERT INTO ws_foul/.test(sql)) {
      const k = a[0] + "|" + a[1];
      if (!fouls.has(k)) fouls.set(k, { play_id: a[0], idx: a[1], at_ms: a[2] });
    } else if (/UPDATE plays/.test(sql)) {
      plays.set(a[2], { srv_score: a[0], srv_elapsed_secs: a[1] });
    }
    return {};
  };
  return {
    _rounds: rounds, _finds: finds, _fouls: fouls, _plays: plays,
    prepare(sql) {
      return { bind: (...a) => ({
        first: async () => {
          if (/FROM ws_round/.test(sql)) return rounds.get(a[0]) || null;
          if (/MAX\(idx\)/.test(sql)) {
            const mine = [...fouls.values()].filter((f) => f.play_id === a[0]);
            return { n: mine.length ? Math.max(...mine.map((f) => f.idx)) : 0 };
          }
          /* THE BOARD ITSELF, in the shape the loader parses. Both the round
             endpoint and the score look it up — one through the schedule, one
             by id — and a fake that answers neither makes every check below
             fail for want of a board rather than for the reason it names. */
          if (/FROM ws_schedule s JOIN ws_puzzles/.test(sql) || /FROM ws_puzzles/.test(sql)) {
            return {
              id: BOARD.id, theme: BOARD.theme, category: BOARD.category,
              status: BOARD.status, hash: BOARD.hash, version: BOARD.version,
              share_key: BOARD.share_key,
              payload: JSON.stringify({
                grid: BOARD.grid, answers: BOARD.answers, bonus: BOARD.bonus,
              }),
            };
          }
          return null;
        },
        all: async () => {
          if (/FROM ws_find/.test(sql)) {
            return { results: [...finds.values()].filter((f) => f.play_id === a[0]) };
          }
          if (/FROM ws_foul/.test(sql)) {
            return { results: [...fouls.values()].filter((f) => f.play_id === a[0])
              .sort((x, y) => x.idx - y.idx) };
          }
          return { results: [] };
        },
        run: async () => run(sql, a),
      }) };
    },
  };
}

const post = (fn, env, body) => fn({
  request: new Request("https://x/", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-XI-Games": "1" },
    body: JSON.stringify(body),
  }), env,
});
const read = async (res) => ({ status: res.status, body: await res.json() });

console.log("");
console.log("A round, played through the real endpoints");
{
  const env = { DB: memDB() };
  const play = "ws-clean-01";
  const r = await read(await post(roundPost, env, { playId: play }));
  t("the round endpoint starts a clock", r.status === 200 && r.body.verified === true);
  const first = env.DB._rounds.get(play);
  await post(roundPost, env, { playId: play });
  const second = env.DB._rounds.get(play);
  t("and kicking off twice keeps the first one",
    !!first && !!second && first.started_ms === second.started_ms,
    first ? "one clock" : "no round was ever started");

  /* Every word, through the endpoint that judges. */
  let allFound = true;
  for (const a of ANS) {
    const sel = cellsOf(a);
    const res = await read(await post(findPost, env, { playId: play, ...sel }));
    if (!res.body.hit) { allFound = false; t(`finding ${a.display}`, false, JSON.stringify(res.body)); break; }
  }
  t("eleven selections found eleven words",
    allFound && [...env.DB._finds.values()].filter((f) => !f.is_bonus).length === ANS.length,
    [...env.DB._finds.values()].length + " rows");

  /* THE FOUND WORD COMES BACK WITH ITS PLACEMENT, because the player has just
     earned it and the page has to draw the line through it. */
  const fresh = { DB: memDB() };
  await post(roundPost, fresh, { playId: "ws-fresh-1" });
  const one = await read(await post(findPost, fresh,
    { playId: "ws-fresh-1", ...cellsOf(ANS[0]) }));
  t("a found word is told where it is, so the page can strike it through",
    !!one.body.hit && !!one.body.hit.placement && one.body.hit.display === ANS[0].display,
    one.body.hit ? one.body.hit.display : JSON.stringify(one.body));

  /* A MISS IS A FOUL AND IS WRITTEN DOWN — and says nothing else. */
  const miss = await read(await post(findPost, env, { playId: play, from: [0, 0], to: [0, 1] }));
  t("a selection on nothing is a foul, and reveals nothing",
    miss.body.hit === null && miss.body.foul === true &&
    !JSON.stringify(miss.body).includes("placement"),
    "a no is a no; anything more leaks the board a letter at a time");
  t("and the foul is recorded", [...env.DB._fouls.values()].length === 1);
}

console.log("");
console.log("A board finished, and what the score is made of");
{
  const env = { DB: memDB() };
  const play = "ws-done-01";
  await post(roundPost, env, { playId: play });
  const t0 = env.DB._rounds.get(play).started_ms;
  for (const a of ANS) await post(findPost, env, { playId: play, ...cellsOf(a) });

  const fin = await read(await post(finishPost, env, { playId: play }));
  t("eleven words found is a finished board, and it is scored",
    fin.status === 200 && fin.body.verified === true && fin.body.found === ANS.length,
    JSON.stringify({ score: fin.body.score, found: fin.body.found }));
  t("and the score is what the page's own rule says for that clock",
    fin.body.score === XIWS_SCORING.computeScore(
      fin.body.elapsedSecs, fin.body.penaltyMinutes, fin.body.bonusFound).score,
    fin.body.score + " / 114");
  t("the secret was not found, so no ten points for it",
    fin.body.bonusFound === false && fin.body.bonus === 0);
  t("and it is written against the attempt",
    !!env.DB._plays.get(play) && env.DB._plays.get(play).srv_score === fin.body.score,
    env.DB._plays.get(play) ? "plays.srv_score = " + env.DB._plays.get(play).srv_score : "nothing written");

  /* THE POINT OF ALL OF IT. Claimed against a round whose real score is not
     the one being sent, so this fails the moment a claim is ever read. */
  const cheat = await read(await post(finishPost, env,
    { playId: play, score: 114, elapsedSecs: 1, penaltyMinutes: 0, bonusFound: true }));
  t("a score sent with it is ignored",
    cheat.body.score === fin.body.score && cheat.body.score !== 114,
    "claimed 114, answered " + cheat.body.score);

  /* THE SECRET IS WORTH TEN, and only when the server matched it. */
  const withBonus = { DB: memDB() };
  await post(roundPost, withBonus, { playId: "ws-bonus-1" });
  for (const a of ANS) await post(findPost, withBonus, { playId: "ws-bonus-1", ...cellsOf(a) });
  await post(findPost, withBonus, { playId: "ws-bonus-1", ...cellsOf(BOARD.bonus) });
  const bf = await read(await post(finishPost, withBonus, { playId: "ws-bonus-1" }));
  t("finding the secret is worth ten, and the server saw it found",
    bf.body.verified === true && bf.body.bonusFound === true && bf.body.bonus === 10,
    bf.body.score + " with the secret");
  t("and the bonus does not count towards the eleven",
    bf.body.found === ANS.length, bf.body.found + " words plus the secret");

  /* FOULS PUSH THE CLOCK, which is the rule the page keeps and the reason the
     rows carry times rather than a count. */
  const fouled = { DB: memDB() };
  await post(roundPost, fouled, { playId: "ws-foul-1" });
  for (let i = 0; i < 3; i++) {
    await post(findPost, fouled, { playId: "ws-foul-1", from: [0, 0], to: [0, 1] });
  }
  for (const a of ANS) await post(findPost, fouled, { playId: "ws-foul-1", ...cellsOf(a) });
  const ff = await read(await post(finishPost, fouled, { playId: "ws-foul-1" }));
  t("three fouls in a burst cost six minutes, not three",
    ff.body.fouls === 3 && ff.body.penaltyMinutes === 6, ff.body.penaltyMinutes + "'");
  t("and a fouled board scores lower than a clean one at the same clock",
    XIWS_SCORING.computeScore(ff.body.elapsedSecs, 6, false).score <
    XIWS_SCORING.computeScore(ff.body.elapsedSecs, 0, false).score);
}

console.log("");
console.log("What it refuses");
{
  const env = { DB: memDB() };
  const play = "ws-part-01";
  await post(roundPost, env, { playId: play });
  for (const a of ANS.slice(0, 7)) await post(findPost, env, { playId: play, ...cellsOf(a) });
  const early = await read(await post(finishPost, env, { playId: play }));
  t("seven of eleven is not a finished board",
    early.body.verified === false && early.body.score === undefined,
    JSON.stringify(early.body));

  /* THE SAME WORD TWICE is one find: a retry after a dropped connection is not
     a second word, and eleven distinct words is what finishes a board. */
  const dupe = { DB: memDB() };
  await post(roundPost, dupe, { playId: "ws-dupe-1" });
  for (let i = 0; i < 11; i++) {
    await post(findPost, dupe, { playId: "ws-dupe-1", ...cellsOf(ANS[0]) });
  }
  t("one word found eleven times is still one word",
    [...dupe.DB._finds.values()].length === 1,
    [...dupe.DB._finds.values()].length + " row recorded");
  t("and that board is not finished",
    (await read(await post(finishPost, dupe, { playId: "ws-dupe-1" }))).body.verified === false);

  const none = { DB: memDB() };
  t("a round the server never saw start is not scored",
    (await read(await post(finishPost, none, { playId: "ws-nostart-1" }))).body.verified === false);
  t("and neither is a site with no database",
    (await read(await post(finishPost, {}, { playId: "ws-x" }))).body.verified === false);

  const noCsrf = await findPost({
    request: new Request("https://x/", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playId: "p", from: [0, 0], to: [0, 1] }),
    }), env: {},
  });
  t("no CSRF header is refused", noCsrf.status === 403, String(noCsrf.status));
}

console.log("");
console.log("The doors, with a database behind them");
{
  /* THE CHECKS ABOVE RAN THE NO-DATABASE PATH. isTodaysDaily({}) and
     catalog({}) answer from the sample bank, so sabotaging the SQL branch —
     the one production actually runs — walked straight through both of them.
     A check that exercises the fallback and claims to cover the real thing is
     the fault this project keeps a rule about. */
  const scheduleDB = (todayId) => ({
    prepare: (sql) => ({
      bind: (...a) => ({
        first: async () => {
          if (/FROM ws_schedule WHERE day = \? AND puzzle_id = \?/.test(sql)) {
            return a[1] === todayId ? { n: 1 } : null;
          }
          return null;
        },
        all: async () => {
          if (/FROM ws_puzzles/.test(sql)) {
            /* Two boards: today's, and one from last week. The SQL under test
               is what decides which of them a catalogue may list. */
            const rows = [{ id: todayId, theme: "Today", category: "c", status: "live" },
                          { id: "XIWS-0001", theme: "Older", category: "c", status: "live" }];
            return { results: /NOT IN \(SELECT puzzle_id FROM ws_schedule/.test(sql)
              ? rows.filter((r) => r.id !== todayId) : rows };
          }
          return { results: [] };
        },
      }),
    }),
  });
  const env = { DB: scheduleDB(BOARD.id) };

  t("with a database, the server still knows today's board",
    await isTodaysDaily(env, BOARD.id) === true, BOARD.id);
  t("and still knows another board is not it",
    await isTodaysDaily(env, "XIWS-0001") === false);
  const listed = await catalog(env);
  t("and free play's own query leaves the board in flight out",
    !listed.some((p) => p.id === BOARD.id) && listed.some((p) => p.id === "XIWS-0001"),
    listed.map((p) => p.id).join(", "));

  /* AND THE ROUTE ITSELF, which is what actually leaked: released() passes a
     board first scheduled today, so ?id=<today's id> handed the whole board
     over. Never tested here until it had already been fixed. */
  const ask = (id) => puzzleGet({
    request: new Request("https://x/api/wordsearch/puzzle?id=" + id), env,
  });
  const mine = await ask(BOARD.id);
  t("/api/wordsearch/puzzle refuses today's board",
    mine.status === 404, String(mine.status));
  const body = await mine.json();
  t("and refuses it in the words an unknown board gets, naming no rule",
    body.error === "No such board." && !JSON.stringify(body).includes("today"),
    JSON.stringify(body));
}

console.log("");
console.log("A miss says nothing at all");
{
  const env = { DB: memDB() };
  await post(roundPost, env, { playId: "ws-miss-1" });
  const miss = await read(await post(findPost, env,
    { playId: "ws-miss-1", from: [0, 0], to: [0, 1] }));
  /* SEARCHING FOR "placement" WAS NOT ENOUGH — a leaked word is a word, and
     carries no such string. The shape is asserted instead: these keys and no
     others, so anything helpful added later has to be added deliberately. */
  const keys = Object.keys(miss.body).sort().join(",");
  t("a miss carries only whether it was a miss",
    keys === "foul,fouls,hit", keys);
  const wire = JSON.stringify(miss.body);
  t("and no word from the board appears in it",
    ![...ANS, BOARD.bonus].some((a) => wire.includes(a.display) || wire.includes(a.grid)),
    "not the word, not a near miss, not a letter");
}

console.log("");
console.log("The clock is the server's, measured against real times");
{
  const env = { DB: memDB() };
  const play = "ws-clock-1";
  await post(roundPost, env, { playId: play });
  for (const a of ANS) await post(findPost, env, { playId: play, ...cellsOf(a) });

  /* MEASURED FROM THE ROWS, NOT FROM THE ANSWER. The score check earlier
     computes what it expects from the elapsed the server reported, so it
     agrees with the server however wrong the server is — a clock running to
     "now" instead of to the last word walked straight through it. This reads
     the round's own start and the last find, which is what the rule says. */
  const started = env.DB._rounds.get(play).started_ms;
  const lastFind = Math.max(...[...env.DB._finds.values()].map((f) => f.at_ms));
  const want = Math.round((lastFind - started) / 1000);
  const fin = await read(await post(finishPost, env, { playId: play }));
  t("the clock stops at the last word found, not at whenever finish is called",
    fin.body.elapsedSecs === want,
    `${fin.body.elapsedSecs}s reported, ${want}s between kick off and the last word`);
  t("and the score follows that clock rather than a claimed one",
    fin.body.score === XIWS_SCORING.computeScore(want, 0, false).score,
    fin.body.score + " / 114");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
