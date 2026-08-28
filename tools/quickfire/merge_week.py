#!/usr/bin/env python3
"""Merge a filled-in week into data/weekly-topical.json.

    python3 tools/merge_week.py data/weeks/2026-08-30.json

Refuses to merge until the week is actually finished: no blank answers, no blank
clues, no missing sources, no duplicate answers, and no clue naming another
answer in the same week. Strips the _theme / _guidance / _checklist scaffolding.
"""

import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
WEEKLY = ROOT / "data/weekly-topical.json"


def clean(entry):
    out = {k: v for k, v in entry.items() if not k.startswith("_")}
    out["clues"] = [{k: v for k, v in c.items() if not k.startswith("_")}
                    for c in entry["clues"]]
    return out


def main():
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    draft = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"))
    weekly = json.loads(WEEKLY.read_text(encoding="utf-8"))

    problems = []
    answer_for = {}
    text_for = {}

    for entry in draft["entries"]:
        if not entry["answer"].strip():
            problems.append(f"{entry['id']}: no answer")
        for clue in entry["clues"]:
            answer_for[clue["id"]] = entry["answer"]
            text_for[clue["id"]] = clue["text"]
            if not clue["text"].strip():
                problems.append(f"{clue['id']}: no clue text")
            if not clue.get("source", "").strip():
                problems.append(f"{clue['id']}: no source — every topical clue needs one")
            if clue["text"] and not any(y in clue["text"] for y in ("202", "201", "200", "199")):
                problems.append(f"{clue['id']}: no date anchor in the clue text")

    xi = [answer_for[c] for c in draft["clueIds"] if c in answer_for]
    if len(set(xi)) != len(xi):
        problems.append("two questions share an answer")

    for cid, text in text_for.items():
        for other, answer in answer_for.items():
            if other != cid and answer and answer.lower() in text.lower():
                problems.append(f"{cid} names another answer in the same week ({answer})")

    existing = {c["id"] for e in weekly["entries"] for c in e["clues"]}
    for cid in text_for:
        if cid in existing:
            problems.append(f"{cid} is already in weekly-topical.json")

    if any(w["weekEnding"] == draft["weekEnding"] for w in weekly["weeks"]):
        problems.append(f"week {draft['weekEnding']} is already merged")

    if problems:
        print("Not merged. Fix these first:\n")
        for p in problems:
            print("  - " + p)
        raise SystemExit(1)

    weekly["entries"].extend(clean(e) for e in draft["entries"])
    weekly["weeks"].append({
        "weekEnding": draft["weekEnding"],
        "label": draft.get("label", "The Last 7 Days"),
        "placeholder": False,
        "clueIds": draft["clueIds"],
        "benchClueIds": draft["benchClueIds"],
    })
    weekly["weeks"].sort(key=lambda w: w["weekEnding"])
    WEEKLY.write_text(json.dumps(weekly, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Merged week ending {draft['weekEnding']}. Now run: python3 tools/build.py")


if __name__ == "__main__":
    main()
