/* Rate limiting for unauthenticated writes.
 *
 * Before this, no endpoint anywhere returned 429. report-clue was the
 * sharpest case — an unauthenticated POST straight into D1, uncapped, on an
 * indexed site — but it was the norm rather than the exception, which is why
 * this is one helper and not five copies of the same idea drifting apart.
 *
 * Fixed window per (name, caller): count requests since the window opened,
 * refuse above the cap, start a new window when the old one ages out. Coarse
 * on purpose. The threat model is one person with curl, not a botnet; a
 * limiter that needs its own infrastructure has overshot the problem.
 *
 * The caller key is CF-Connecting-IP, which Cloudflare sets from the actual
 * connection and a client cannot forge. Missing (local dev), everything
 * shares one bucket, which is fine there.
 *
 * Fails OPEN: if the table is missing or D1 errors, the request proceeds.
 * A limiter that can take the game down is a worse fault than the one it
 * guards against. The migration is 018-rate-limits.sql.
 */
export async function limited(env, request, name, max, windowSecs) {
  try {
    const ip = request.headers.get("CF-Connecting-IP") || "local";
    const k = `${name}:${ip}`;
    const nowS = Math.floor(Date.now() / 1000);
    const row = await env.DB.prepare(
      "SELECT window_start, n FROM rate_limits WHERE k = ?").bind(k).first();
    if (!row || nowS - row.window_start >= windowSecs) {
      await env.DB.prepare(
        "INSERT INTO rate_limits (k, window_start, n) VALUES (?, ?, 1) " +
        "ON CONFLICT(k) DO UPDATE SET window_start = ?, n = 1")
        .bind(k, nowS, nowS).run();
      return false;
    }
    if (row.n >= max) return true;
    await env.DB.prepare("UPDATE rate_limits SET n = n + 1 WHERE k = ?").bind(k).run();
    return false;
  } catch (e) {
    return false;   // fail open, see above
  }
}

export function tooMany(json) {
  return json({ error: "Too many requests. Give it a minute." }, 429);
}
