/* The shell every server-rendered page on this site is poured into.
 *
 * The answers pages each carried their own copy of this markup and CSS. A
 * second copy is a second place for the site to look like two sites, and the
 * club pages would have made it a fourth. One shell, and a page supplies only
 * what is its own.
 *
 * PLAIN CSS, INLINE, NO SHARED STYLESHEET. These pages are read by people
 * arriving from a search result on a cold cache, and a blocking request for a
 * stylesheet to render forty lines of text is a worse trade than repeating a
 * kilobyte. They deliberately do NOT load the game's chrome: xi-chrome names
 * every game in the family, and an unreleased one must not appear in served
 * markup.
 */

const CSS = `
body{margin:0;background:#F4F5F2;color:#182219;font:16px/1.55 "Public Sans",-apple-system,"Segoe UI",Arial,sans-serif}
main{max-width:680px;margin:0 auto;padding:28px 20px 48px}
h1{font-family:"Barlow Condensed","Arial Narrow",Arial,sans-serif;font-weight:700;
  font-size:32px;letter-spacing:.03em;text-transform:uppercase;margin:0 0 4px}
h2{font-family:"Barlow Condensed","Arial Narrow",Arial,sans-serif;font-weight:700;
  font-size:21px;letter-spacing:.04em;text-transform:uppercase;margin:30px 0 10px}
.sub{color:#5A675D;margin:0 0 24px}
ol,ul{margin:0;padding:0;list-style:none}
li{background:#fff;border:1px solid #D9DDD6;border-radius:8px;padding:12px 16px;margin:0 0 8px}
li .meta{display:block;color:#5A675D;font-size:14px;margin-top:2px}
li.set{display:flex;flex-wrap:wrap;align-items:center;gap:10px}
.set .name{font-family:"Barlow Condensed","Arial Narrow",Arial,sans-serif;font-weight:700;
  font-size:18px;letter-spacing:.04em;text-transform:uppercase;flex:1 1 140px}
/* The numbers are the thing you press, so they are shaped like it: a bordered
   pill with a tap target, not a number that happens to be a link. A row of
   bare "#1 #2" reads as a label saying how many there are. */
.set .no{display:inline-flex;align-items:center;justify-content:center;
  min-width:46px;min-height:40px;padding:0 12px;border:2px solid #1E6B45;border-radius:8px;
  background:#fff;color:#1E6B45;text-decoration:none;font-weight:700;font-size:16px}
.set .no:hover,.set .no:focus{background:#1E6B45;color:#fff}
a{color:#1E6B45}
.soon li{background:#EDEFEA;border-style:dashed}
.crumb{font-size:14px;color:#5A675D;margin:0 0 18px}
.cta{display:inline-block;background:#1E6B45;color:#fff;text-decoration:none;
  font-family:"Barlow Condensed",Arial,sans-serif;font-weight:700;font-size:17px;
  letter-spacing:.1em;text-transform:uppercase;padding:11px 22px;border-radius:999px;margin-top:26px}
.cta.ghost{background:transparent;color:#1E6B45;border:2px solid #1E6B45;margin-left:8px}
`;

/* Anything interpolated into markup goes through here. Club and theme names
   are authored data, not literals, and a name with an ampersand in it would
   otherwise arrive as broken markup rather than as a name. */
export function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

export function sitePage({ title, description, canonical, body, noindex }) {
  return `<!DOCTYPE html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
${noindex ? '<meta name="robots" content="noindex,follow">\n' : ""}<link rel="canonical" href="${esc(canonical)}">
<style>${CSS}</style>
</head>
<body><main>${body}</main></body></html>`;
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
