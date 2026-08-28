/* GET /api/quickfire/challenge?x=<code>
 *
 * Rebuilds a board someone has shared. The code carries question ids and
 * nothing else — no answers travel in a link.
 *
 * A code is not authorisation. Every id is checked against boards that have
 * already been played, so a crafted link cannot pull tomorrow's questions.
 */
import { hasDB, getPlayedQuestions, noStore } from "../../_lib/qfdata.js";

function decode(code) {
  const b64 = String(code).replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  const json = decodeURIComponent(escape(atob(padded)));
  const payload = JSON.parse(json);
  if (!payload || payload.v !== 1 || !Array.isArray(payload.q)) {
    throw new Error("unrecognised code");
  }
  return {
    ids: payload.q.map((s) => Number(String(s).replace(/^q/, ""))),
    bench: (payload.b || []).map((s) => Number(String(s).replace(/^q/, ""))),
  };
}

export async function onRequestGet({ env, request }) {
  if (!hasDB(env)) return noStore({ error: "no database binding", source: "none" }, 503);

  const code = new URL(request.url).searchParams.get("x") || "";
  let wanted;
  try {
    wanted = decode(code);
  } catch (err) {
    return noStore({ error: "that challenge link is damaged", source: "d1" }, 400);
  }

  const rows = await getPlayedQuestions(env, wanted.ids.concat(wanted.bench));
  const byId = new Map(rows.map((r) => [r.id, r]));
  const questions = wanted.ids.map((id) => byId.get(id)).filter(Boolean);
  const bench = wanted.bench.map((id) => byId.get(id)).filter(Boolean);

  /* Fail closed. A partial board is worse than none: it would play as an XI
     with fewer than eleven questions and score against a maximum that no
     longer applies. */
  if (questions.length !== wanted.ids.length || questions.length !== 11) {
    return noStore({ error: "that challenge is not available", source: "d1" }, 404);
  }

  return noStore({
    source: "d1",
    generatedAt: new Date().toISOString(),
    daily: { id: "XIQF-CHALLENGE", date: null, questions, bench },
    week: null,
  });
}

export const onRequestHead = onRequestGet;
