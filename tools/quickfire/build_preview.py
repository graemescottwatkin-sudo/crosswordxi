#!/usr/bin/env python3
"""Build a single-file preview of the SITE build.

    python3 tools/quickfire/build_preview.py

Writes preview/quickfire-preview.html — open it from disk, no server, no D1.

It is the real quickfire/ files, inlined, with one thing added: a stub that
answers /api/quickfire/* from a sample board held in this script. Nothing in
quickfire/ is edited or duplicated, so the preview cannot drift from the game —
if the engine changes, rebuild and the preview changes with it.

The preview carries a whole board in the file, which is exactly what the deploy
gate refuses in the game folder. That is why it is written to preview/ and why
preview/ belongs in .gitignore. Do not move it into quickfire/.
"""

import json
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parents[2]
GAME = ROOT / "quickfire"
OUT = ROOT / "preview" / "quickfire-preview.html"


def q(qid, answer, clue, answer_type, difficulty="medium", aliases=None):
    return {
        "id": qid, "answer": answer, "clue": clue,
        "answerType": answer_type, "difficulty": difficulty,
        "aliases": aliases or [],
    }


SAMPLE = {
    "source": "d1",
    "generatedAt": "2026-08-28T06:00:00Z",
    "daily": {
        "id": "XIQF-PREVIEW",
        "date": None,          # filled in by the stub, so it is always "today"
        "questions": [
            q(1, "Manchester United", "Treble winners in 1999", "club", "easy",
              ["Manchester Utd"]),
            q(2, "Alan Shearer", "Premier League record goalscorer", "player", "easy"),
            q(3, "Istanbul", "2005 Champions League final host city", "city"),
            q(4, "Arsene Wenger", "Manager of Arsenal's Invincibles", "manager", "easy",
              ["Arsène Wenger"]),
            q(5, "West Germany", "England's opponents in the 1966 World Cup final",
              "country", "easy"),
            q(6, "Kenny Dalglish", "Won the Premier League with Blackburn as manager",
              "manager"),
            q(7, "Signal Iduna Park", "Home stadium of Borussia Dortmund", "stadium"),
            q(8, "Diego Maradona", "Argentina captain who lifted the 1986 World Cup",
              "player", "easy"),
            q(9, "Everton", "Club nicknamed The Toffees", "club", "easy"),
            q(10, "Spain", "Country that won the 2010 World Cup", "country", "easy"),
            q(11, "Frank Lampard", "Former Chelsea midfielder nicknamed Super Frank",
               "player", "easy"),
        ],
        "bench": [
            q(12, "Paris Saint-Germain", "Ligue 1 club who play at the Parc des Princes",
              "club", "easy", ["Paris Saint Germain"]),
            q(13, "Brian Clough", "Won back-to-back European Cups with Nottingham Forest",
              "manager"),
            q(14, "Thierry Henry", "Arsenal's all-time leading goalscorer", "player", "easy"),
        ],
    },
    "week": {
        "weekEnding": None,    # filled in by the stub so the round is always live
        "label": "The Last 7 Days",
        "questions": [
            q(101, "Manchester United",
              "On 26 May 1999, which club scored twice in injury time to win the "
              "Champions League final?", "club", "easy"),
            q(102, "Harry Kane", "Who won the Golden Boot at the 2018 World Cup with six goals?",
               "player", "easy"),
            q(103, "Barcelona",
              "In March 2017, which club won 6-1 to overturn a four-goal first-leg deficit?",
               "club"),
            q(104, "David Moyes", "Who was appointed as Sir Alex Ferguson's successor in July 2013?",
               "manager"),
            q(105, "Leicester City", "In May 2016, which club were champions of England at odds of 5000-1?",
               "club", "easy"),
            q(106, "Chloe Kelly", "Who scored England's extra-time winner in the Euro 2022 final?",
               "player"),
            q(107, "Luton Town",
              "In May 2023, which club reached the Premier League nine years after "
              "playing non-league football?", "club"),
            q(108, "Lionel Messi", "Who lifted the World Cup in December 2022?", "player", "easy"),
            q(109, "Wembley", "Which stadium hosted the Euro 2020 final in July 2021?", "stadium"),
            q(110, "Zinedine Zidane", "Who was sent off in the 2006 World Cup final?", "player"),
            q(111, "Marcus Rashford",
              "Who scored twice on his senior club debut in the Europa League in February 2016?",
               "player"),
        ],
        "bench": [
            q(112, "Jamie Vardy", "Who scored in eleven consecutive Premier League games in 2015?",
               "player"),
            q(113, "Sarina Wiegman", "Who managed England to the Euro 2022 title?", "manager"),
            q(114, "Thierry Henry", "Arsenal's all-time leading goalscorer", "player", "easy"),
        ],
    },
}

STUB = """
<script>
/* PREVIEW ONLY — not part of the game.
 *
 * Answers /api/quickfire/* from a board held in this file so the page runs from
 * disk with no server and no database. Everything above this script is the real
 * quickfire/ source, inlined unchanged.
 *
 * Two things this preview cannot show you: whether the real endpoint returns
 * what the game expects, and whether the deploy landed. Those are live_check's
 * job and it needs the site.
 */
(function () {
  var BOARD = __SAMPLE__;
  var today = new Date();
  var iso = function (d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') +
           '-' + String(d.getDate()).padStart(2, '0');
  };
  BOARD.daily.date = iso(today);
  BOARD.week.weekEnding = iso(new Date(today.getTime() - 2 * 86400000));

  /* The stub cannot assume a real fetch exists — it runs in whatever the file
     is opened in, including a test harness that has none. */
  var realFetch = typeof window.fetch === 'function'
    ? window.fetch.bind(window)
    : function () { return Promise.reject(new Error('no network in the preview')); };
  window.fetch = function (input, init) {
    var url = String(input);
    /* A hand-rolled reply rather than `new Response`. The preview has to run in
       whatever opens it, and not every environment that has fetch also has the
       Response constructor. */
    function reply(payload) {
      return Promise.resolve({
        ok: true, status: 200,
        json: function () { return Promise.resolve(payload); },
        text: function () { return Promise.resolve(JSON.stringify(payload)); },
        headers: { get: function () { return 'no-store'; } },
      });
    }
    if (url.indexOf('/api/quickfire/challenge') === 0) {
      /* A challenge link in the preview replays the same board, so the flow can
         be seen. The real endpoint checks every id against played boards. */
      return reply({ source: 'd1', daily: BOARD.daily, week: null });
    }
    if (url.indexOf('/api/quickfire/daily') === 0) {
      return reply(BOARD);
    }
    return realFetch(input, init);
  };

  var flag = document.createElement('p');
  flag.textContent = 'Preview build — sample questions, stubbed API, no database.';
  flag.style.cssText = 'margin:0 0 10px;padding:8px 10px;border:1px dashed #6E5220;' +
    'border-radius:8px;font:0.72rem ui-monospace,monospace;color:#F0A32C;' +
    'letter-spacing:0.08em;text-transform:uppercase';
  document.addEventListener('DOMContentLoaded', function () {
    var main = document.querySelector('main');
    if (main) main.insertBefore(flag, main.firstChild);
  });
})();
</script>
"""

CHROME = """
<style>
/* PREVIEW ONLY — a plain stand-in for the shared chrome, which lives in the
   monorepo. Enough to hold the page's shape; not the real bar or footer. */
body { margin: 0; background: #0D1418; }
.xic-bar, .xic-foot {
  min-height: 34px; background: #0A1013; border-bottom: 1px solid #253238;
}
.xic-foot { border: 0; border-top: 1px solid #253238; margin-top: 24px; }
</style>
"""


def main():
    html = (GAME / "index.html").read_text(encoding="utf-8")
    css = (GAME / "css/style.css").read_text(encoding="utf-8")

    scripts = re.findall(r'<script src="(js/[^"?]+)\?v=[^"]*"></script>', html)
    if not scripts:
        raise SystemExit("no game scripts found in index.html — has the page changed shape?")

    html = re.sub(r'<link rel="stylesheet" href="css/style\.css\?v=[^"]*">',
                  "<style>\n" + css + "\n</style>", html)
    # The real shared layer, inlined — so the preview shows the family's actual
    # palette, bar and footer rather than a stand-in that flatters the game.
    for rel in re.findall(r'<link rel="stylesheet" href="\.\./(shared/[^"?]+)\?v=[^"]*">', html):
        shared = (ROOT / rel).read_text(encoding="utf-8")
        html = re.sub(r'<link rel="stylesheet" href="\.\./' + re.escape(rel) + r'\?v=[^"]*">',
                      lambda _m, b=shared: "<style>\n" + b + "\n</style>", html)
    for rel in re.findall(r'<script src="\.\./(shared/[^"?]+)\?v=[^"]*"></script>', html):
        shared = (ROOT / rel).read_text(encoding="utf-8")
        html = re.sub(r'<script src="\.\./' + re.escape(rel) + r'\?v=[^"]*"></script>',
                      lambda _m, b=shared: "<script>\n" + b + "\n</script>", html)

    for src in scripts:
        body = (GAME / src).read_text(encoding="utf-8")
        html = re.sub(r'<script src="' + re.escape(src) + r'\?v=[^"]*"></script>',
                      lambda _m, b=body: "<script>\n" + b + "\n</script>", html)

    stub = STUB.replace("__SAMPLE__", json.dumps(SAMPLE, ensure_ascii=False))
    # BEFORE the game scripts, not at the end of the body. game.js fetches the
    # board the moment it parses, so a stub installed after it never runs — the
    # first preview did exactly that and went to the real endpoint.
    html = html.replace("</head>", stub + "</head>")

    leftovers = re.findall(r'(?:src|href)="((?!https?:|data:|#)[^"]+)"', html)
    if leftovers:
        raise SystemExit("the preview still references local files: " + ", ".join(leftovers))

    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(html, encoding="utf-8")
    print(f"Wrote {OUT.relative_to(ROOT)}  ({len(html) // 1024} KB)")
    print(f"Inlined {len(scripts)} scripts and the stylesheet.")
    print("Sample only. preview/ belongs in .gitignore.")


if __name__ == "__main__":
    main()
