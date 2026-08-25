#!/usr/bin/env node
/* tools/review_themes.js
 *
 *   node tools/review_themes.js --source ../crosswordxi-source
 *
 * themes-plan.json lists answers and clue ids, which is enough for a machine
 * and useless for a person: you cannot tell whether a clue belongs to a theme
 * from its answer, and the thing actually worth checking — *why* it matched —
 * is not in there at all.
 *
 * This writes the same boards with the clue text, and against every clue the
 * key that put it in that theme and where the key was found. That last column
 * is the point. A clue in the Rangers pool matched on "rangers found in clue"
 * is exactly how every Queens Park Rangers clue ended up as Rangers, and it is
 * invisible if you are only looking at answers.
 *
 * OUTPUT  data/themes-review.html   grouped by board, launch batch first
 *         data/themes-review.csv    the same rows, for marking up
 *
 * Both hold answers. Both are gitignored. Neither goes near the repo.
 */
const fs = require("fs");
const path = require("path");

const HERE = __dirname;
const ROOT = path.join(HERE, "..");
const arg = (n, d) => {
  const i = process.argv.indexOf("--" + n);
  return i === -1 ? d : process.argv[i + 1];
};
const SOURCE = arg("source", ROOT);
const PLAN = arg("plan", path.join(ROOT, "data", "themes-plan.json"));

function need(f) {
  const p = path.resolve(SOURCE, f);
  if (!fs.existsSync(p)) { console.error(`Cannot find ${p}`); process.exit(1); }
  return p;
}
const rows = JSON.parse(fs.readFileSync(need("data.json"), "utf8"));
const { THEMES, norm } = require("./themes.js");
const byId = {};
rows.forEach((r) => { byId[String(r.id)] = r; });
const themeById = {};
THEMES.forEach((t) => { themeById[t.id] = t; });

if (!fs.existsSync(PLAN)) {
  console.error(`Cannot find ${PLAN} — run tools/build_themes.js first`);
  process.exit(1);
}
const plan = JSON.parse(fs.readFileSync(PLAN, "utf8"));

/* Why is this clue in this theme? Returns every key that hit and the field it
   hit in, because a key that only ever matches inside the clue text is a
   different kind of membership from one that matches the answer. */
function why(row, theme) {
  if (theme.cats) return [`category "${row.cat}"`];
  const fields = { clue: norm(row.clue), answer: norm(row.answer), entity: norm(row.entity) };
  const hits = [];
  for (const k of theme.keys) {
    for (const [field, text] of Object.entries(fields)) {
      if (text.indexOf(" " + k + " ") !== -1) hits.push(`"${k}" in ${field}`);
    }
  }
  return hits.length ? hits : ["(no key matched — check this)"];
}

const LAUNCH = plan.map((b) => b.release).sort()[0];
const ordered = plan.slice().sort((a, b) =>
  (a.release === LAUNCH ? 0 : 1) - (b.release === LAUNCH ? 0 : 1) ||
  (a.release < b.release ? -1 : a.release > b.release ? 1 : 0) ||
  a.name.localeCompare(b.name) || a.no - b.no);

/* ---- CSV, for marking up ---- */
const esc = (v) => '"' + String(v == null ? "" : v).replace(/"/g, '""') + '"';
const csv = [["Theme", "Board", "Release", "Launch?", "Clue id", "Category",
              "Clue", "Answer", "Why it is in this theme", "Wrong theme?"].map(esc).join(",")];

/* ---- HTML, for reading ---- */
const html = [];
html.push(`<!doctype html><meta charset="utf-8"><title>Crossword XI — themed board review</title>`);
html.push(`<style>
  body{font:15px/1.5 system-ui,sans-serif;max-width:1000px;margin:28px auto;padding:0 18px;color:#12241a}
  h1{font-size:22px} h2{font-size:17px;margin:30px 0 4px;border-bottom:2px solid #14532d;padding-bottom:4px}
  .meta{color:#5b6b60;font-size:13px;margin-bottom:8px}
  table{border-collapse:collapse;width:100%;margin-bottom:8px}
  td,th{border-bottom:1px solid #dde5e0;padding:6px 8px;text-align:left;vertical-align:top;font-size:14px}
  th{font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:#5b6b60}
  .ans{font-weight:600;white-space:nowrap}
  .why{color:#5b6b60;font-size:12.5px;white-space:nowrap}
  .warn{color:#a33;font-weight:600}
  .launch{background:#f2f8f4}
  .lead{background:#f7f9f8;border-left:4px solid #14532d;padding:12px 14px;margin-bottom:20px}
</style>`);
html.push(`<h1>Themed board review</h1>`);
html.push(`<div class="lead"><p><b>What to look for:</b> a clue that is not really about
  its theme. The <i>why</i> column says which key put it there — that is where the
  mistakes are. A key matching inside the clue text can catch the wrong club
  entirely: every Queens Park Rangers clue once landed in the Rangers pool this
  way.</p>
  <p>The ${plan.filter((b) => b.release === LAUNCH).length} launch boards are first and
  are the ones that matter now; the rest are not released for weeks.</p></div>`);

let lastRelease = null;
for (const b of ordered) {
  const isLaunch = b.release === LAUNCH;
  if (b.release !== lastRelease) {
    html.push(`<p class="meta">${isLaunch ? "<b>Launch batch</b> — " : ""}released ${b.release}</p>`);
    lastRelease = b.release;
  }
  const theme = themeById[b.theme] || { keys: [], id: b.theme };
  html.push(`<h2${isLaunch ? ' class="launch"' : ""}>${b.name} #${b.no}</h2>`);
  html.push("<table><tr><th>Answer</th><th>Clue</th><th>Category</th><th>Why it is in this theme</th></tr>");
  b.clueIds.forEach((id) => {
    const r = byId[String(id)];
    if (!r) {
      html.push(`<tr><td colspan="4" class="warn">clue ${id} is not in data.json</td></tr>`);
      return;
    }
    const reasons = why(r, theme);
    const bad = reasons[0].startsWith("(no key");
    html.push(`<tr><td class="ans">${r.answer}</td><td>${r.clue}</td>` +
      `<td class="why">${r.cat}</td>` +
      `<td class="why${bad ? " warn" : ""}">${reasons.join("<br>")}</td></tr>`);
    csv.push([b.name, b.no, b.release, isLaunch ? "yes" : "", r.id, r.cat,
              r.clue, r.answer, reasons.join("; "), ""].map(esc).join(","));
  });
  html.push("</table>");
}

/* A key that matches far more than its share is the shape of a mis-tagging.
   "rangers" hitting 25 clues in a bank with one Rangers clue is the tell. */
html.push(`<h1 style="margin-top:40px">Keys, and how much each one caught</h1>`);
html.push(`<p class="meta">A key matching far more than you would expect is worth a look
  before the boards are.</p>`);
html.push("<table><tr><th>Theme</th><th>Key</th><th>Clues matched</th></tr>");
for (const t of THEMES) {
  if (!t.keys) continue;
  for (const k of t.keys) {
    const n = rows.filter((r) => String(r.maxPer).trim() !== "0" &&
      (norm(r.clue) + norm(r.answer) + norm(r.entity)).indexOf(" " + k + " ") !== -1).length;
    html.push(`<tr><td>${t.name}</td><td>${k}</td><td>${n}</td></tr>`);
  }
}
html.push("</table>");

const outHtml = path.join(ROOT, "data", "themes-review.html");
const outCsv = path.join(ROOT, "data", "themes-review.csv");
fs.writeFileSync(outHtml, html.join("\n") + "\n");
fs.writeFileSync(outCsv, csv.join("\n") + "\n");
console.log(`Wrote ${outHtml}`);
console.log(`Wrote ${outCsv}`);
console.log(`${plan.length} boards, ${csv.length - 1} clues, ` +
  `${plan.filter((b) => b.release === LAUNCH).length} boards in the launch batch`);
