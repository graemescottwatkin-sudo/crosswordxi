/* GET /crossword/answers/:no
 *
 * The answers page for one board, rendered from D1 — never a static file.
 * Static pages would put answers in the repository, which two gate checks
 * exist to prevent, and would only age boards out at deploy time. Rendering
 * from the database means the seven-day rule is applied at request time by
 * the same arithmetic everywhere.
 *
 * Boards inside the window get the refusal page: 404, no-store, and not one
 * word of the board's content — confirming a clue would narrow the answer.
 * Released boards cache hard, because a published answer never changes.
 */
import { getDailyPuzzle } from "../../_lib/db.js";
import { dailyNumber, answersAvailable, ANSWERS_AFTER_DAYS } from "../../_lib/daily.js";

const esc = (s) => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function shell(title, desc, canonical, body, index) {
  return `<!DOCTYPE html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${canonical}">
${index ? "" : '<meta name="robots" content="noindex">\n'}<style>
body{margin:0;background:#F4F5F2;color:#182219;font:16px/1.55 "Public Sans",-apple-system,"Segoe UI",Arial,sans-serif}
main{max-width:680px;margin:0 auto;padding:28px 20px 48px}
h1{font-family:"Barlow Condensed","Arial Narrow",Arial,sans-serif;font-weight:700;
  font-size:32px;letter-spacing:.03em;text-transform:uppercase;margin:0 0 4px}
.sub{color:#5A675D;margin:0 0 24px}
ol{margin:0;padding:0;list-style:none}
li{background:#fff;border:1px solid #D9DDD6;border-radius:8px;padding:14px 16px;margin:0 0 10px}
.clue{margin:0 0 6px}
.ans{font-family:"Barlow Condensed","Arial Narrow",Arial,sans-serif;font-weight:700;
  font-size:22px;letter-spacing:.08em;text-transform:uppercase;color:#1E6B45;margin:6px 0 0}
details>summary{cursor:pointer;font-size:13.5px;color:#1E6B45;list-style:none;
  -webkit-tap-highlight-color:transparent;user-select:none}
details>summary::-webkit-details-marker{display:none}
details[open]>summary{display:none}
.showall{background:#fff;border:1px solid #182219;color:#182219;border-radius:999px;
  font-family:"Barlow Condensed",Arial,sans-serif;font-weight:700;font-size:15px;
  letter-spacing:.1em;text-transform:uppercase;padding:9px 18px;cursor:pointer;margin:0 0 14px}
.dir{font-size:13px;letter-spacing:.14em;text-transform:uppercase;color:#8A968D;margin:22px 0 10px}
nav{display:flex;flex-wrap:wrap;gap:10px 18px;margin-top:30px;padding-top:18px;border-top:1px solid #D9DDD6}
a{color:#1E6B45}
.cta{display:inline-block;background:#1E6B45;color:#fff;text-decoration:none;
  font-family:"Barlow Condensed",Arial,sans-serif;font-weight:700;font-size:17px;
  letter-spacing:.1em;text-transform:uppercase;padding:11px 22px;border-radius:999px;margin-top:26px}
</style>
</head>
<body><main>${body}</main></body></html>`;
}

const html = (markup, cacheable, status = 200) =>
  new Response(markup, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": cacheable
        ? "public, max-age=86400"   /* a published answer never changes */
        : "no-store",               /* a refusal must never be cached past release */
    },
  });

export async function onRequestGet({ params, env }) {
  const no = parseInt(params.no, 10);
  const today = dailyNumber();

  if (!answersAvailable(no, today)) {
    /* Nothing about the board — not its clues, not whether it exists. The
       page says only what the rule is. */
    return html(shell(
      "Not published yet \u00b7 Crossword XI answers",
      "Answers appear " + ANSWERS_AFTER_DAYS + " days after a board runs.",
      "https://www.thexigames.com/crossword/answers/",
      `<h1>Not published yet</h1>
<p class="sub">Answers appear ${ANSWERS_AFTER_DAYS} days after a board runs, so the
fresh archive stays worth playing.</p>
<a class="cta" href="/crossword/">Play today's board</a>
<nav><a href="/crossword/answers/">All published answers</a></nav>`,
      false), false, 404);
  }

  const stored = await getDailyPuzzle(env, no);
  if (!stored || !stored.puzzle) {
    return html(shell("Board not found \u00b7 Crossword XI",
      "No board with that number.",
      "https://www.thexigames.com/crossword/answers/",
      `<h1>No board #${no}</h1><nav><a href="/crossword/answers/">All published answers</a></nav>`,
      false), false, 404);
  }

  /* An entry's text lives on entry.row — the bank row the board was built
     from — with dir "A"/"D" and the printed number on the entry itself. Read
     from the same object /api/daily serves, so this page cannot describe a
     different board than the one that ran. */
  const p = stored.puzzle;
  const byNum = (a, b) => (a.num || 0) - (b.num || 0);
  const across = p.entries.filter((e) => e.dir === "A").sort(byNum);
  const down = p.entries.filter((e) => e.dir === "D").sort(byNum);
  /* Each answer folds behind a native <details> — no script needed for the
     tap, so the reveal works the instant the HTML arrives. Two readers, one
     page: the searcher who came FOR an answer taps once or hits show-all;
     the player stuck on clue 7 of an archive board reveals clue 7 and
     nothing else. Google indexes content inside collapsed <details>, so the
     answers still rank; the clues, the searchable text, are never hidden. */
  const item = (e) =>
    `<li><p class="clue">${e.num}. ${esc(e.row.clue)} ${esc(e.row.enum || "")}</p>
<details><summary>Show answer</summary><p class="ans">${esc(e.row.answer)}</p></details></li>`;

  const canonical = `https://www.thexigames.com/crossword/answers/${no}`;
  const body = `<h1>Crossword XI \u2014 board #${no} answers</h1>
<p class="sub">All eleven clues and answers from daily board #${no}.
Today's board is new, sealed, and scored out of 114.</p>
<button class="showall" onclick="document.querySelectorAll('details').forEach(function(d){d.open=true});this.remove()">Show all answers</button>
${across.length ? `<p class="dir">Across</p><ol>${across.map(item).join("")}</ol>` : ""}
${down.length ? `<p class="dir">Down</p><ol>${down.map(item).join("")}</ol>` : ""}
<a class="cta" href="/crossword/">Play today's board</a>
<nav>
${answersAvailable(no - 1, today) ? `<a href="/crossword/answers/${no - 1}">Board #${no - 1}</a>` : ""}
${answersAvailable(no + 1, today) ? `<a href="/crossword/answers/${no + 1}">Board #${no + 1}</a>` : ""}
<a href="/crossword/answers/">All published answers</a>
</nav>`;

  return html(shell(
    `Crossword XI answers \u2014 board #${no}`,
    `Every clue and answer from Crossword XI daily board #${no}, the football crossword.`,
    canonical, body, true), true);
}
