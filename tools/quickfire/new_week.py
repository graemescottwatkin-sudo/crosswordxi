#!/usr/bin/env python3
"""Stamp out a blank topical week ready to fill in.

    python3 tools/new_week.py                 # week ending next Sunday
    python3 tools/new_week.py 2026-08-30      # a specific week ending

Writes a skeleton to data/weeks/<date>.json, picking eleven themes suited to the
time of year from the pool in weekly-topical.json. Fill in the answers and clues, then run:

    python3 tools/merge_week.py data/weeks/<date>.json

Deliberately not automatic. Topical content is the one part of this game that
cannot be checked by a script — a wrong transfer rumour makes the quiz wrong for
everybody who plays it that week.
"""

import datetime as dt
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
WEEKLY = ROOT / "data/weekly-topical.json"


def next_sunday(today=None):
    today = today or dt.date.today()
    ahead = (6 - today.weekday()) % 7 or 7
    return today + dt.timedelta(days=ahead)


def pick_themes(weekly, week_ending):
    """Eleven themes suited to the time of year.

    Anchors always go in. Seasonal themes only appear in their months, and take
    priority over filler when they apply. The rest rotate week to week so two
    consecutive weeks don't come out the same shape.
    """
    themes = {t["id"]: t for t in weekly["themes"]}
    month = int(week_ending.split("-")[1])
    ordinal = dt.date.fromisoformat(week_ending).isocalendar()[1]

    def in_season(t):
        return "months" not in t or month in t["months"]

    chosen = [themes[i] for i in weekly["anchorThemes"]]
    taken = {t["id"] for t in chosen}

    def add_from(group, limit):
        pool = [t for t in weekly["themes"]
                if t["frequency"] == group and t["id"] not in taken and in_season(t)]
        if not pool:
            return
        start = ordinal % len(pool)
        rotated = pool[start:] + pool[:start]
        for t in rotated[:limit]:
            if len(chosen) >= weekly["questionsPerWeek"]:
                return
            chosen.append(t)
            taken.add(t["id"])

    add_from("seasonal", 2)
    add_from("common", weekly["questionsPerWeek"] - len(chosen))
    add_from("occasional", weekly["questionsPerWeek"] - len(chosen))
    return chosen[:weekly["questionsPerWeek"]]


def main():
    weekly = json.loads(WEEKLY.read_text(encoding="utf-8"))

    if len(sys.argv) > 1:
        week_ending = sys.argv[1]
        dt.date.fromisoformat(week_ending)          # fails loudly on a bad date
    else:
        week_ending = next_sunday().isoformat()

    themes = pick_themes(weekly, week_ending)
    stamp = week_ending.replace("-", "")
    entries = []
    clue_ids = []

    for n, theme in enumerate(themes, start=1):
        cid = f"wk{stamp}-{n:02d}"
        clue_ids.append(cid)
        entries.append({
            "id": f"wk{stamp}-entry-{n:02d}",
            "answer": "",
            "answerType": "",
            "aliases": [],
            "_theme": theme["name"],
            "_guidance": theme["guidance"],
            "clues": [{
                "id": cid,
                "text": "",
                "usableIn": ["quickfire-xi-weekly"],
                "source": "",
                "_checklist": [
                    "Date anchored — a reader in six months can still date it",
                    "Verified against a named source with a URL in `source`",
                    "Completed fact, not a rumour or a probable",
                    "Does not name any other answer in this week's XI",
                ],
            }],
        })

    bench_ids = []
    for n in range(1, weekly["benchPerWeek"] + 1):
        cid = f"wk{stamp}-sub-{n:02d}"
        bench_ids.append(cid)
        entries.append({
            "id": f"wk{stamp}-entry-sub-{n:02d}",
            "answer": "",
            "answerType": "",
            "aliases": [],
            "_theme": "Bench",
            "_guidance": "A spare, same standard as the XI. Anything the week gave you.",
            "clues": [{
                "id": cid,
                "text": "",
                "usableIn": ["quickfire-xi-weekly"],
                "source": "",
            }],
        })

    skeleton = {
        "weekEnding": week_ending,
        "label": "The Last 7 Days",
        "placeholder": False,
        "entries": entries,
        "clueIds": clue_ids,
        "benchClueIds": bench_ids,
    }

    out_dir = ROOT / "data/weeks"
    out_dir.mkdir(exist_ok=True)
    out = out_dir / f"{week_ending}.json"
    if out.exists():
        raise SystemExit(f"{out} already exists — delete it first if you mean to start over")
    out.write_text(json.dumps(skeleton, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print(f"Wrote {out}")
    print(f"Week ending {week_ending} — {len(clue_ids)} questions and {len(bench_ids)} subs:\n")
    for n, theme in enumerate(themes, start=1):
        tag = {"anchor": "*", "seasonal": "~"}.get(theme["frequency"], " ")
        print(f"  {tag} {n:2d}. {theme['name']}")
        if theme.get("onlyIf"):
            print(f"         only if: {theme['onlyIf']}")
    print("\n  * always included    ~ in season this month")
    print("\nSwap any of them — the themes are a pool, not a running order.")


if __name__ == "__main__":
    main()
