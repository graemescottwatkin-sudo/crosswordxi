/* challenge_test.mjs — the challenge endpoints against a stub database.
 *
 * The property worth protecting above all others: nothing competitive is
 * returned before the board has been played, and no endpoint accepts a score.
 * A challenge table is the only place in this project where one player's result
 * is shown to another, so it is the only place where a trusted number matters.
 */
import fs from "node:fs";

let pass = 0, fail = 0;
const t = (n, ok, d) => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  — " + d : ""}`); };

const src = {
  challenge: fs.readFileSync("functions/api/challenge/index.js", "utf8"),
  start: fs.readFileSync("functions/api/challenge/start.js", "utf8"),
  entry: fs.readFileSync("functions/api/challenge/entry.js", "utf8"),
  table: fs.readFileSync("functions/api/challenge/table.js", "utf8"),
  names: fs.readFileSync("functions/_lib/names.js", "utf8"),
  migration: fs.readFileSync("data/migrations/012-challenges.sql", "utf8"),
};
const bare = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

/* A file and a directory of the same name collide: /api/challenge resolved to
   the directory, found no index, and answered 404 for a challenge created
   seconds earlier. */
t("the endpoint is a directory index, not a file beside the directory", () => true);
{
  const both = fs.existsSync("functions/api/challenge.js") &&
               fs.existsSync("functions/api/challenge");
  t("there is no challenge.js beside the challenge directory", !both);
  t("and the directory has an index", fs.existsSync("functions/api/challenge/index.js"));
}

console.log("Nothing competitive before the board is played");
t("the pre-play endpoint returns no score", (() => {
  const get = bare(src.challenge).slice(bare(src.challenge).indexOf("onRequestGet"),
                                        bare(src.challenge).indexOf("onRequestPost"));
  return !/srv_score|score:/.test(get);
})());
t("nor standings, nor a fastest time", (() => {
  const get = bare(src.challenge).slice(bare(src.challenge).indexOf("onRequestGet"),
                                        bare(src.challenge).indexOf("onRequestPost"));
  return !/challenge_entries[\s\S]{0,200}ORDER BY/.test(get) && !/elapsed/.test(get);
})());
t("only counts, which cannot be worked back into a target",
  /started/.test(src.challenge) && /finished/.test(src.challenge));

console.log("\nNo endpoint accepts a score");
for (const [name, code] of Object.entries(src)) {
  if (name === "migration" || name === "names" || name === "table") continue;
  t(`${name} reads the score rather than being told one`, (() => {
    const b = bare(code);
    return !/body\.score|body\.points|\bscore = Number\(/.test(b) &&
      (!/score/.test(b) || /srv_score/.test(b));
  })());
}

console.log("\nOne scored result each, but an interrupted attempt survives");
t("a second finish cannot replace the first",
  /INSERT OR IGNORE INTO challenge_entries/.test(src.entry));
t("and returning to an interrupted attempt is the same start, not a new one",
  /INSERT OR IGNORE INTO challenge_starts/.test(src.start));
t("the entrant is told whether they have already scored",
  /alreadyScored/.test(src.start));
t("uniqueness is per entrant per challenge",
  /UNIQUE \(challenge_id, entrant_key\)/.test(src.migration));

console.log("\nOne board, more than one group of friends");
t("pressing the button twice returns the link you already have",
  /if \(!body\.another\)/.test(src.challenge) && /already: true/.test(src.challenge));
t("but a second table can be asked for by name", (() => {
  /* Sending a board to your five-a-side lot and then to your family is the
     ordinary case. Requiring a replay first would be friction for nothing —
     the result would be identical either way. */
  const b = bare(src.challenge);
  return /body\.another/.test(b);
})());
t("and the creator's result seeds every table they make", (() => {
  const b = bare(src.challenge);
  return /INSERT OR IGNORE INTO challenge_entries/.test(b) &&
    b.indexOf("INSERT OR IGNORE INTO challenge_entries") > b.indexOf("INSERT INTO challenges");
})());

console.log("\nA result cannot be posted to the wrong board");
t("the play's board must match the challenge's",
  /String\(play\.theme_key\) !== c\.theme_id \+ "-" \+ c\.board_no/.test(src.entry));
t("and an unverified play cannot enter at all",
  /srv_score === null/.test(src.entry) && /has not been verified/.test(src.entry));

console.log("\nPublished names");
t("names are cleaned before they are stored", /cleanName/.test(src.entry) && /cleanName/.test(src.challenge));
t("markup characters are removed rather than escaped later", /\[<>&/.test(src.names));
t("zero-width and direction marks are stripped", /200b/.test(src.names));
t("a signed-in player's name comes from the account",
  /accountDisplayName\(user\) \|\| cleanName\(body\.name\)/.test(src.challenge));
t("and an entry can be hidden without being deleted",
  /hidden       INTEGER DEFAULT 0/.test(src.migration) && /hidden = 0/.test(src.table));

console.log("\nThe interface keeps the same promise as the endpoints");
{
  const js = fs.readFileSync("js/game.js", "utf8");
  const html = fs.readFileSync("index.html", "utf8");

  t("a challenge link opens the challenge screen, not the board", (() => {
    const boot = js.slice(js.indexOf("var chLink"), js.indexOf("var themed ="));
    return /openChallenge\(chLink\[1\]\)/.test(boot);
  })());
  t("the screen shows who and which board, and no score", (() => {
    /* To the end of the function, not to the next name that happens to sort
       after it — new functions were inserted between the two and the window
       quietly grew to include them. */
    const start = js.indexOf("function openChallenge");
    const fn = js.slice(start, js.indexOf("function submitChallengeEntry", start));
    const bare = fn.replace(/\/\*[\s\S]*?\*\//g, "");
    return /challenged you/.test(bare) && /reached Full Time/.test(bare) &&
      !/score/i.test(bare);
  })());
  t("the challenge card has a panel of its own", (() => {
    /* .overlay-card was a class the markup invented and the stylesheet had
       never heard of, so the board showed through the text. Any class used by
       this screen has to exist. */
    const css = fs.readFileSync("css/style.css", "utf8").replace(/\s*\n\s*/g, "");
    return /\.challenge-overlay \.overlay-card\{[^}]*background:var\(--card\)/.test(css);
  })());

  t("a name is required before the board opens",
    /name\.length < 2/.test(js) && /challenge\/start/.test(js));
  /* Two names, not one. The creator is a person; the group is who it is being
     sent to. One field doing both jobs meant a group name typed at Full Time
     came back as "Test challenged you" over a board sent by somebody else. */
  /* A signed-in player's name is display_name, not name. Three endpoints and
     three places in the browser asked for the field that does not exist, so a
     signed-in player was silently treated as a guest — their own name offered
     back as editable text and the last name typed on the device filled in. */
  t("the account's name is read from the field that exists", (() => {
    const bad = [src.challenge, src.start, src.entry]
      .some((f) => /user && user\.name|user\.name \?/.test(f));
    return !bad && /accountDisplayName/.test(src.challenge) &&
      /accountDisplayName/.test(src.start) && /accountDisplayName/.test(src.entry);
  })());
  t("and in the browser too, in one function rather than three places", (() => {
    return !/account && account\.name/.test(js) &&
      /function accountName\(\)/.test(js) && /account\.displayName/.test(js);
  })());
  t("an account with no display name still gets a name", (() => {
    /* The part before the @: an account without a display name still belongs to
       somebody, and falling back to nothing would make them type one. */
    return /email\.slice\(0, at\)/.test(src.names);
  })());

  t("the sender's name and the group's are separate fields", (() => {
    const html = fs.readFileSync("index.html", "utf8");
    return /id="chFrom"/.test(html) && /id="chGroup"/.test(html) &&
      /groupName: group \|\| null/.test(js);
  })());
  t("the group is optional", (() => {
    const api = fs.readFileSync("functions/api/challenge/index.js", "utf8");
    return /body\.groupName \? cleanName\(body\.groupName\) : null/.test(api);
  })());
  t("the person answering starts with an empty box, not somebody else's name", (() => {
    /* It used to be filled from the last name typed on this device, which on
       the sender's own device offered them their own name back. A wrong
       suggestion is worse than an empty box. */
    const fn = js.slice(js.indexOf("function openChallenge"),
                        js.indexOf("function submitChallengeEntry"));
    return /\$\("chName"\)\.value = "";/.test(fn) && !/CH_NAME_KEY/.test(fn);
  })());
  t("unless they are signed in, when it is theirs and fixed", (() => {
    const fn = js.slice(js.indexOf("function openChallenge"),
                        js.indexOf("function submitChallengeEntry"));
    return /\$\("chName"\)\.disabled = true/.test(fn);
  })());
  t("and the sender's own name is remembered, because it is theirs",
    /localStorage\.setItem\(CH_NAME_KEY/.test(js));

  t("the standings appear only after Full Time", (() => {
    /* showChallengeTable is called from the verification path, which runs when
       the puzzle is finished — never from the challenge screen. */
    const start = js.indexOf("function openChallenge");
    const open = js.slice(start, js.indexOf("function submitChallengeEntry", start));
    const play = js.slice(js.indexOf('on("chPlay"'), js.indexOf("function startChallengeBoard"));
    return !/showChallengeTable/.test(open) && !/showChallengeTable/.test(play) &&
      /if \(challenge\) submitChallengeEntry\(\)/.test(js);
  })());
  t("and show time and help beside every score",
    /ct-help/.test(js) && /no help/.test(js));

  t("the challenge screen references nothing that no longer exists", (() => {
    /* A variable removed in one change left a reference behind in another, and
       it threw AFTER the fetch had succeeded — so the single catch around both
       reported a challenge that could not be found, for a link that was fine
       every time. Names used but never declared here are the fault class. */
    let fn = js.slice(js.indexOf("function openChallenge"),
                      js.indexOf("function submitChallengeEntry"))
      .replace(/\/\*[\s\S]*?\*\//g, "");
    return !/\bsaved\b/.test(fn);
  })());
  t("a failed request and a failed render are reported differently", (() => {
    /* An error naming the wrong cause is worse than none: it sends everybody
       looking in the wrong place, and it did for an hour. */
    return /could not be opened/.test(js) && /could not be found/.test(js) &&
      /err && err\.handled/.test(js);
  })());

  t("there is a way out of the challenge screen", (() => {
    /* Without one it is a one-way door: no back, and the challenge stays in the
       address, so a refresh returns you to the screen you just declined. */
    const html = fs.readFileSync("index.html", "utf8");
    return /id="chCancel"/.test(html) && /on\("chCancel"/.test(js);
  })());
  t("and leaving takes the challenge out of the address too", (() => {
    /* Otherwise the only way back from a challenge that will not load is
       editing the URL by hand. */
    return /searchParams\.delete\("c"\)/.test(js) &&
      (js.match(/leaveChallenge\(\)/g) || []).length >= 3;
  })());
  t("every class on that screen exists in the stylesheet", (() => {
    /* .overlay-card was invented by the markup once already and the card
       rendered with no panel at all. A missing class fails silently. */
    const html = fs.readFileSync("index.html", "utf8");
    const css = fs.readFileSync("css/style.css", "utf8");
    const block = html.slice(html.indexOf('id="challengeOverlay"'), html.indexOf('id="rotatePrompt"'));
    const names = new Set();
    for (const m of block.matchAll(/class="([^"]+)"/g)) m[1].split(/\s+/).forEach((n) => names.add(n));
    return [...names].every((n) => css.includes(n));
  })());

  t("the standings sit above the league table", (() => {
    /* The league table is a season the score is mapped onto; the challenge is
       the people who actually played. */
    const html = fs.readFileSync("index.html", "utf8");
    return html.indexOf('id="challengeTable"') < html.indexOf('id="finalTableBody"');
  })());
  t("and say so when a repeat finish did not replace an entry", (() => {
    /* One entry each is what stops reveal-then-replay, but somebody who has
       just finished and cannot see their number needs telling why. */
    return /challenge\.alreadyScored/.test(js) && /still stands/.test(js);
  })());

  t("only a verified score may be offered to a table",
    /if \(verifiedScore === null\)/.test(js));
  t("the follow-on creates a challenge without replaying the board",
    /challengeBtn/.test(html) && /apiAuth\("\/api\/challenge", \{/.test(js));
  t("a second group can be challenged on the same board",
    /another: challengeMade \? 1 : 0/.test(js));
}

console.log("\nThe chain can be followed");
t("a play records the challenge it came from",
  /ALTER TABLE plays ADD COLUMN challenge_id TEXT/.test(src.migration));

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
