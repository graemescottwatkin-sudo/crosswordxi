/* GET /crossword/answers/
 *
 * Every published board, newest first. This page is how the individual
 * answer pages get discovered — it is in the sitemap; they are found from
 * here. Before any board has aged past the window it says so plainly,
 * because an empty page that looks broken is worse than one that explains
 * itself.
 */
import { dailyNumber, answersAvailable, ANSWERS_AFTER_DAYS } from "../../_lib/daily.js";

export async function onRequestGet() {
  const today = dailyNumber();
  const newest = today - ANSWERS_AFTER_DAYS - 1;
  const links = [];
  for (let no = newest; no >= 1; no--) {
    if (answersAvailable(no, today)) {
      links.push(`<li><a href="/crossword/answers/${no}">Board #${no} \u2014 clues and answers</a></li>`);
    }
  }
  const body = links.length
    ? `<h1>Crossword XI \u2014 answers</h1>
<p class="sub">Clues and answers for every board more than ${ANSWERS_AFTER_DAYS} days old.
Newer boards stay sealed so the archive is worth playing.</p>
<ol>${links.join("")}</ol>
<a class="cta" href="/crossword/">Play today's board</a>`
    : `<h1>Crossword XI \u2014 answers</h1>
<p class="sub">Answers appear here once a board is more than ${ANSWERS_AFTER_DAYS} days old.
The game is new \u2014 the first will arrive shortly.</p>
<a class="cta" href="/crossword/">Play today's board</a>`;

  const page = `<!DOCTYPE html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Crossword XI answers \u2014 every published board</title>
<meta name="description" content="Clues and answers for past Crossword XI boards, the daily football crossword. Boards are published ${ANSWERS_AFTER_DAYS} days after they run.">
<link rel="canonical" href="https://www.thexigames.com/crossword/answers/">
<style>
body{margin:0;background:#F4F5F2;color:#182219;font:16px/1.55 "Public Sans",-apple-system,"Segoe UI",Arial,sans-serif}
main{max-width:680px;margin:0 auto;padding:28px 20px 48px}
h1{font-family:"Barlow Condensed","Arial Narrow",Arial,sans-serif;font-weight:700;
  font-size:32px;letter-spacing:.03em;text-transform:uppercase;margin:0 0 4px}
.sub{color:#5A675D;margin:0 0 24px}
ol{margin:0;padding:0;list-style:none}
li{background:#fff;border:1px solid #D9DDD6;border-radius:8px;padding:12px 16px;margin:0 0 8px}
a{color:#1E6B45}
.cta{display:inline-block;background:#1E6B45;color:#fff;text-decoration:none;
  font-family:"Barlow Condensed",Arial,sans-serif;font-weight:700;font-size:17px;
  letter-spacing:.1em;text-transform:uppercase;padding:11px 22px;border-radius:999px;margin-top:26px}
</style>
</head>
<body><main>${body}</main></body></html>`;

  return new Response(page, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      /* An hour: long enough to be cheap, short enough that a board crossing
         the seven-day line appears the same morning. */
      "Cache-Control": "public, max-age=3600",
    },
  });
}
