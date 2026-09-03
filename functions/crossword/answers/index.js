/* GET /crossword/answers/
 *
 * Every published board, newest first. This page is how the individual
 * answer pages get discovered — it is in the sitemap; they are found from
 * here. Before any board has aged past the window it says so plainly,
 * because an empty page that looks broken is worse than one that explains
 * itself.
 *
 * Poured into the family shell like every other served page: this carried
 * its own copy of the shell's CSS, which is how the answers looked like a
 * different site from the game they belong to.
 */
import { dailyNumber, answersAvailable, ANSWERS_AFTER_DAYS } from "../../_lib/daily.js";
import { sitePage, htmlResponse } from "../../_lib/site-page.js";

export async function onRequestGet() {
  const today = dailyNumber();
  const newest = today - ANSWERS_AFTER_DAYS - 1;
  const links = [];
  for (let no = newest; no >= 1; no--) {
    if (answersAvailable(no, today)) {
      links.push(`<li><a href="/crossword/answers/${no}">Board #${no} — clues and answers</a></li>`);
    }
  }
  const body = links.length
    ? `<h1>Crossword XI — answers</h1>
<p class="sub">Clues and answers for every board more than ${ANSWERS_AFTER_DAYS} days old.
Newer boards stay sealed so the archive is worth playing.</p>
<ol>${links.join("")}</ol>
<a class="cta" href="/crossword/">Play today's board</a>`
    : `<h1>Crossword XI — answers</h1>
<p class="sub">Answers appear here once a board is more than ${ANSWERS_AFTER_DAYS} days old.
The game is new — the first will arrive shortly.</p>
<a class="cta" href="/crossword/">Play today's board</a>`;

  /* An hour: long enough to be cheap, short enough that a board crossing
     the seven-day line appears the same morning. */
  return htmlResponse(sitePage({
    title: "Crossword XI answers — every published board",
    description: `Clues and answers for past Crossword XI boards, the daily football crossword. Boards are published ${ANSWERS_AFTER_DAYS} days after they run.`,
    canonical: "https://www.thexigames.com/crossword/answers/",
    current: "/crossword/answers/",
    body,
  }), { maxAge: 3600 });
}
