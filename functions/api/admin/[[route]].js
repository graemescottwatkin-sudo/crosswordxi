/* functions/api/admin/[[route]].js — the owner's tools.
 *
 * Every route here checks the admin flag on the server, on every request. The
 * browser is told whether to show the panel, but that is a convenience: hiding
 * a button is not access control, and the panel could be conjured up by anyone
 * with a console. The gate is here.
 *
 * The flag is set by hand in the database. Nothing in this file grants it, and
 * no endpoint anywhere writes it — an account cannot promote itself.
 */
import { json, bad } from "../../_lib/puzzle.js";
import { hasDB, serverToday } from "../../_lib/db.js";
import { currentUser, csrfOk, newId } from "../../_lib/auth.js";
import { dailyNumber, dailyKey } from "../../_lib/daily.js";
import { validPlayGame, reportableGames } from "../../_lib/games.js";

async function requireAdmin(request, env) {
  if (!hasDB(env)) return { error: bad("Accounts are not configured.", 503) };
  const user = await currentUser(request, env);
  if (!user) return { error: bad("Not signed in.", 401) };
  /* Not "is the flag truthy in something the browser sent" — the row, read
     fresh, every time. */
  if (!user.is_admin) return { error: bad("Not found.", 404) };
  return { user };
}

export async function onRequest({ request, env, params }) {
  const route = (params.route || []).join("/");

  /* Whether to show the panel at all. Deliberately answers for everyone —
     false for anyone who is not an admin — so the shape of the response gives
     nothing away. */
  if (route === "whoami" && request.method === "GET") {
    if (!hasDB(env)) return json({ admin: false });
    const user = await currentUser(request, env);
    const admin = !!(user && user.is_admin);
    /* The games the funnel can report on, sent with the flag that decides
       whether the panel appears at all, so the selector is built from the
       server rather than typed into the page. It was typed into the page,
       and it listed three games while five were being counted. Only to an
       admin: the list names games that have not launched. */
    return json(admin ? { admin: true, games: reportableGames() } : { admin: false });
  }

  const gate = await requireAdmin(request, env);
  if (gate.error) return gate.error;
  const me = gate.user;

  if (request.method !== "GET" && !csrfOk(request)) {
    return bad("Missing request header.", 403);
  }

  /* ---- What is in the database ---- */
  if (route === "summary" && request.method === "GET") {
    /* Bound parameters, not interpolation — even for an id that came from our
       own database. The first version of this built the user id into the SQL
       string, which is safe here and a bad habit anywhere. */
    const one = async (sql, ...binds) => {
      try {
        const stmt = env.DB.prepare(sql);
        const r = await (binds.length ? stmt.bind(...binds) : stmt).first();
        return r ? Object.values(r)[0] : null;
      } catch (e) { return null; }
    };
    return json({
      today: dailyNumber(),
      users: await one("SELECT COUNT(*) AS n FROM users"),
      results: await one("SELECT COUNT(*) AS n FROM results"),
      myResults: await one("SELECT COUNT(*) AS n FROM results WHERE user_id = ?", me.id),
      reports: await one("SELECT COUNT(*) AS n FROM clue_reports"),
      clues: await one("SELECT COUNT(*) AS n FROM clues"),
      dailies: await one("SELECT COUNT(*) AS n FROM puzzles WHERE mode = 'daily'"),
      lastDay: await one("SELECT MAX(daily_no) AS n FROM puzzles WHERE mode = 'daily'"),
      themeBoards: await one("SELECT COUNT(*) AS n FROM theme_boards"),
      themeNext: await one(
        "SELECT MIN(release_on) AS n FROM theme_boards WHERE release_on > date('now')"),
      themeRequests: await one("SELECT COUNT(*) AS n FROM theme_requests"),
    });
  }

  /* ---- Any stored daily, for the owner only ----
     /api/daily deliberately serves today and nothing else, and reveal and check
     refuse a token for another day. That guard stays exactly as it is: this is
     a separate route behind the admin gate, not a loosening of it. Without it
     the Matchday 1 changeover could not be seen until September. */
  if (route === "daily" && request.method === "GET") {
    const url = new URL(request.url);
    const n = parseInt(url.searchParams.get("n") || "", 10);
    if (!Number.isInteger(n) || n < 1) return bad("Give a day number.");
    const row = await env.DB
      .prepare("SELECT payload FROM puzzles WHERE mode = 'daily' AND daily_no = ? LIMIT 1")
      .bind(n).first();
    if (!row) return bad(`No daily puzzle stored for day ${n}.`, 404);
    const stored = JSON.parse(row.payload);
    const { publicPuzzle: strip } = await import("../../_lib/puzzle.js");
    return json({
      mode: "daily", dailyNo: n, token: `daily:${n}`,
      puzzle: strip(stored.puzzle), preview: true,
    });
  }


  /* ---- Any Scrambled board, for proofing ----
     The public route serves the past and today and refuses the future — "the
     future is shut, because opening it gives away everything" — which is right
     for players and useless for reviewing 262 boards four days in. Weakening
     that guard would hand the schedule to everyone; this is the answer the
     crossword's ?n= preview already gives, admin-checked on the server on every
     request.

     ADDRESSED BY BOARD ID, not by position in the ring. Ring position is a
     function of which boards are daily-eligible, so it moves the day a board is
     added or taken out of rotation, and a proofing link that points at a
     different board next week is worse than no link. The id is the board.

     Redacted the same way as the public route: publicBoard(), not the stored
     row. Proofing is about the board as it PLAYS; an owner wanting the names
     has the tester and its answer key. */
  if (route === "scrambled" && request.method === "GET") {
    const url = new URL(request.url);
    /* ?list=1 — ids and titles only, so the owner's picker has something to
       populate from. Deliberately NOT the boards: a list that carried slots
       would be the whole bank in one response, and the point of the preview
       route is proofing one board at a time. Titles are already public on the
       start card of any board that has come round. */
    if (url.searchParams.get("list")) {
      const { loadBoards, dailyRing } = await import("../../_lib/sc-board.js");
      const { boards, source } = await loadBoards(env);
      const ring = new Set(dailyRing(boards).map((b) => b.id));
      return json({
        source,
        boards: (boards || []).map((b) => ({
          id: b.id, title: b.title, daily: ring.has(b.id),
        })),
      });
    }
    const id = parseInt(url.searchParams.get("id") || "", 10);
    if (!Number.isInteger(id) || id < 1) return bad("Give a board id.");
    const { loadBoards, publicBoard, previewKey } = await import("../../_lib/sc-board.js");
    const { boards, source } = await loadBoards(env);
    const board = (boards || []).find((b) => Number(b.id) === id);
    if (!board) return bad(`No board with id ${id}.`, 404);
    /* previewKey, not scKey: the play endpoints must be able to tell a
       preview from a daily, and resolve it by id rather than ring position.
       Passed as the TOKEN, with no ring position at all — handing it in as
       `no` left publicBoard to wrap it in a second "sc:" and the play routes
       refused every guess. A board off the ring has no number; saying so is
       the honest answer and the one the page can display. */
    return json({ ...publicBoard(board, null, previewKey(id)), id, source, preview: true });
  }
  /* ---- Forget one day, so it can be played again ----
     Separate from clearing the record: this removes a single day's result so
     the same puzzle can be replayed, which is the thing wanted twenty times
     over a month of testing. */
  if (route === "replay-day" && request.method === "POST") {
    let body = {};
    try { body = await request.json(); } catch (e) { return bad("Expected a JSON body."); }
    const n = parseInt(body.dailyNo, 10);
    if (!Number.isInteger(n) || n < 1) return bad("Give a day number.");
    /* game = 'crossword': this route takes a DAY NUMBER, which is a crossword
       idea. Unqualified it would have deleted any row whose daily_no happened
       to match — word search rows carry NULL there today, but a future game
       that reuses the column would silently lose rows to a crossword tool. */
    await env.DB.prepare("DELETE FROM results WHERE user_id = ? AND game = 'crossword' AND daily_no = ?")
      .bind(me.id, n).run();
    return json({ ok: true, dailyNo: n });
  }

  /* ---- How far people got ----
     Started, finished, and how many clues the ones who stopped had solved.
     "142 started, 12 finished" and "40 started, 38 finished" are different
     problems, and the median clues solved says which. */
  if (route === "plays" && request.method === "GET") {
    /* A window in hours, not a row cap.

       It was `ORDER BY started_at DESC LIMIT 2000`, which is not a period at
       all: 2000 rows is about a fortnight at today's rate and a couple of days
       once a post lands. The same number meant a different span every week,
       which is worse than a number that means nothing — "50 finished" reads as
       recent and could be a month old.

       72 hours by default, because the traffic here arrives in bursts from a
       post and a three-day window covers one without blurring it into the last.
       ?hours= overrides it; the CSV export is unwindowed and goes to 20,000
       rows, which is where a longer look belongs. */
    const url = new URL(request.url);
    const asked = Number(url.searchParams.get("hours"));
    const hours = Number.isFinite(asked) && asked > 0 && asked <= 24 * 365
      ? Math.floor(asked) : 72;
    /* WHICH GAME, or the whole family. Every game counts through the same
       route now; ?game= narrows the funnel, absent means all of them, and a
       name the server does not list is a 400 rather than an empty report
       that looks like nobody played. */
    const gameAsked = url.searchParams.get("game");
    const game = gameAsked ? validPlayGame(gameAsked) : null;
    if (gameAsked && !game) return json({ error: "Unknown game." }, 400);
    const rows = await env.DB.prepare(
      `SELECT game, board_key, mode, daily_no, phase, solved, total, completed, elapsed_secs,
              ended_at, theme_key, by_owner
         FROM plays
        WHERE started_at > datetime('now', ?) AND (? IS NULL OR game = ?)
        ORDER BY started_at DESC LIMIT 5000`).bind("-" + hours + " hours", game, game).all();
    const byDay = new Map();
    /* The owner's own testing, counted separately. Twenty passes over a layout
       is not twenty people, and while the site is being built most rows are
       his — so the headline is visitors and his are reported alongside rather
       than deleted, since they are still the only record of what was tried. */
    let ownerPlays = 0, ownerFinished = 0;
    for (const r of rows.results || []) {
      if (r.by_owner) {
        ownerPlays++;
        if (r.completed) ownerFinished++;
        continue;
      }
      /* Themed boards group by board, not into one heap. Which board gets
         played is the whole question: they are the ones passed between
         friends, so "Bolton #1 thirty times, #4 twice" is the answer worth
         being able to read. */
      /* Grouped by game and board. The crossword's rows from before the
         board_key column carry only their daily number or theme slug, so
         those compose the key the old way; every newer row has its own. */
      const g = r.game || "crossword";
      const board = r.board_key
        || (r.mode === "daily" ? dailyKey(r.daily_no)
          : r.mode === "theme" ? "theme:" + (r.theme_key || "unknown")
          : "practice");
      const key = g + "/" + board;
      if (!byDay.has(key)) {
        byDay.set(key, { key, game: g, boardKey: board, mode: r.mode, dailyNo: r.daily_no, phase: r.phase,
                         themeKey: r.theme_key || null,
                         started: 0, finished: 0, times: [], stops: [] });
      }
      const d = byDay.get(key);
      d.started++;
      if (r.completed) { d.finished++; if (r.elapsed_secs) d.times.push(r.elapsed_secs); }
      else if (r.ended_at !== null) d.stops.push(r.solved || 0);
      d.total = r.total || d.total;
    }
    const mid = (a) => {
      if (!a.length) return null;
      const s = [...a].sort((x, y) => x - y);
      return s[Math.floor(s.length / 2)];
    };
    const days = [...byDay.values()].map((d) => ({
      key: d.key, game: d.game, boardKey: d.boardKey, mode: d.mode, dailyNo: d.dailyNo, phase: d.phase,
      themeKey: d.themeKey,
      started: d.started, finished: d.finished, total: d.total,
      medianSeconds: mid(d.times),
      /* Where the ones who gave up had got to. A median of 2 of 11 says the
         puzzle loses people at the start; 9 of 11 says it loses them at the
         end, and those want different fixes. */
      medianSolvedWhenStopped: mid(d.stops),
      abandoned: d.stops.length,
    })).sort((a, b) => (b.dailyNo || 0) - (a.dailyNo || 0));
    /* The window is reported, not implied. A panel showing "50 finished" with
       no period is a number nobody can act on. */
    return json({ ownerPlays, ownerFinished, days, hours });
  }

  /* ---- Clear my own record ---- */
  if (route === "reset-my-record" && request.method === "POST") {
    await env.DB.prepare("DELETE FROM results WHERE user_id = ?").bind(me.id).run();
    return json({ ok: true, cleared: true });
  }

  /* ---- What players have asked for ----
     The whole point of collecting requests is the ordering, so this returns a
     tally rather than a list of rows. Counts stay owner-only for now: "24
     people have asked for Villa" is a reason to come back, and "2 people have
     asked for Villa" is a reason not to. */
  if (route === "theme-requests" && request.method === "GET") {
    const rows = await env.DB.prepare(
      `SELECT r.theme_key, COUNT(*) AS n,
              MAX(r.created_at) AS latest,
              SUM(CASE WHEN r.status = 'open' THEN 1 ELSE 0 END) AS open_n,
              MAX(r.status) AS status,
              /* Delivered is computed, not stored: a request is answered when a
                 board for that theme is out, and asking the schedule is always
                 right where a flag written at release time can go stale. */
              (SELECT COUNT(*) FROM theme_boards b
                WHERE b.theme_id = r.theme_key AND b.release_on <= date('now')) AS live_boards,
              t.name AS existing
         FROM theme_requests r
         LEFT JOIN themes t ON t.id = r.theme_key
        GROUP BY r.theme_key
        ORDER BY n DESC, latest DESC
        LIMIT 200`).all();
    return json({ requests: rows.results || [] });
  }

  /* Mark a theme request done or declined. The queue is only useful if it can
     be emptied: a tally of everything ever asked answers "what has been asked",
     and what you want to read is "what should I write next". */
  if (route === "theme-request-status" && request.method === "POST") {
    let body;
    try { body = await request.json(); } catch (e) { return bad("Expected a JSON body."); }
    const key = String(body.key || "").toLowerCase().slice(0, 40);
    if (!/^[a-z0-9][a-z0-9-]*$/.test(key)) return bad("Name a theme.");
    const status = ["open", "done", "declined"].indexOf(String(body.status)) === -1
      ? null : String(body.status);
    if (!status) return bad("Status must be open, done or declined.");
    await env.DB.prepare(
      `UPDATE theme_requests
          SET status = ?, reviewed_at = CASE WHEN ? = 'open' THEN NULL ELSE datetime('now') END
        WHERE theme_key = ?`).bind(status, status, key).run();
    return json({ ok: true, key, status });
  }

  /* ---- Flagged clues ---- */
  if (route === "reports" && request.method === "GET") {
    const url = new URL(request.url);
    const all = url.searchParams.get("all") === "1";
    const rows = await env.DB.prepare(
      `SELECT r.id, r.game, r.clue_id, r.reason, r.puzzle, r.created_at, r.status,
              c.clue, c.answer, c.category, c.enumeration, c.era, c.difficulty
         FROM clue_reports r
         LEFT JOIN clues c ON c.id = r.clue_id AND r.game = 'crossword'
        ${all ? "" : "WHERE r.status = 'open'"}
        ORDER BY r.created_at DESC LIMIT 500`).all();
    return json({ reports: rows.results || [] });
  }

  /* ---- The same thing as a file ----
     Reading forty reports twelve at a time on a phone and retyping them into a
     spreadsheet is the kind of friction that means it does not get done. */
  /* Every attempt, one row each — not the per-board summary the panel shows.
     "Somebody started Bolton #2 and got 7 of 11" is a row here; the summary
     can only say how many did. No identity in it, because there is none in the
     table: the reference is per board, so 000001 on the daily and 000001 on a
     themed board are not the same person. */
  /* How each source performed. The board funnel answers "which puzzles get
     played"; this answers "which places send people who play them" — and they
     are deliberately different questions, because somebody on the Arsenal board
     may have arrived from anywhere. */
  if (route === "sources" && request.method === "GET") {
    /* One game or the family, the same as the funnel above. */
    const gameAsked = new URL(request.url).searchParams.get("game");
    const game = gameAsked ? validPlayGame(gameAsked) : null;
    if (gameAsked && !game) return json({ error: "Unknown game." }, 400);
    const rows = await env.DB.prepare(
      `SELECT COALESCE(utm_source, '(direct)') AS source,
              COALESCE(utm_campaign, '') AS campaign,
              COALESCE(utm_content, '') AS community,
              COUNT(*) AS started,
              SUM(completed) AS finished,
              SUM(solved) AS solved,
              SUM(total) AS answers,
              AVG(elapsed_secs) AS avg_secs
         FROM plays
        WHERE by_owner = 0 AND (? IS NULL OR game = ?)
        GROUP BY source, campaign, community
        ORDER BY started DESC
        LIMIT 200`).bind(game, game).all();
    return json({ sources: (rows.results || []).map((r) => ({
      source: r.source, campaign: r.campaign, community: r.community,
      started: r.started, finished: r.finished || 0,
      /* The quality signal the whole exercise is for: a source sending twice as
         many people who finish half as often is not the better source. */
      completionPct: r.started ? Math.round((100 * (r.finished || 0)) / r.started) : 0,
      solvedPct: r.answers ? Math.round((100 * r.solved) / r.answers) : 0,
      avgMinutes: r.avg_secs ? Math.round(r.avg_secs / 60) : 0,
    })) });
  }

  /* Every challenge, with how it is going. The tables are public to anybody
     holding a link, so this adds no exposure — what it adds is the owner being
     able to see the whole picture rather than one link at a time. */
  if (route === "challenges" && request.method === "GET") {
    const rows = await env.DB.prepare(
      `SELECT c.id, c.theme_id, c.board_no, c.creator_name, c.group_name,
              c.created_at, c.hidden,
              (SELECT COUNT(*) FROM challenge_starts s WHERE s.challenge_id = c.id) AS started,
              (SELECT COUNT(*) FROM challenge_entries e
                WHERE e.challenge_id = c.id AND e.hidden = 0) AS finished,
              (SELECT MAX(score) FROM challenge_entries e
                WHERE e.challenge_id = c.id AND e.hidden = 0) AS best
         FROM challenges c
        ORDER BY c.created_at DESC LIMIT 200`).all();
    return json({ challenges: rows.results || [] });
  }

  /* Take a name off a page without losing the record of it. The only remedy
     when somebody types something that should not be published, and the reason
     entries carry a hidden flag rather than being deleted. */
  if (route === "challenge-hide" && request.method === "POST") {
    let body;
    try { body = await request.json(); } catch (e) { return bad("Expected a JSON body."); }
    const hide = body.hidden ? 1 : 0;
    if (body.entryId) {
      await env.DB.prepare("UPDATE challenge_entries SET hidden = ? WHERE id = ?")
        .bind(hide, String(body.entryId)).run();
    } else if (body.id) {
      await env.DB.prepare("UPDATE challenges SET hidden = ? WHERE id = ?")
        .bind(hide, String(body.id)).run();
    } else {
      return bad("Name a challenge or an entry.");
    }
    return json({ ok: true, hidden: hide });
  }

  /* Board of the day: what is set, and what could be.
     Returns every released, listed board so the picker has something to choose
     from without a second request. */
  /* Every attempt at one board, ranked. Admin only.
     
     What this can and cannot answer is worth being clear about: plays are
     anonymous by design — play_id is random per attempt, so two goes by one
     visitor are indistinguishable from two visitors, and there is no name to
     show. This ranks scores and times, not people. Where somebody signed in or
     entered a challenge there IS a name, and those are joined in below; for
     everybody else the row is a score and nothing more.
     
     Not scoped to today, unlike the public one: this is for looking at how a
     board plays over its life, which is the opposite question. */
  if (route === "board-scores" && request.method === "GET") {
    try {
      const url = new URL(request.url);
      const theme = String(url.searchParams.get("theme") || "").trim();
      const no = Number(url.searchParams.get("no") || 0);
      if (!theme || !no) return bad("Name a board.");
      const key = theme + "-" + no;

      /* plays only. An earlier version joined results to put a name on each
         row, and results has no theme_key — it keys on puzzle_token — so the
         query would simply have thrown, which in a Pages function reaches the
         browser as an HTML error page rather than anything readable.

         Dropped rather than repaired, because the repair was not worth it: a
         user who replays has two results rows, so joining on token alone
         multiplies the play rows, and joining on time as well is guesswork.
         Names live in challenge_entries, where somebody typed one on purpose.
         This answers how a board plays, not who played it. */
      const rows = await env.DB.prepare(
      /* srv_elapsed_secs, not elapsed_secs.

         elapsed_secs is the browser's own figure, posted by the pagehide
         beacon: forgeable, and NULL when the beacon never arrived — which
         SQLite sorts FIRST ascending, so a lost beacon won the tie-break
         outright. srv_elapsed_secs is the clock /api/finish scored on.

         COALESCE keeps rows written before migration 017 orderable rather than
         floating to the top; they fall back to the old figure. */
        `SELECT srv_score AS score,
                COALESCE(srv_elapsed_secs, elapsed_secs) AS secs, started_at,
                solved, total, completed, by_owner,
                srv_checks, srv_check_alls,
                srv_reveal_letters, srv_reveal_answers
           FROM plays
          WHERE theme_key = ?
          ORDER BY completed DESC, srv_score DESC, COALESCE(srv_elapsed_secs, elapsed_secs) ASC
          LIMIT 200`).bind(key).all();

      const all = rows.results || [];
      const done = all.filter((r) => r.completed && !r.by_owner);
      return json({
        theme, no,
        started: all.filter((r) => !r.by_owner).length,
        finished: done.length,
        mine: all.filter((r) => r.by_owner).length,
        median: done.length
          ? done.map((r) => r.score).sort((a, b) => a - b)[Math.floor(done.length / 2)]
          : null,
        rows: all,
      });
    } catch (e) {
      return bad("Board scores: " + (e && e.message || "failed"), 500);
    }
  }

  if (route === "featured" && request.method === "GET") {
    try {
    const today = serverToday();
    let set = [];
    try {
      const r = await env.DB.prepare(
        `SELECT f.on_date, f.board_id, f.note, t.name, b.board_no
           FROM featured_override f
           JOIN theme_boards b ON b.id = f.board_id
           JOIN themes t ON t.id = b.theme_id
          WHERE f.on_date >= ?
          ORDER BY f.on_date`).bind(today).all();
      set = r.results || [];
    } catch (e) { /* table not migrated yet */ }
    const opts = await env.DB.prepare(
      `SELECT b.id, b.board_no, t.name, t.club_id
         FROM theme_boards b JOIN themes t ON t.id = b.theme_id
        WHERE b.release_on <= ? AND b.listed = 1
        ORDER BY t.name, b.board_no`).bind(today).all();
    return json({ today, set, boards: opts.results || [] });
    } catch (e) { return bad("Board of the day: " + (e && e.message || "failed"), 500); }
  }

  if (route === "featured-set" && request.method === "POST") {
    try {
    let body;
    try { body = await request.json(); } catch (e) { return bad("Expected a JSON body."); }
    const date = String(body.date || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return bad("Give a date as YYYY-MM-DD.");

    /* Clearing is its own case rather than a board id of zero: the cycle
       resuming is a different thing from choosing a board, and conflating them
       is how you end up unable to undo. */
    if (body.clear) {
      await env.DB.prepare("DELETE FROM featured_override WHERE on_date = ?").bind(date).run();
      return json({ ok: true, cleared: date });
    }

    const boardId = Number(body.boardId);
    if (!boardId) return bad("Name a board.");

    /* Checked here as well as when it is read. Refusing an unreleased board at
       the point somebody sets it gives them an error they can act on; catching
       it only at read time means the override silently does nothing and looks
       like the feature is broken. */
    const ok = await env.DB.prepare(
      "SELECT id FROM theme_boards WHERE id = ? AND listed = 1 AND release_on <= ?")
      .bind(boardId, serverToday()).first();
    if (!ok) return bad("That board is not released, or is not listed.");

    /* Delete then insert, rather than an upsert.

       ON CONFLICT ... DO UPDATE threw on the second set for a date — the first
       inserted cleanly and every one after hit the conflict path — and an
       uncaught throw in a Pages function comes back as an HTML error page, so
       the browser reported "Unexpected token '<'" rather than anything about
       the query. Two plain statements in one batch are atomic, obvious, and
       have nothing to be clever about. */
    await env.DB.batch([
      env.DB.prepare("DELETE FROM featured_override WHERE on_date = ?").bind(date),
      env.DB.prepare("INSERT INTO featured_override (on_date, board_id, note) VALUES (?, ?, ?)")
        .bind(date, boardId, String(body.note || "").slice(0, 200) || null),
    ]);
    return json({ ok: true, date, boardId });
    } catch (e) {
      /* Anything unhandled here used to reach the browser as an HTML error
         page. A JSON message the panel can print is the difference between a
         fixable report and "Unexpected token '<'". */
      return bad("Could not set it: " + (e && e.message || "unknown"), 500);
    }
  }

  if (route === "plays.csv" && request.method === "GET") {
    /* One game or the family; a Game column and the board's own key either
       way, so a family export can be split in a spreadsheet and a one-game
       export reads the same. */
    const gameAsked = new URL(request.url).searchParams.get("game");
    const game = gameAsked ? validPlayGame(gameAsked) : null;
    if (gameAsked && !game) return json({ error: "Unknown game." }, 400);
    const rows = await env.DB.prepare(
      `SELECT started_at, ended_at, game, board_key, mode, daily_no, theme_key, phase,
              play_no, solved, total, completed, elapsed_secs, checks,
              /* The split columns, not the legacy merged 'reveals'. A letter
                 costs +3' and an answer +14', so eleven of one and eleven of
                 the other differ by 33 minutes — merged, the table could not
                 say which it was looking at. Line ~370 in this same file read
                 the split correctly the whole time. Falls back to the merged
                 figure for rows from before migration 014, shown as letters,
                 which is the conservative reading. */
              COALESCE(srv_reveal_letters, reveals, 0) AS reveal_letters,
              COALESCE(srv_reveal_answers, 0) AS reveal_answers,
              by_owner, utm_source, utm_medium, utm_campaign, utm_content,
              utm_term, referrer
         FROM plays WHERE (? IS NULL OR game = ?) ORDER BY started_at DESC LIMIT 20000`).bind(game, game).all();
    const esc = (v) => '"' + String(v == null ? "" : v).replace(/"/g, '""') + '"';
    const head = ["Started", "Ended", "Game", "Board key", "Mode", "Board", "Reference", "Solved",
                  "Of", "Finished", "Seconds", "Checks",
                  "Reveal letters", "Reveal answers", "Owner test",
                  "Source", "Medium", "Campaign", "Content", "Term", "Referrer"];
    const lines = [head.map(esc).join(",")];
    for (const r of rows.results || []) {
      const board = r.mode === "daily" ? "#" + r.daily_no
                  : r.mode === "theme" ? (r.theme_key || "") : "practice";
      lines.push([
        r.started_at, r.ended_at || "", r.game || "crossword", r.board_key || "", r.mode, board,
        r.play_no ? String(r.play_no).padStart(6, "0") : "",
        r.solved, r.total, r.completed ? "yes" : "no",
        r.elapsed_secs, r.checks, r.reveal_letters, r.reveal_answers,
        r.by_owner ? "yes" : "",
        r.utm_source || "", r.utm_medium || "", r.utm_campaign || "",
        r.utm_content || "", r.utm_term || "", r.referrer || "",
      ].map(esc).join(","));
    }
    return new Response(lines.join("\n"), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="thexigames-plays${game ? "-" + game : ""}-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  }

  if (route === "reports.csv" && request.method === "GET") {
    const url = new URL(request.url);
    const all = url.searchParams.get("all") === "1";
    const rows = await env.DB.prepare(
      `SELECT r.id, r.game, r.clue_id, r.reason, r.puzzle, r.created_at, r.status,
              c.clue, c.answer, c.category, c.enumeration, c.era, c.difficulty
         FROM clue_reports r
         LEFT JOIN clues c ON c.id = r.clue_id AND r.game = 'crossword'
        ${all ? "" : "WHERE r.status = 'open'"}
        ORDER BY r.created_at DESC LIMIT 2000`).all();
    /* Quote everything and double any quote inside. Clue text contains commas
       and apostrophes as a matter of course. */
    const esc = (v) => '"' + String(v === null || v === undefined ? "" : v).replace(/"/g, '""') + '"';
    const head = ["Report id", "Clue id", "Category", "Clue", "Answer",
                  "Enumeration", "Era", "Difficulty", "Reason", "Puzzle",
                  "Flagged", "Status"];
    const lines = [head.map(esc).join(",")];
    /* The owner's own testing, counted separately. Twenty passes over a layout
       is not twenty people, and while the site is being built most rows are
       his — so the headline is visitors and his are reported alongside rather
       than deleted, since they are still the only record of what was tried. */
    let ownerPlays = 0, ownerFinished = 0;
    for (const r of rows.results || []) {
      if (r.by_owner) {
        ownerPlays++;
        if (r.completed) ownerFinished++;
        continue;
      }
      lines.push([r.id, r.clue_id, r.category, r.clue, r.answer, r.enumeration,
                  r.era, r.difficulty, r.reason, r.puzzle, r.created_at, r.status]
        .map(esc).join(","));
    }
    return new Response(lines.join("\r\n"), { headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="crosswordxi-flagged-${new Date().toISOString().slice(0, 10)}.csv"`,
      "Cache-Control": "no-store",
    } });
  }

  /* ---- Mark as dealt with ---- */
  if (route === "reports/reviewed" && request.method === "POST") {
    let body = {};
    try { body = await request.json(); } catch (e) {}
    const now = new Date().toISOString();
    if (body.id) {
      await env.DB.prepare(
        "UPDATE clue_reports SET status = ?, reviewed_at = ? WHERE id = ?")
        .bind(body.open ? "open" : "done", now, String(body.id)).run();
      return json({ ok: true, id: body.id });
    }
    /* Everything currently open. The button says how many it will close, so
       this cannot quietly clear something that arrived while you were reading. */
    const res = await env.DB.prepare(
      "UPDATE clue_reports SET status = 'done', reviewed_at = ? WHERE status = 'open'")
      .bind(now).run();
    return json({ ok: true, closed: res.meta ? res.meta.changes : null });
  }

  if (route === "reports/clear" && request.method === "POST") {
    let body = {};
    try { body = await request.json(); } catch (e) {}
    if (body.id) {
      await env.DB.prepare("DELETE FROM clue_reports WHERE id = ?").bind(String(body.id)).run();
    } else {
      await env.DB.prepare("DELETE FROM clue_reports").run();
    }
    return json({ ok: true });
  }

  /* ---- Archive a clue without a deploy ---- */
  if (route === "archive-clue" && request.method === "POST") {
    let body = {};
    try { body = await request.json(); } catch (e) { return bad("Expected a JSON body."); }
    const id = String(body.clueId || "").slice(0, 40);
    if (!id) return bad("No clue id.");
    const on = body.archive !== false;
    await env.DB.prepare("UPDATE clues SET max_per = ? WHERE id = ?")
      .bind(on ? 0 : 1, id).run();
    /* Only affects puzzles generated from here on: the stored ones already
       contain the clue. Say so rather than imply it has vanished. */
    return json({ ok: true, clueId: id, archived: on,
      note: "Applies to puzzles generated from now on. Puzzles already stored still contain it." });
  }

  return bad("Not found.", 404);
}
