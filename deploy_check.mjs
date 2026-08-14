/* deploy_check.mjs — the pre-upload checklist from the deployment standard,
   §12, run rather than eyeballed. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIR = path.dirname(fileURLToPath(import.meta.url));
let pass = 0, fail = 0;
const t = (n, ok, d) => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  — " + d : ""}`); };
const read = (f) => fs.readFileSync(path.join(DIR, f), "utf8");
const has = (f) => fs.existsSync(path.join(DIR, f));

t("index.html is at the repository root", has("index.html"));
t("functions/ is at the repository root", has("functions/api/daily.js"));
t("css and js are present", has("css/style.css") && has("js/game.js") && has("js/engine.js"));

const html = read("index.html");
const refs = [...html.matchAll(/(?:src|href)="(?!data:|#|https?:|mailto:)([^"]+)"/g)].map((m) => m[1]);
t("every relative reference resolves, exact case", refs.every(has), refs.join(", "));
t("no absolute or machine-specific paths",
  !/localhost/.test(html) && !/file:\/\//.test(html) && !/[A-Za-z]:\\/.test(html) &&
  !/(src|href)="\//.test(html));

const all = ["index.html", "css/style.css", "js/game.js", "js/seasons.js"].map(read).join("\n");
/* Match data, not the word. `FCW_DATA` appears in a comment explaining why the
   bank is gone, and footballPhrase("answer", ...) is a label — neither is a
   clue bank, and a check that flags them teaches you to ignore it. */
t("the clue bank is not in any public file",
  !/FCW_DATA\s*=/.test(all) && !/"answer"\s*:\s*"/.test(all) &&
  !/"clue"\s*:\s*"/.test(all));
t("no solution letters in any public file", !/"ch"\s*:\s*"[A-Z]"/.test(all));
t("the sample dataset is server-only, not under data/",
  has("functions/_lib/sample-puzzles.js") && !has("data/sample-puzzles.js"));
t("API calls use relative URLs", /fetch\(/.test(read("js/game.js")) &&
  !/https?:\/\/[^"']*\/api\//.test(read("js/game.js")));

const ignore = read(".gitignore");
t("generated answer files are gitignored",
  /clues-production\.sql/.test(ignore) && /puzzles-production\.sql/.test(ignore));
t("no production SQL is present in the package",
  !has("data/clues-production.sql") && !has("data/puzzles-production.sql"));
t("no secrets are committed", !has(".env") && !has(".dev.vars") &&
  !/(api[_-]?key|password|secret)\s*[:=]\s*["'][^"']{8,}/i.test(all));
t("no node_modules in the package", !has("node_modules"));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
