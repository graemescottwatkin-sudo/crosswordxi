/* epoch_test.mjs — the client and the server must agree on what day it is.
 *
 * The date Daily #1 falls on is written in two files, in two formats:
 * js/engine.js uses local-time components, functions/_lib/daily.js uses UTC.
 * If they drift apart the browser asks for puzzle N while the server thinks it
 * is N±1 — so every reveal and every check is refused with a 403, for
 * everybody, and the game looks broken rather than misconfigured.
 */
import fs from "node:fs";
import { dailyNumber as serverDaily } from "../functions/_lib/daily.js";
import path from "node:path";
import { fileURLToPath } from "node:url";
const DIR = path.dirname(fileURLToPath(import.meta.url));

let pass = 0, fail = 0;
const t = (n, ok, d) => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  — " + d : ""}`); };

/* Load the client engine the way a browser would. */
const engineSrc = fs.readFileSync(path.join(DIR, "js/engine.js"), "utf8");
const sandbox = { module: { exports: {} }, window: {} };
new Function("module", "window", engineSrc)(sandbox.module, sandbox.window);
const FCW = sandbox.module.exports;

const epochLine = engineSrc.match(/var DAILY_EPOCH = \{ y: (\d+), m: (\d+), d: (\d+) \}/);
t("the client declares an epoch", !!epochLine, epochLine && epochLine[0]);
const serverLine = fs.readFileSync(path.join(DIR, "../functions/_lib/daily.js"), "utf8")
  .match(/const EPOCH = Date\.UTC\((\d+), (\d+), (\d+)\)/);
t("the server declares one too", !!serverLine, serverLine && serverLine[0]);

/* The conventions differ by one day on purpose: the client stores the day
   *before* #1, the server stores #1 itself. */
const [, cy, cm, cd] = epochLine.map(Number);
const [, sy, sm, sd] = serverLine.map(Number);
t("they describe the same first day",
  cy === sy && cm === sm && cd + 1 === sd,
  `client ${cy}-${cm + 1}-${cd + 1} (day before) vs server ${sy}-${sm + 1}-${sd}`);

/* And, more usefully, they agree on actual dates. */
const dates = ["2026-08-11", "2026-08-15", "2026-09-01", "2026-12-05", "2027-01-01"];
const disagree = dates.filter((iso) => {
  const d = new Date(iso + "T12:00:00Z");
  return FCW.dailyNumber(d) !== serverDaily(d.getTime());
});
t("client and server agree on every date checked", disagree.length === 0,
  disagree.length ? disagree.join(", ") : dates.map((iso) => {
    const d = new Date(iso + "T12:00:00Z");
    return iso + "=#" + serverDaily(d.getTime());
  }).join("  "));

t("before the first day everything clamps to #1, so testing never runs it down",
  serverDaily(Date.UTC(2026, 0, 1)) === 1, "#" + serverDaily(Date.UTC(2026, 0, 1)));


/* The client's trusted-mode day must be THE SERVER'S day — same instant in,
   same board number out, at every boundary hour. Run both implementations
   side by side across the dangerous instants: just before and after UTC
   midnight, which is the hour the two used to disagree in UK summer. */
{
  const srv = await import("../functions/_lib/daily.js");
  const instants = [
    Date.UTC(2026, 7, 27, 22, 59), Date.UTC(2026, 7, 27, 23, 30),
    Date.UTC(2026, 7, 28, 0, 0),  Date.UTC(2026, 7, 28, 0, 30),
    Date.UTC(2026, 7, 28, 1, 0),  Date.UTC(2026, 8, 2, 23, 59),
  ];
  let diverged = null;
  for (const ms of instants) {
    FCW.setTrustedTime(ms);
    /* setTrustedTime records an offset against the REAL clock; freeze the
       comparison by asking both sides about the same instant. */
    const client = FCW.dailyNumber();
    const server = srv.dailyNumber(FCW.timeState().now);
    if (client !== server) { diverged = `${new Date(ms).toISOString()}: client #${client}, server #${server}`; break; }
  }
  FCW.clearTrustedTime();
  t("a trusted client counts the same day as the server at every boundary hour",
    !diverged, diverged || instants.length + " instants, including both sides of UTC midnight");
  /* First draft of this ended "|| true" — an assertion that cannot fail,
     written the same night a review caught five of them. The real property:
     an explicit `at` answers from LOCAL calendar components regardless of
     trust, because the archive calendar maps its cells through local dates
     and must not shift when a sync lands. Local epoch day is the 25th, so
     local 28 August is board #3, trusted or not. */
  FCW.setTrustedTime(Date.UTC(2026, 7, 20));   // trust pointing at a different day entirely
  t("an explicit date still answers from the local calendar, trust or no trust",
    FCW.dailyNumber(new Date(2026, 7, 28, 0, 30)) === 3,
    "the calendar's cells must not move when a sync lands");
  FCW.clearTrustedTime();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
