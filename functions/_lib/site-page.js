/* The shell every server-rendered page on this site is poured into.
 *
 * The answers pages each carried their own copy of this markup and CSS. A
 * second copy is a second place for the site to look like two sites, and the
 * club pages would have made it a fourth. One shell, and a page supplies only
 * what is its own.
 *
 * THE FAMILY SHELL, NOT A BARE ONE. These pages used to carry inline CSS and
 * nothing else — no chrome bar, no masthead, no footer — on the argument that
 * a search visitor on a cold cache should not wait for a stylesheet, and that
 * the chrome named every game. So a club page read as a different site from
 * the game it belonged to, and it is the page a search visitor sees first.
 * The chrome names released games only, the live checks enforce that on
 * every page, and two small cached stylesheets are a fair price for looking
 * like one site. So: the shared tokens, the landing masthead, the chrome bar
 * and footer, and the theme script in the head so a phone set to dark does
 * not flash dark on a light site. The page's own rules use the tokens.
 */

/* THE SHARED LAYER'S TAG, as every page carries it in its ?v=. One more
   place the tag is written; tools/aligned_test.mjs asserts it agrees with the
   pages, so it cannot fall behind them quietly. */
export const SHARED_TAG = "v15";

/* What each game's masthead says and where its tabs go. The current tab is
   marked by path; a page with no game (a hub-level page) gets no masthead. */
const MAST = {
  crossword: {
    name: "Crossword", home: "/crossword/",
    nav: [["Today", "/crossword/"], ["Clubs", "/crossword/clubs/"],
          ["Answers", "/crossword/answers/"], ["How to play", "/crossword/how-to-play"]],
  },
  wordsearch: {
    name: "Wordsearch", home: "/wordsearch/",
    nav: [["Today", "/wordsearch/"], ["Themes", "/wordsearch/themes/"],
          ["Answers", "/wordsearch/answers/"], ["How to play", "/crossword/how-to-play"]],
  },
  hilo: {
    name: "HiLo", home: "/hilo/",
    nav: [["Today", "/hilo/"], ["Clubs", "/hilo/clubs/"], ["How to play", "/hilo/#how"]],
  },
};

const CSS = `
/* The page's ground and type, on the tokens. The chrome styles what it
   draws and nothing else, so the body is the shell's to set — dropped once
   in the move to the shared layer, and every server-rendered page fell
   back to the browser's serif. */
body{margin:0;background:var(--paper);color:var(--ink);font-family:var(--body);
  font-size:16px;line-height:1.55;-webkit-text-size-adjust:100%}
.site-page{max-width:680px;margin:0 auto;padding:28px 20px 48px}
.site-page h1{font-family:var(--disp);font-weight:700;font-size:var(--fs-h1,32px);
  letter-spacing:.03em;text-transform:uppercase;margin:0 0 4px;color:var(--ink)}
.site-page h2{font-family:var(--disp);font-weight:700;font-size:21px;
  letter-spacing:.04em;text-transform:uppercase;margin:30px 0 10px;color:var(--ink)}
.site-page .sub{color:var(--ink-soft);margin:0 0 24px}
.site-page ol,.site-page ul{margin:0;padding:0;list-style:none}
.site-page li{background:var(--card);border:1px solid var(--line);border-radius:var(--r-md,8px);
  padding:12px 16px;margin:0 0 8px}
.site-page li .meta{display:block;color:var(--ink-soft);font-size:14px;margin-top:2px}
/* A set is the name in its own column and the chips in theirs. The name used
   to share the first line with the chips, so a row of thirty-three seasons
   wrapped with its first line starting a name's width to the right of every
   line under it. The chips are one width, so wrapped lines make columns. On a
   narrow phone the name goes above the chips instead of beside them. */
.site-page li.set{display:grid;grid-template-columns:minmax(120px,180px) 1fr;gap:8px 16px;align-items:start}
.site-page .set .name{font-family:var(--disp);font-weight:700;
  font-size:18px;line-height:1.15;letter-spacing:.04em;text-transform:uppercase;padding-top:10px}
.site-page .set .chips{display:flex;flex-wrap:wrap;gap:8px}
@media (max-width:520px){.site-page li.set{grid-template-columns:1fr}.site-page .set .name{padding-top:0}}
/* The numbers are the thing you press, so they are shaped like it: a bordered
   pill with a tap target, not a number that happens to be a link. One width,
   so a wrapped row lines up with the row above it. */
.site-page .set .no{display:inline-flex;align-items:center;justify-content:center;box-sizing:border-box;
  min-width:64px;min-height:var(--tap,40px);padding:0 10px;border:2px solid var(--pitch);border-radius:var(--r-md,8px);
  background:var(--card);color:var(--pitch-ink,var(--pitch));text-decoration:none;font-weight:700;font-size:15px;
  font-variant-numeric:tabular-nums}
.site-page .set .no:hover,.site-page .set .no:focus{background:var(--pitch);color:var(--on-pitch,#fff)}
.site-page a{color:var(--pitch-ink,var(--pitch))}
.site-page .soon li{background:var(--tint);border-style:dashed}
.site-page .crumb{font-size:14px;color:var(--ink-soft);margin:0 0 18px}
.site-page .cta{display:inline-block;background:var(--pitch);color:var(--on-pitch,#fff);text-decoration:none;
  font-family:var(--disp);font-weight:700;font-size:17px;
  letter-spacing:.1em;text-transform:uppercase;padding:11px 22px;border-radius:var(--r-pill,999px);margin-top:26px}
.site-page .cta.ghost{background:transparent;color:var(--pitch-ink,var(--pitch));border:2px solid var(--pitch);margin-left:8px}
.site-page nav.foot{display:flex;flex-wrap:wrap;gap:10px 18px;margin-top:30px;padding-top:18px;border-top:1px solid var(--line)}
`;

/* Anything interpolated into markup goes through here. Club and theme names
   are authored data, not literals, and a name with an ampersand in it would
   otherwise arrive as broken markup rather than as a name. */
export function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/* The game's masthead: name, and its tabs with the current one marked by the
   page's own path. Rendered from MAST so a tab added for one page is on
   every page of that game. */
function masthead(game, current) {
  const m = MAST[game];
  if (!m) return "";
  const tabs = m.nav.map(([label, href]) => {
    const on = current && (href === current || (href !== m.home && current.indexOf(href) === 0));
    return `<a class="site-navlink${on ? " on" : ""}" href="${esc(href)}">${esc(label)}</a>`;
  }).join("");
  return `<header class="site-head"><div class="site-bar">
<a class="site-mast" href="${esc(m.home)}">${esc(m.name)} <span class="site-xi">XI</span></a>
<nav class="site-nav">${tabs}</nav>
</div></header>`;
}

export function sitePage({ title, description, canonical, body, noindex, game = "crossword", current = null, extraCss = "" }) {
  const v = SHARED_TAG;
  return `<!DOCTYPE html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
${noindex ? '<meta name="robots" content="noindex,follow">\n' : ""}<link rel="canonical" href="${esc(canonical)}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600;700&family=Public+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/shared/xi-tokens.css?v=${v}">
<link rel="stylesheet" href="/shared/xi-landing.css?v=${v}">
<link rel="stylesheet" href="/shared/xi-chrome.css?v=${v}">
<script src="/shared/xi-theme.js?v=${v}"></script>
<style>${CSS}${extraCss || ""}</style>
</head>
<body>
<header class="xic-bar"></header>
${masthead(game, current)}
<main class="site-page">${body}</main>
<footer class="xic-foot"></footer>
<script src="/shared/xi-chrome.js?v=${v}"></script>
</body></html>`;
}

export function htmlResponse(page, { maxAge = 3600, noindex = false } = {}) {
  const headers = {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": `public, max-age=${maxAge}`,
  };
  /* Said in the header as well as the meta tag. A crawler that only fetches
     headers, and any non-HTML response, would never see the meta. */
  if (noindex) headers["X-Robots-Tag"] = "noindex";
  return new Response(page, { headers });
}
