#!/usr/bin/env python3
"""Find candidate subjects from football news feeds.

    python3 tools/find_news.py --week 2026-08-30 --save-raw news.xml.json
    python3 tools/find_news.py --week 2026-08-30 --from-file news.xml.json

Covers the themes that fixtures data cannot reach: manager changes, transfers,
contracts, injuries, ownership, stadiums, rules, awards, retirements, beyond the
pitch, goal of the week, the odd one.

Merges into data/weeks/<week>-candidates.json if find_candidates.py has already
written one, so both halves of a week land in the same file.

Three things it does that a plain feed reader doesn't:

1. **Kills rumours.** Anything reading "linked with", "set to sign", "in talks"
   is discarded outright. A transfer that collapses on Thursday makes Monday's
   quiz wrong, and that failure is invisible until someone plays it.
2. **Clusters the same story across outlets.** Five headlines about one sacking
   become one candidate with five sources.
3. **Ranks by how many outlets carried it**, which is the closest thing to a
   measure of whether people actually read it.

Nothing it produces is verified. Every candidate carries its links so the fact
can be checked before it becomes a question.
"""

import argparse
import datetime as dt
import email.utils
import json
import pathlib
import re
import urllib.request
import xml.etree.ElementTree as ET

ROOT = pathlib.Path(__file__).resolve().parent.parent
FEEDS = ROOT / "data/news-feeds.json"
THEMES = ROOT / "data/news-themes.json"

UA = "QuickFireXI-weekly/1.0 (+solo project; contact privacy@thexigames.com)"
SIMILARITY = 0.55          # title overlap at which two headlines are one story
MIN_TITLE_WORDS = 4

STOPWORDS = {
    "the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "at", "as",
    "is", "was", "with", "his", "her", "their", "after", "from", "by", "it",
    "that", "this", "but", "has", "have", "will", "be", "are", "he", "she",
}


# ------------------------------------------------------------------ fetching --

def fetch_feeds(feeds, verbose=False):
    raw = {}
    for feed in feeds:
        try:
            req = urllib.request.Request(feed["url"], headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=20) as resp:
                raw[feed["name"]] = resp.read().decode("utf-8", errors="replace")
            if verbose:
                print(f"  ok   {feed['name']}")
        except Exception as err:                       # a dead feed must be loud
            print(f"  FAIL {feed['name']}: {err}")
    return raw


# ------------------------------------------------------------------- parsing --

def _text(node):
    return (node.text or "").strip() if node is not None else ""


def _strip_ns(tag):
    return tag.split("}")[-1]


def parse_feed(name, xml_text):
    """RSS 2.0 and Atom, without a third-party dependency."""
    items = []
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError:
        return items

    for node in root.iter():
        tag = _strip_ns(node.tag)
        if tag not in ("item", "entry"):
            continue

        title = link = date_text = ""
        for child in node:
            ctag = _strip_ns(child.tag)
            if ctag == "title":
                title = _text(child)
            elif ctag == "link":
                link = child.get("href") or _text(child)
            elif ctag in ("pubDate", "published", "updated", "date"):
                date_text = date_text or _text(child)

        if not title:
            continue
        items.append({
            "feed": name,
            "title": re.sub(r"\s+", " ", title).strip(),
            "url": link,
            "published": parse_date(date_text),
        })
    return items


def parse_date(text):
    if not text:
        return None
    try:
        return email.utils.parsedate_to_datetime(text).date().isoformat()
    except Exception:
        pass
    try:
        return dt.datetime.fromisoformat(text.replace("Z", "+00:00")).date().isoformat()
    except Exception:
        return None


# ------------------------------------------------------------------ matching --

def tokens(title):
    words = re.findall(r"[a-z0-9']+", title.lower())
    return {w for w in words if w not in STOPWORDS and len(w) > 2}


def similarity(a, b):
    if not a or not b:
        return 0.0
    return len(a & b) / len(a | b)


def classify(title, config):
    low = title.lower()
    for reason, phrases in config["kill"].items():
        for phrase in phrases:
            if phrase in low:
                return None, reason
    hits = []
    for theme, phrases in config["themes"].items():
        for phrase in phrases:
            if phrase in low:
                hits.append(theme)
                break
    return hits, None


def cluster(items):
    """One story, however many outlets carried it."""
    clusters = []
    for item in items:
        item["_tokens"] = tokens(item["title"])
        placed = False
        for group in clusters:
            if similarity(item["_tokens"], group["tokens"]) >= SIMILARITY:
                group["items"].append(item)
                group["tokens"] |= item["_tokens"]
                placed = True
                break
        if not placed:
            clusters.append({"tokens": set(item["_tokens"]), "items": [item]})
    return clusters


# ---------------------------------------------------------------- candidates --

def build_candidates(raw, config, feeds, window):
    """Cluster first, classify second.

    Clustering before theme matching matters: if four outlets carry a sacking and
    only one of them writes "sacked" rather than "sack", classifying each item on
    its own throws away three quarters of the story. The cluster is classified on
    every headline it contains.
    """
    weights = {f["name"]: f.get("weight", 1.0) for f in feeds}
    start, end = window

    items = []
    killed = {"rumour": 0, "noise": 0, "off-window": 0, "unthemed": 0}

    for name, xml_text in raw.items():
        for item in parse_feed(name, xml_text):
            if item["published"] and not (start <= item["published"] <= end):
                killed["off-window"] += 1
                continue
            if len(item["title"].split()) < MIN_TITLE_WORDS:
                continue
            _, reason = classify(item["title"], config)
            if reason == "noise":
                killed["noise"] += 1
                continue
            # Rumours stay in for clustering but are marked. A story where one
            # outlet reports a done deal and another calls it speculation is
            # still worth surfacing — flagged, not silently dropped.
            item["rumour"] = reason == "rumour"
            items.append(item)

    out = []
    for group in cluster(items):
        members = group["items"]
        if all(m["rumour"] for m in members):
            killed["rumour"] += 1
            continue

        blob = " ".join(m["title"] for m in members)
        themes, _ = classify(blob, {"kill": {}, "themes": config["themes"]})
        if not themes:
            killed["unthemed"] += 1
            continue

        outlets = sorted({m["feed"] for m in members})
        reach = sum(weights.get(o, 1.0) for o in outlets)
        rumoured = any(m["rumour"] for m in members)
        firm = [m for m in members if not m["rumour"]]
        lead = min(firm, key=lambda m: (m["published"] or "9999", m["title"]))

        out.append({
            "theme": themes[0],
            "alsoFits": themes[1:],
            "fact": lead["title"],
            "answerCandidates": [],
            "date": lead["published"],
            "outlets": outlets,
            "reach": round(reach, 1),
            "sources": [{"feed": m["feed"], "url": m["url"],
                         "readsAsRumour": m["rumour"]} for m in members],
            "source": lead["url"],
            "rumourFlag": rumoured,
            "confidence": "check" if rumoured or len(outlets) < 3 else "strong",
            "verified": False,
        })

    out.sort(key=lambda c: (-c["reach"], c["theme"]))
    return out, killed


# --------------------------------------------------------------------- main --

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--week", required=True, help="week ending, YYYY-MM-DD")
    ap.add_argument("--days", type=int, default=7)
    ap.add_argument("--from-file", help="a saved feed bundle, instead of fetching")
    ap.add_argument("--save-raw", help="write the fetched feeds here for reuse")
    ap.add_argument("--verbose", action="store_true")
    args = ap.parse_args()

    end = dt.date.fromisoformat(args.week)
    start = end - dt.timedelta(days=args.days - 1)
    window = (start.isoformat(), end.isoformat())

    feeds = json.loads(FEEDS.read_text(encoding="utf-8"))["feeds"]
    config = json.loads(THEMES.read_text(encoding="utf-8"))

    if args.from_file:
        raw = json.loads(pathlib.Path(args.from_file).read_text(encoding="utf-8"))
    else:
        raw = fetch_feeds(feeds, args.verbose)
        if args.save_raw:
            pathlib.Path(args.save_raw).write_text(
                json.dumps(raw, ensure_ascii=False), encoding="utf-8")

    found, killed = build_candidates(raw, config, feeds, window)

    by_theme = {}
    for c in found:
        by_theme.setdefault(c["theme"], []).append(c)

    out_dir = ROOT / "data/weeks"
    out_dir.mkdir(exist_ok=True)
    out = out_dir / f"{args.week}-candidates.json"

    if out.exists():
        existing = json.loads(out.read_text(encoding="utf-8"))
        for theme, group in by_theme.items():
            existing.setdefault("byTheme", {}).setdefault(theme, []).extend(group)
        existing["newsFeedsRead"] = sorted(raw.keys())
        existing["newsDiscarded"] = killed
        existing["notCovered"] = [t for t in existing.get("notCovered", [])
                                  if t not in by_theme]
        out.write_text(json.dumps(existing, ensure_ascii=False, indent=2) + "\n",
                       encoding="utf-8")
        merged = True
    else:
        out.write_text(json.dumps({
            "weekEnding": args.week,
            "window": list(window),
            "note": ("News candidates only. Nothing verified, nothing is a question. "
                     "Rumours are discarded, not flagged — if a story you expected "
                     "is missing, it probably read as speculation."),
            "newsFeedsRead": sorted(raw.keys()),
            "newsDiscarded": killed,
            "byTheme": by_theme,
        }, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        merged = False

    print(f"\nRead {len(raw)} feeds, {start} to {end}")
    print(f"{'Merged into' if merged else 'Wrote'} {out}\n")
    for theme in sorted(by_theme, key=lambda t: -len(by_theme[t])):
        strong = sum(1 for c in by_theme[theme] if c["confidence"] == "strong")
        print(f"  {theme:20s} {len(by_theme[theme]):3d}  ({strong} in 3+ outlets)")
    if not by_theme:
        print("  nothing matched — check the feed urls with --verbose")
    print(f"\n  discarded: {killed['rumour']} rumour, {killed['noise']} noise, "
          f"{killed['unthemed']} no theme, {killed['off-window']} outside the week")


if __name__ == "__main__":
    main()
