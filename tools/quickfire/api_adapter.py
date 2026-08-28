#!/usr/bin/env python3
"""The only file that knows what API-FOOTBALL's JSON looks like.

WARNING — the field names below are written from memory and have NOT been
checked against a live response. Everything downstream works on the normalised
shapes at the bottom of this file, so when the real payload turns out to differ,
this is the only file that needs fixing. Nothing else in the pipeline parses
vendor JSON.

Normalised shapes
-----------------
Match:
    id, date (YYYY-MM-DD), league, league_id, tier, country,
    home, away, home_goals, away_goals, ht_home, ht_away,
    events: [{minute, type, detail, team, player, assist}],
    source_url

Standing:
    league, league_id, team, position, points, played, total_teams

`tier` is 1 for a country's top flight, 2+ below it — used to tell an upset
between divisions from an upset within one.
"""

import json
import os
import pathlib
import urllib.parse
import urllib.request

BASE = "https://v3.football.api-sports.io"

# league id -> (display name, country, tier). Verify these ids before trusting.
LEAGUES = {
    39:  ("Premier League", "England", 1),
    40:  ("Championship", "England", 2),
    41:  ("League One", "England", 3),
    42:  ("League Two", "England", 4),
    43:  ("National League", "England", 5),
    45:  ("FA Cup", "England", 1),
    48:  ("League Cup", "England", 1),
    179: ("Scottish Premiership", "Scotland", 1),
    2:   ("Champions League", "Europe", 1),
    3:   ("Europa League", "Europe", 1),
    848: ("Conference League", "Europe", 1),
}


def _request(path, params, api_key):
    url = BASE + path + "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={
        "x-apisports-key": api_key,
        "Accept": "application/json",
    })
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8"))


def fetch_raw(date_from, date_to, league_ids, season, api_key, with_events=True):
    """Pull a week of fixtures, their events, and current standings.

    The fixtures list endpoint does not include events, so events are fetched per
    finished fixture. That is one extra call each and dominates the call count:
    a normal English week across nine competitions is roughly 50 fixtures, so
    ~70 calls in total. Save the result with --save-raw and work from the file.
    """
    out = {"fixtures": [], "standings": [], "calls": 0}
    for league_id in league_ids:
        payload = _request("/fixtures", {
            "league": league_id, "season": season,
            "from": date_from, "to": date_to,
        }, api_key)
        out["calls"] += 1

        if with_events:
            for item in payload.get("response", []):
                status = (((item.get("fixture") or {}).get("status") or {}).get("short") or "")
                fixture_id = (item.get("fixture") or {}).get("id")
                if status not in ("FT", "AET", "PEN") or not fixture_id:
                    continue
                events = _request("/fixtures/events", {"fixture": fixture_id}, api_key)
                out["calls"] += 1
                item["events"] = events.get("response", [])

        out["fixtures"].append(payload)
        out["standings"].append(_request("/standings", {
            "league": league_id, "season": season,
        }, api_key))
        out["calls"] += 1
    return out


# ---------------------------------------------------------------- normalise --

def _event(raw):
    return {
        "minute": (raw.get("time") or {}).get("elapsed") or 0,
        "extra": (raw.get("time") or {}).get("extra") or 0,
        "type": (raw.get("type") or "").lower(),
        "detail": (raw.get("detail") or "").lower(),
        "team": ((raw.get("team") or {}).get("name") or ""),
        "player": ((raw.get("player") or {}).get("name") or ""),
        "assist": ((raw.get("assist") or {}).get("name") or ""),
    }


def normalise_match(raw):
    fixture = raw.get("fixture") or {}
    league = raw.get("league") or {}
    teams = raw.get("teams") or {}
    goals = raw.get("goals") or {}
    score = raw.get("score") or {}
    half = score.get("halftime") or {}

    league_id = league.get("id")
    known = LEAGUES.get(league_id)
    fixture_id = fixture.get("id")

    return {
        "id": fixture_id,
        "date": (fixture.get("date") or "")[:10],
        "league": known[0] if known else (league.get("name") or "Unknown"),
        "league_id": league_id,
        "country": known[1] if known else (league.get("country") or ""),
        "tier": known[2] if known else None,
        "home": ((teams.get("home") or {}).get("name") or ""),
        "away": ((teams.get("away") or {}).get("name") or ""),
        "home_goals": goals.get("home"),
        "away_goals": goals.get("away"),
        "ht_home": half.get("home"),
        "ht_away": half.get("away"),
        "status": ((fixture.get("status") or {}).get("short") or ""),
        "events": [_event(e) for e in (raw.get("events") or [])],
        "source_url": f"https://www.api-football.com/fixture/{fixture_id}" if fixture_id else "",
    }


def normalise_standings(raw):
    league = raw.get("league") or {}
    league_id = league.get("id")
    known = LEAGUES.get(league_id)
    rows = []
    for group in (league.get("standings") or []):
        total = len(group)
        for row in group:
            rows.append({
                "league": known[0] if known else (league.get("name") or "Unknown"),
                "league_id": league_id,
                "tier": known[2] if known else None,
                "team": ((row.get("team") or {}).get("name") or ""),
                "position": row.get("rank"),
                "points": row.get("points"),
                "played": ((row.get("all") or {}).get("played") or 0),
                "total_teams": total,
            })
    return rows


def normalise(raw_bundle):
    """Raw vendor JSON (or a saved copy of it) -> matches and standings."""
    matches, standings = [], []
    for payload in raw_bundle.get("fixtures", []):
        for item in payload.get("response", []):
            match = normalise_match(item)
            if match["status"] in ("FT", "AET", "PEN"):
                matches.append(match)
    for payload in raw_bundle.get("standings", []):
        for item in payload.get("response", []):
            standings.extend(normalise_standings(item))
    return matches, standings


def load(path):
    return json.loads(pathlib.Path(path).read_text(encoding="utf-8"))


def api_key():
    key = os.environ.get("API_FOOTBALL_KEY")
    if not key:
        raise SystemExit("Set API_FOOTBALL_KEY, or pass --from-file with a saved response.")
    return key
