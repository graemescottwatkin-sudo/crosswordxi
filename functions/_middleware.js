/* functions/_middleware.js — what every Function-served response must do.
 *
 * TWO FAULTS, ONE FILE, found by external review of v001m.
 *
 * FAULT 1 — HEAD 404'd on every Function route. Pages does not derive HEAD
 * from GET: a handler exporting only onRequestGet never sees a HEAD request,
 * so it fell through to the static handler and 404'd. Static pages answered
 * HEAD fine, which is exactly why nobody noticed — the crawler-facing pages
 * that diverged were the Function-served ones, and /crossword/answers/ is IN
 * the sitemap at priority 0.7. With the wordsearch archive now live, every
 * answers page in BOTH games had this. The fix is the only honest HEAD there
 * is: run the GET, keep the status and headers, drop the body.
 *
 * FAULT 2 — _headers applies to static assets only. The `/api/* X-Robots-Tag:
 * noindex` rule and the site-wide security headers decorated precisely the
 * HEAD 404 from fault 1 and reached no real Function response. One handler
 * (wordsearch/puzzle) set its own noindex, so the pattern existed in one file
 * and was absent from the general case — a rule that lives in one handler is
 * not a rule. They are set here, once, on the way out.
 *
 * Headers are set only where absent, so a handler that says something more
 * specific (the answers pages' own Cache-Control) is never overruled.
 */
export async function onRequest(context) {
  const { request, next } = context;

  /* HEAD: routing chose the handler chain by method BEFORE this middleware
     ran, so for HEAD there is no onRequestGet in the chain and next() — even
     handed a rewritten GET request — falls through to the static handler and
     404s. Proven locally: the 404 came back wearing this middleware's own
     X-Robots-Tag. The only way to answer HEAD with the GET's truth is to ASK
     for the GET: a depth-one self-fetch (HEAD → GET → handler → back), then
     status and headers without the body. One subrequest per HEAD, and HEAD
     traffic is crawlers. */
  if (request.method === "HEAD") {
    const got = await fetch(new Request(request.url, {
      method: "GET",
      headers: request.headers,
    }));
    return new Response(null, { status: got.status, headers: got.headers });
  }

  const response = await next();
  const h = new Headers(response.headers);
  const url = new URL(request.url);

  if (!h.has("X-Content-Type-Options")) h.set("X-Content-Type-Options", "nosniff");
  if (!h.has("Referrer-Policy")) h.set("Referrer-Policy", "strict-origin-when-cross-origin");
  /* The API is machinery, not pages. Google indexing /api/daily as a document
     was the _headers rule's whole intent; this is where it actually lands. */
  if (url.pathname.startsWith("/api/") && !h.has("X-Robots-Tag")) {
    h.set("X-Robots-Tag", "noindex");
  }
  return new Response(response.body, { status: response.status, headers: h });
}
