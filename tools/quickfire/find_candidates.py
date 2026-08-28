#!/usr/bin/env python3
"""Find candidate subjects for a weekly round.

    python3 tools/find_candidates.py --week 2026-08-30
    python3 tools/find_candidates.py --week 2026-08-30 --from-file raw.json
    python3 tools/find_candidates.py --week 2026-08-30 --save-raw raw.json

Writes data/weeks/<week>-candidates.json: facts, theme tags and source links.
No clue text — the wording is yours. Nothing here is a finished question and
nothing here has been verified; every candidate carries the fixture link so the
fact can be checked before it goes anywhere near a player.

Themes this covers, from fixtures and standings alone:
    headline-result, upset, comeback, late-winner, goalscorer, derby,
    cards-and-calls, goalkeeping, efl, promotion-relegation, title-race

Themes it does not and cannot cover: goal of the week, ownership, rule changes,
awards, retirements, beyond the pitch, the odd one. Those are news, not data.
Transfers, manager changes and injuries have feeds but they lag and carry
provisional entries, so they are deliberately left out rather than half-trusted.
"""

import argparse
import datetime as dt
import json
import pathlib

import api_adapter as api

ROOT = pathlib.Path(__file__).resolve().parent.parent
DERBIES = ROOT / "data/derbies.json"

# Tunables. Every threshold here is a judgement call, not a fact.
UPSET_POSITION_GAP = 8       # league places between winner and loser
BIG_MARGIN = 3               # goals, for a thrashing
LATE_MINUTE = 88             # a winner at or after this counts as late
COMEBACK_DEFICIT = 2         # goals behind before turning it round
EARLY_RED = 25               # a red card at or before this is a story


def ordinal(n):
    if n is None:
        return "?"
    if 10 <= n % 100 <= 20:
        suffix = "th"
    else:
        suffix = {1: "st", 2: "nd", 3: "rd"}.get(n % 10, "th")
    return f"{n}{suffix}"


def candidate(theme, fact, answers, match=None, confidence="check", **extra):
    out = {
        "theme": theme,
        "fact": fact,
        "answerCandidates": answers,
        "confidence": confidence,
        "verified": False,
    }
    if match:
        out.update({
            "date": match["date"],
            "league": match["league"],
            "source": match["source_url"],
            "fixture": f"{match['home']} {match['home_goals']}-{match['away_goals']} {match['away']}",
        })
    out.update(extra)
    return out


# ------------------------------------------------------------------ helpers --

def goals(match):
    return [e for e in match["events"] if e["type"] == "goal"
            and "missed" not in e["detail"]]


def running_score(match):
    """Score after each goal, as (minute, home, away, scorer, team)."""
    home = away = 0
    out = []
    for e in sorted(goals(match), key=lambda e: (e["minute"], e["extra"])):
        if e["team"] == match["home"]:
            home += 1
        else:
            away += 1
        out.append((e["minute"] + e["extra"], home, away, e["player"], e["team"]))
    return out


def winner(match):
    if match["home_goals"] is None or match["away_goals"] is None:
        return None
    if match["home_goals"] > match["away_goals"]:
        return match["home"]
    if match["away_goals"] > match["home_goals"]:
        return match["away"]
    return None


def loser(match):
    w = winner(match)
    if not w:
        return None
    return match["away"] if w == match["home"] else match["home"]


def position_map(standings):
    return {(s["league_id"], s["team"]): s for s in standings}


# ---------------------------------------------------------------- detectors --

def find_upsets(matches, standings):
    pos = position_map(standings)
    out = []
    for m in matches:
        w, l = winner(m), loser(m)
        if not w:
            continue
        wp, lp = pos.get((m["league_id"], w)), pos.get((m["league_id"], l))
        if not wp or not lp:
            continue
        gap = wp["position"] - lp["position"]
        if gap >= UPSET_POSITION_GAP:
            out.append(candidate(
                "upset",
                f"{w} ({ordinal(wp['position'])}) beat {l} ({ordinal(lp['position'])}) "
                f"{m['home_goals']}-{m['away_goals']}",
                [w, l], m,
                gap=gap,
                confidence="strong" if gap >= UPSET_POSITION_GAP + 4 else "check",
            ))
    return out


def find_cup_upsets(matches):
    """Different divisions meeting — cup ties. Needs tier on both sides."""
    out = []
    for m in matches:
        if m["tier"] is None:
            continue
        w = winner(m)
        if not w:
            continue
        out.append(candidate(
            "cup-run",
            f"{w} won {m['home_goals']}-{m['away_goals']} in the {m['league']}",
            [w], m, confidence="check",
        )) if "cup" in m["league"].lower() else None
    return [c for c in out if c]


def find_comebacks(matches):
    out = []
    for m in matches:
        seq = running_score(m)
        if not seq:
            continue
        worst_home = min((h - a) for _, h, a, _, _ in seq)
        worst_away = min((a - h) for _, h, a, _, _ in seq)
        final = m["home_goals"] - m["away_goals"]
        if worst_home <= -COMEBACK_DEFICIT and final > 0:
            out.append(candidate(
                "comeback",
                f"{m['home']} came from {abs(worst_home)} down to beat {m['away']} "
                f"{m['home_goals']}-{m['away_goals']}",
                [m["home"]], m, confidence="strong"))
        if worst_away <= -COMEBACK_DEFICIT and final < 0:
            out.append(candidate(
                "comeback",
                f"{m['away']} came from {abs(worst_away)} down to win at {m['home']} "
                f"{m['away_goals']}-{m['home_goals']}",
                [m["away"]], m, confidence="strong"))
    return out


def find_late_winners(matches):
    out = []
    for m in matches:
        seq = running_score(m)
        if len(seq) < 2:
            continue
        minute, h, a, scorer, team = seq[-1]
        if minute < LATE_MINUTE:
            continue
        _, ph, pa, _, _ = seq[-2]
        was_level = ph == pa
        now_decided = h != a
        if was_level and now_decided:
            out.append(candidate(
                "late-winner",
                f"{scorer} scored for {team} in the {minute}th minute to beat "
                f"{m['away'] if team == m['home'] else m['home']}",
                [scorer, team], m, minute=minute, confidence="strong"))
    return out


def find_goalscorers(matches):
    out = []
    for m in matches:
        tally = {}
        for e in goals(m):
            if "own goal" in e["detail"]:
                continue
            tally.setdefault((e["player"], e["team"]), []).append(e["minute"])
        for (player, team), minutes in tally.items():
            if len(minutes) >= 3:
                out.append(candidate(
                    "goalscorer",
                    f"{player} scored {len(minutes)} for {team} "
                    f"({', '.join(str(x) + chr(39) for x in sorted(minutes))})",
                    [player], m, goals=len(minutes), confidence="strong"))
            elif len(minutes) == 2 and winner(m) == team:
                out.append(candidate(
                    "goalscorer",
                    f"{player} scored twice for {team}",
                    [player], m, goals=2, confidence="check"))
    return out


def find_big_results(matches, standings):
    pos = position_map(standings)
    out = []
    for m in matches:
        margin = abs((m["home_goals"] or 0) - (m["away_goals"] or 0))
        total = (m["home_goals"] or 0) + (m["away_goals"] or 0)
        hp = pos.get((m["league_id"], m["home"]))
        ap = pos.get((m["league_id"], m["away"]))
        top_meeting = hp and ap and hp["position"] <= 6 and ap["position"] <= 6
        if margin >= BIG_MARGIN or total >= 6 or top_meeting:
            out.append(candidate(
                "headline-result",
                f"{m['home']} {m['home_goals']}-{m['away_goals']} {m['away']}",
                [m["home"], m["away"]], m,
                confidence="strong" if top_meeting or margin >= 4 else "check"))
    return out


def find_derbies(matches):
    try:
        pairs = json.loads(DERBIES.read_text(encoding="utf-8"))["derbies"]
    except Exception:
        return []
    index = {}
    for d in pairs:
        index[frozenset(d["teams"])] = d["name"]
    out = []
    for m in matches:
        name = index.get(frozenset([m["home"], m["away"]]))
        if name:
            out.append(candidate(
                "derby",
                f"{name}: {m['home']} {m['home_goals']}-{m['away_goals']} {m['away']}",
                [m["home"], m["away"]], m, confidence="strong"))
    return out


def find_cards(matches):
    out = []
    for m in matches:
        reds = [e for e in m["events"]
                if e["type"] == "card" and "red" in e["detail"]]
        for e in reds:
            if e["minute"] <= EARLY_RED:
                out.append(candidate(
                    "cards-and-calls",
                    f"{e['player']} ({e['team']}) sent off after {e['minute']} minutes",
                    [e["player"], e["team"]], m, minute=e["minute"], confidence="check"))
        if len(reds) >= 2:
            out.append(candidate(
                "cards-and-calls",
                f"{len(reds)} red cards in {m['home']} v {m['away']}",
                [m["home"], m["away"]], m, confidence="strong"))
    return out


def find_goalkeeping(matches, standings):
    pos = position_map(standings)
    out = []
    for m in matches:
        for side, other, conceded in (("home", "away", m["away_goals"]),
                                      ("away", "home", m["home_goals"])):
            if conceded != 0:
                continue
            team, opponent = m[side], m[other]
            tp, op = pos.get((m["league_id"], team)), pos.get((m["league_id"], opponent))
            if tp and op and tp["position"] - op["position"] >= 6:
                out.append(candidate(
                    "goalkeeping",
                    f"{team} ({ordinal(tp['position'])}) kept a clean sheet against "
                    f"{opponent} ({ordinal(op['position'])})",
                    [team], m, confidence="check"))
    return out


def find_settled_races(standings, week_ending):
    """Mathematically settled titles, promotions and relegations."""
    month = int(week_ending.split("-")[1])
    if month not in (3, 4, 5):
        return []
    out = []
    by_league = {}
    for s in standings:
        by_league.setdefault(s["league_id"], []).append(s)

    for league_id, rows in by_league.items():
        rows = sorted([r for r in rows if r["position"]], key=lambda r: r["position"])
        if not rows:
            continue
        games = max(r["played"] for r in rows)
        total = rows[0]["total_teams"]
        remaining = (total - 1) * 2 - games
        if remaining < 0:
            continue
        leader = rows[0]
        second = rows[1] if len(rows) > 1 else None
        if second and leader["points"] - second["points"] > remaining * 3:
            out.append(candidate(
                "title-race",
                f"{leader['team']} cannot be caught in the {leader['league']} "
                f"({leader['points']} points, {remaining} games left)",
                [leader["team"]], None,
                league=leader["league"], confidence="strong",
                source="standings"))
        bottom = rows[-1]
        safety = rows[-4] if len(rows) >= 4 else None
        if safety and safety["points"] - bottom["points"] > remaining * 3:
            out.append(candidate(
                "promotion-relegation",
                f"{bottom['team']} cannot avoid relegation from the "
                f"{bottom['league']} ({bottom['points']} points, {remaining} games left)",
                [bottom["team"]], None,
                league=bottom["league"], confidence="strong",
                source="standings"))
    return out


def tag_efl(candidates, matches):
    """Anything outside a top flight also serves the EFL slot."""
    tier_by_fixture = {m["source_url"]: m["tier"] for m in matches}
    for c in candidates:
        tier = tier_by_fixture.get(c.get("source"))
        if tier and tier > 1:
            c["alsoFits"] = sorted(set(c.get("alsoFits", []) + ["efl"]))
    return candidates


# --------------------------------------------------------------------- main --

def collect(matches, standings, week_ending):
    found = []
    found += find_big_results(matches, standings)
    found += find_upsets(matches, standings)
    found += find_comebacks(matches)
    found += find_late_winners(matches)
    found += find_goalscorers(matches)
    found += find_derbies(matches)
    found += find_cards(matches)
    found += find_goalkeeping(matches, standings)
    found += find_cup_upsets(matches)
    found += find_settled_races(standings, week_ending)
    return tag_efl(found, matches)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--week", required=True, help="week ending, YYYY-MM-DD")
    ap.add_argument("--days", type=int, default=7)
    ap.add_argument("--season", type=int, default=None)
    ap.add_argument("--leagues", default="39,40,41,42,43,45,48,179,2,3,848")
    ap.add_argument("--no-events", action="store_true",
                    help="skip per-fixture event calls (much cheaper, loses "
                         "hat-tricks, comebacks, late winners and cards)")
    ap.add_argument("--from-file", help="a saved raw API response, instead of fetching")
    ap.add_argument("--save-raw", help="write the raw response here for reuse")
    args = ap.parse_args()

    end = dt.date.fromisoformat(args.week)
    start = end - dt.timedelta(days=args.days - 1)
    season = args.season or (end.year if end.month >= 7 else end.year - 1)

    if args.from_file:
        raw = api.load(args.from_file)
    else:
        league_ids = [int(x) for x in args.leagues.split(",") if x.strip()]
        raw = api.fetch_raw(start.isoformat(), end.isoformat(), league_ids,
                            season, api.api_key(), with_events=not args.no_events)
        print(f"{raw.get('calls', 0)} API calls")
        if args.save_raw:
            pathlib.Path(args.save_raw).write_text(
                json.dumps(raw, ensure_ascii=False, indent=2), encoding="utf-8")

    matches, standings = api.normalise(raw)
    found = collect(matches, standings, args.week)

    by_theme = {}
    for c in found:
        by_theme.setdefault(c["theme"], []).append(c)
    for group in by_theme.values():
        group.sort(key=lambda c: (c["confidence"] != "strong", c.get("date", "")))

    out_dir = ROOT / "data/weeks"
    out_dir.mkdir(exist_ok=True)
    out = out_dir / f"{args.week}-candidates.json"
    out.write_text(json.dumps({
        "weekEnding": args.week,
        "window": [start.isoformat(), end.isoformat()],
        "matchesScanned": len(matches),
        "note": ("Candidates only. Nothing here is verified and nothing here is a "
                 "question. Check each fact against its source before use."),
        "notCovered": ["goal-of-the-week", "transfer", "manager-in-out", "injury",
                       "ownership", "rules", "awards", "retirement",
                       "beyond-the-pitch", "odd-one"],
        "byTheme": by_theme,
    }, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print(f"Scanned {len(matches)} finished matches, {start} to {end}")
    print(f"Wrote {out}\n")
    for theme in sorted(by_theme):
        strong = sum(1 for c in by_theme[theme] if c["confidence"] == "strong")
        print(f"  {theme:22s} {len(by_theme[theme]):3d}  ({strong} strong)")
    if not by_theme:
        print("  nothing found — check the league ids and the date window")
    print("\n  Not covered by any of this, still yours to find:")
    print("  goal of the week, transfers, manager news, injuries, ownership,")
    print("  rule changes, awards, retirements, beyond the pitch, the odd one.")


if __name__ == "__main__":
    main()
