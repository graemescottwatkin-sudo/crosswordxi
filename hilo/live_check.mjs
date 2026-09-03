/* hilo/live_check.mjs — what production is actually serving.
 *
 *   node hilo/live_check.mjs --expect v001
 *
 * Run AFTER a deploy. The deploy gate reads the tree; this reads the site.
 *
 * THE FLOOR. MIN_ASSERTIONS is the second net under the completion marker,
 * set BELOW the run's real count by the assertions that can legitimately
 * skip (the tag is reported and not judged without --expect; a club page
 * only when the index links one). Review it when assertions are added.
 */
const BASE = "https://www.thexigames.com";
const expectArg = process.argv.indexOf("--expect");
const EXPECT = expectArg > -1 ? process.argv[expectArg + 1] : null;

let pass = 0, fail = 0, warn = 0;
const t = (n, ok, d) => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  — " + d : ""}`); };
const w = (n, d) => { warn++; console.log(`  ??  ${n}${d ? "  — " + d : ""}`); };

/* Twenty-three assertions run with --expect and a club page; twenty is the
   honest floor with one block able to skip. */
const MIN_ASSERTIONS = 20;
let finished = false;
process.on("exit", () => {
  if (!finished) { console.log("\nTHE RUN DID NOT REACH THE END."); process.exit(1); }
});
process.on("uncaughtException", (e) => { console.log("\nCRASHED: " + (e && e.message)); process.exit(1); });

const get = (path, opts) => fetch(BASE + path, { redirect: "manual", ...opts });

console.log("The page production is serving");
const page = await get("/hilo/");
const html = await page.text();
t("the game answers 200", page.status === 200, String(page.status));
const tag = (html.match(/js\/game\.js\?v=([^"]+)"/) || [])[1];
t("the page carries a build tag", !!tag, tag);
if (EXPECT) t(`and it is the version expected (${EXPECT})`, tag === EXPECT, `live ${tag}`);
else w("no --expect given, so the tag is reported and not judged", tag);
t("every asset on the page carries that same tag", (() => {
  const tags = [...html.matchAll(/(?:css|js)\/[a-z_]+\.(?:css|js)\?v=([^"]+)"/g)].map((m) => m[1]);
  return tags.length > 0 && tags.every((x) => x === tag);
})());
const sharedTag = (html.match(/xi-chrome\.js\?v=(v[0-9]+)"/) || [])[1];
t("the shared chrome carries its own tag, not the game's", !!sharedTag && sharedTag !== tag, `shared ${sharedTag}, game ${tag}`);

console.log("\nThe board it is serving");
const daily = await get("/api/hilo/daily");
const d = await daily.json();
t("the daily endpoint answers", daily.status === 200, String(daily.status));
t("it serves today's board from the calendar", !!(d.board && d.board.id) && !!d.day, `${d.day} -> board ${d.board && d.board.id}`);
t("the board comes from D1, not the sample", d.source === "d1", d.source);
t("twelve rows, eleven calls", !!d.board && d.board.rows.length === 12);
const wire = JSON.stringify(d);
t("only the first value rides down with the board", (wire.match(/"value"/g) || []).length === 1);
t("and no source does", !/"quote"|"publisher"|"url"/.test(wire), "the source shows as a call settles, never before");

console.log("\nA call is judged on the server");
const call = await fetch(BASE + "/api/hilo/call", {
  method: "POST", headers: { "Content-Type": "application/json", "X-XI-Games": "1" },
  body: JSON.stringify({ token: d.board && d.board.token, index: 1, call: "higher" }),
});
const v = call.status === 200 ? await call.json() : null;
t("the call endpoint answers", call.status === 200, String(call.status));
t("with a verdict, the value and its source", !!v && typeof v.right === "boolean" && typeof v.value === "number" && !!(v.source && v.source.url));
const nocsrf = await fetch(BASE + "/api/hilo/call", { method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ token: d.board && d.board.token, index: 1, call: "higher" }) });
t("and refuses a call without the family's header", nocsrf.status === 403, String(nocsrf.status));

console.log("\nThe future is shut");
const tomorrow = new Date(Date.parse(d.day + "T00:00:00Z") + 86400000).toISOString().slice(0, 10);
const future = await get("/api/hilo/daily?day=" + tomorrow);
t("tomorrow's board is refused", future.status === 403 || future.status === 400, String(future.status));

console.log("\nThe clubs");
const clubs = await get("/hilo/clubs/");
const clubsHtml = clubs.status === 200 ? await clubs.text() : "";
t("the clubs index is served and indexable", clubs.status === 200 && !/noindex/.test(clubsHtml));
const firstClub = (clubsHtml.match(/href="\/hilo\/club\/([a-z0-9-]+)\/"/) || [])[1];
t("it links a club page", !!firstClub, firstClub);
if (firstClub) {
  const cp = await get("/hilo/club/" + firstClub + "/");
  t("a club page is served", cp.status === 200, String(cp.status));
  const door = await get("/hilo/club/" + firstClub + "/1");
  t("a board address is a door into the game", door.status === 302 && /\/hilo\/\?b=/.test(door.headers.get("location") || ""));
}

console.log("\nIt is part of the family");
t("the shared chrome is loaded, not a copy of it", html.indexOf("/shared/xi-chrome.js") > -1);
t("the page names the game once, as itself", /HiLo XI/.test(html));
const hub = await get("/");
t("the hub links to it", (await hub.text()).indexOf('href="/hilo/"') > -1);
const map = await get("/sitemap.xml");
t("the sitemap lists it", (await map.text()).indexOf("/hilo/</loc>") > -1);

console.log("\nHeaders");
const head = await get("/api/hilo/daily", { method: "HEAD" });
t("HEAD on the API answers without a body", head.status === 200, String(head.status));
t("and the API is not indexed", (daily.headers.get("x-robots-tag") || "").includes("noindex"));

console.log(`\n${pass} passed, ${fail} failed, ${warn} unjudged`);
t(`the run made at least ${MIN_ASSERTIONS} assertions`, pass + fail >= MIN_ASSERTIONS, `${pass + fail} ran`);
finished = true;
process.exit(fail ? 1 : 0);
