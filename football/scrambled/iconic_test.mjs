/* iconic_test.mjs — the finals, and the rule that lets them be public.
 *
 * Five hundred and forty-three boards sit outside the daily rotation: every
 * cup and play-off final in the bank, both XIs of each. They have been in the
 * database since the import with no address that reached them, because the
 * only public token named a position in a ring these boards are deliberately
 * not in. This suite is about the third token shape that opens them.
 *
 * THE ONE PROPERTY THAT MATTERS. The owner's preview token takes any board by
 * id, so every route that accepts it re-reads the admin flag on that request —
 * given away, it would hand over tomorrow's daily. The finals token needs no
 * authority at all, and the whole reason is that it resolves ONLY boards out
 * of the rotation. A board out of the rotation is never served as a daily on
 * any date, so there is no schedule for it to leak. Break that guard and the
 * id space becomes a way to read the schedule ahead; most of what follows is
 * there to refuse it.
 *
 *   node scrambled/iconic_test.mjs        (from the repo root)
 */
import {
  iconicKey, iconicList, iconicRow, outOfRotation, boardForIconicToken,
  boardForToken, boardForPreviewToken, previewKey, publicBoard, scKey,
  dailyRing, playableTokenNo,
} from "../../functions/_lib/sc-board.js";
import { SC_BOARDS } from "../../functions/_lib/sc-boards.js";
import { onRequestGet as iconicRoute } from "../../functions/api/scrambled/iconic.js";
import { onRequestPost as guessRoute } from "../../functions/api/scrambled/guess.js";
import { dailyNumber } from "../../functions/_lib/daily.js";

let pass = 0, fail = 0;
function t(name, ok, note) {
  if (ok) { pass++; console.log(`  ok  ${name}${note ? "  — " + note : ""}`); }
  else { fail++; console.log(`FAIL  ${name}${note ? "  — " + note : ""}`); }
}

/* A BANK BUILT HERE, NOT THE ONE THAT SHIPS. The module fallback holds four
   boards and every one of them is in the rotation, so a suite reading it would
   pass with an empty catalogue and prove nothing. These are the real boards
   with the real slots — so a guess can be marked for true — wearing the two
   shapes the rule has to tell apart. */
const clone = (b, over) => Object.assign(JSON.parse(JSON.stringify(b)), over);
const RING = clone(SC_BOARDS[0], { id: 7, title: "Daily XI, 4-4-2" });
const FINAL_A = clone(SC_BOARDS[0], {
  id: 1424, daily: false,
  title: "World Cup final, 1986",
  pool: "Argentina's starting XI against West Germany in the 1986 World Cup final.",
});
const FINAL_B = clone(SC_BOARDS[0], {
  id: 1484, daily: false,
  title: "World Cup final, 1986",
  pool: "West Germany's starting XI against Argentina in the 1986 World Cup final.",
});
/* A title nothing can file. It is a real board and being unable to group it is
   not a reason to drop it — the list has one of these today. */
const ODD = clone(SC_BOARDS[0], {
  id: 1545, daily: false,
  title: "Aston Villa 3-2 Paris Saint-Germain, 2025",
  pool: "Aston Villa's starting XI against Paris Saint-Germain.",
});
const BANK = [RING, FINAL_A, FINAL_B, ODD];
const env = { DB: { prepare: () => ({ all: async () => ({
  results: BANK.map((b) => ({ payload: JSON.stringify(b) })),
}) }) } };

const get = async (qs) => {
  const res = await iconicRoute({
    request: new Request("https://x/api/scrambled/iconic" + (qs || "")), env });
  return { status: res.status, body: await res.json() };
};

console.log("The catalogue is exactly the boards the daily ring skips");
{
  const rows = iconicList(BANK);
  const ids = rows.map((r) => r.id).sort((a, b) => a - b);
  t("every board out of the rotation is in it",
    ids.join(",") === "1424,1484,1545", ids.join(","));
  const ring = new Set(dailyRing(BANK).map((b) => b.id));
  t("and no board that is in the rotation is",
    rows.every((r) => !ring.has(r.id)) && ring.has(RING.id));
  t("between them they account for the whole bank",
    rows.length + ring.size === BANK.length, `${rows.length} + ${ring.size}`);
  t("the flag itself is read in one place",
    outOfRotation(FINAL_A) === true && outOfRotation(RING) === false &&
    outOfRotation(null) === false);
}

console.log("\nWhat a catalogue row says, and what it must not");
{
  const a = iconicRow(FINAL_A), b = iconicRow(FINAL_B), odd = iconicRow(ODD);
  /* Both XIs of one final carry the same title. Without the side they are two
     identical rows and the list cannot be used. */
  t("the side is taken from the pool line, so the two XIs can be told apart",
    a.side === "Argentina" && b.side === "West Germany" && a.title === b.title);
  t("the competition and year are derived once, here",
    a.comp === "World Cup" && a.year === 1986);
  t("a title that will not parse keeps its row, with no competition",
    odd.comp === null && odd.year === null && odd.id === 1545 &&
    iconicList(BANK).some((r) => r.id === 1545));
  /* The owner's list route already refused to send slots; so does this. */
  const wire = JSON.stringify(iconicList(BANK));
  t("no slots, and no names, ride in the list",
    !wire.includes("slots") && !wire.includes("scramble") &&
    !SC_BOARDS[0].slots.some((s) => wire.includes(s.name)));
}

console.log("\nThe token resolves finals, and refuses everything else");
{
  t("a finals token opens that board",
    boardForIconicToken(iconicKey(1424), BANK) === FINAL_A);
  /* THE GUARD. An id that names a board still in the rotation must resolve to
     nothing here, or the id space becomes a way to read the schedule ahead —
     which is the whole reason this token needs no authority. */
  t("a finals token naming a board IN the rotation opens nothing",
    boardForIconicToken(iconicKey(RING.id), BANK) === null);
  t("nor does an id that is not a board at all",
    boardForIconicToken(iconicKey(99999), BANK) === null);
  t("nor a token of the wrong shape",
    boardForIconicToken("sc:1424", BANK) === null &&
    boardForIconicToken("sc:preview:1424", BANK) === null &&
    boardForIconicToken("sc:iconic:", BANK) === null &&
    boardForIconicToken("sc:iconic:14x", BANK) === null &&
    boardForIconicToken(null, BANK) === null);
  /* The play routes ask boardForToken and inherit the rule rather than
     restating it; that is the only reason guess.js and reveal.js were not
     touched. */
  t("the shared resolver accepts it, which is how guess and reveal inherit it",
    boardForToken(iconicKey(1424), BANK) === FINAL_A);
  t("and still resolves a daily by its ring position",
    boardForToken(scKey(1), BANK) === dailyRing(BANK)[0]);
  /* Untouched by any of this: the future is still shut. */
  t("a daily past today is still refused",
    playableTokenNo(scKey(dailyNumber() + 1)) === false &&
    playableTokenNo(scKey(dailyNumber())) === dailyNumber());
}

console.log("\nThe board a page is given says what to call itself");
{
  const daily = publicBoard(RING, 4);
  t("a numbered board is told in the daily spelling",
    daily.no === 4 && daily.token === scKey(4));
  const final = publicBoard(FINAL_A, null, iconicKey(FINAL_A.id));
  t("a board off the ring carries no number and its own token",
    final.no === null && final.token === iconicKey(1424));
  t("and that token opens the same board again",
    boardForToken(final.token, BANK) === FINAL_A);
  /* THE REGRESSION. The owner's preview token was handed in as the ring
     position, so publicBoard wrapped it in a second "sc:" and produced
     "sc:sc:preview:1424" — a shape no route accepts. The board loaded and
     every guess came back 403. */
  const prev = publicBoard(RING, null, previewKey(RING.id));
  t("the owner's preview token survives being sent to the page",
    prev.token === previewKey(RING.id) &&
    boardForPreviewToken(prev.token, BANK) === RING, prev.token);
}

console.log("\nThe endpoint");
{
  const list = await get("");
  t("the list comes back with every final and says how many",
    list.status === 200 && list.body.count === 3 &&
    list.body.boards.length === 3, "count " + list.body.count);
  t("and says which bank it read", list.body.source === "d1");

  const one = await get("?id=1424");
  t("one final comes back ready to play",
    one.status === 200 && one.body.iconic === true && one.body.id === 1424 &&
    one.body.token === iconicKey(1424) && one.body.no === null);
  t("with its slots, and without the names on them",
    Array.isArray(one.body.slots) && one.body.slots.length === RING.slots.length &&
    !JSON.stringify(one.body.slots).includes(SC_BOARDS[0].slots[0].name));

  const ring = await get("?id=" + RING.id);
  const missing = await get("?id=99999");
  const junk = await get("?id=nonsense");
  t("a board in the rotation is refused, and no part of it comes back",
    ring.status === 404 && !ring.body.token && !ring.body.slots && !ring.body.title,
    ring.status + " / " + JSON.stringify(ring.body).slice(0, 60));
  t("an id that is no board, and one that is not a number, are refused too",
    missing.status === 404 && junk.status === 404);
  /* One answer for all three. They are the same answer today because one line
     produces it; the check is here so that a branch added later which tells a
     daily apart from a board that does not exist has to be a deliberate act —
     the pair of answers, told apart, would say where the rotation ends. */
  t("and all three are refused in the same words",
    ring.body.error === missing.body.error && junk.body.error === missing.body.error,
    JSON.stringify(ring.body.error));
}

console.log("\nAnd a final can actually be played");
{
  /* END TO END, through the real guess route: a token from the catalogue,
     marked against the real names. A rule that resolves in a helper but not on
     the wire is the fault this project keeps paying for. */
  const answer = FINAL_A.slots[0].name;
  const ask = async (token) => {
    const res = await guessRoute({
      request: new Request("https://x/api/scrambled/guess", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, guess: answer, solved: [] }),
      }), env });
    return { status: res.status, body: await res.json() };
  };
  const ok = await ask(iconicKey(1424));
  t("a guess against a finals token is marked",
    ok.status === 200 && ok.body.solvedId === FINAL_A.slots[0].id,
    JSON.stringify(ok.body).slice(0, 90));
  /* The same guard, on the wire this time. */
  const sneaky = await ask(iconicKey(RING.id));
  t("a finals token for a board in the rotation is refused by the play route",
    sneaky.status === 403, sneaky.status + " " + JSON.stringify(sneaky.body));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
