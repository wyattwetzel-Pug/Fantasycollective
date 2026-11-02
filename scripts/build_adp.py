#!/usr/bin/env python3
"""Builds supabase/seed/adp_<season>.sql from two free, public ADP feeds.

Usage:  python3 scripts/build_adp.py 2026

Sources, tried in order for each league setup (the first with enough players wins):
  * MyFantasyLeague (api.myfantasyleague.com): PPR and Standard redraft, 12 teams, current season.
  * Fantasy Football Calculator (fantasyfootballcalculator.com): Half PPR, Superflex, Dynasty. Credit them.

It reads your players from Supabase (public read), matches the ADP rows to them by name and
position, and writes SQL you paste into the Supabase SQL editor. Re-run it each preseason.
"""
import json, re, sys, urllib.request
from datetime import datetime, timezone

SUPABASE = "https://zvxgcednanoprdxezqdj.supabase.co/rest/v1"
KEY = "sb_publishable_84Ww-yUFLXObWEgrm5YeFw_fIaDbSX9"  # public key, read-only
MIN_PLAYERS = 60  # a feed with fewer players than this is ignored for that setup
UA = {"User-Agent": "Mozilla/5.0 fantasy-collective"}
SUFFIX = re.compile(r"\b(jr|sr|ii|iii|iv|v)\b")
POS = {"PK": "K", "DST": "DEF", "Def": "DEF", "DEF": "DEF"}

# (format, scoring, qb_type) -> list of (source name, loader key, loader argument)
PLAN = [
    (("redraft", "ppr", "1qb"), [("MyFantasyLeague", "mfl", 1), ("Fantasy Football Calculator", "ffc", "ppr")]),
    (("redraft", "std", "1qb"), [("MyFantasyLeague", "mfl", 0), ("Fantasy Football Calculator", "ffc", "standard")]),
    (("redraft", "half", "1qb"), [("Fantasy Football Calculator", "ffc", "half-ppr")]),
    (("redraft", "ppr", "superflex"), [("Fantasy Football Calculator", "ffc", "2qb")]),
    (("dynasty", "ppr", "1qb"), [("Fantasy Football Calculator", "ffc", "dynasty")]),
]

def get(url, headers=None):
    req = urllib.request.Request(url, headers=headers or UA)
    with urllib.request.urlopen(req, timeout=40) as r:
        return json.load(r)

def norm(name):
    s = re.sub(r"[^a-z ]", "", name.lower().replace("-", " ").replace(".", ""))
    return re.sub(r"\s+", " ", SUFFIX.sub("", s)).strip()

def load_ffc(season, kind):
    d = get(f"https://fantasyfootballcalculator.com/api/v1/adp/{kind}?teams=12&year={season}")
    return [dict(name=p["name"], pos=POS.get(p["position"], p["position"]), team=p["team"], adp=p["adp"],
                 high=p.get("high"), low=p.get("low"), stdev=p.get("stdev"), n=p.get("times_drafted"),
                 as_of=d.get("meta", {}).get("end_date")) for p in d.get("players", [])]

_mfl_players = {}
def load_mfl(season, ppr):
    if not _mfl_players:
        for p in get(f"https://api.myfantasyleague.com/{season}/export?TYPE=players&DETAILS=1&JSON=1")["players"]["player"]:
            _mfl_players[p["id"]] = p
    d = get(f"https://api.myfantasyleague.com/{season}/export?TYPE=adp&PERIOD=ALL&FCOUNT=12&IS_PPR={ppr}&IS_KEEPER=N&IS_MOCK=0&JSON=1")["adp"]
    when = datetime.fromtimestamp(int(d["timestamp"]), timezone.utc).date().isoformat() if d.get("timestamp") else None
    out = []
    for p in d.get("player", []):
        m = _mfl_players.get(p["id"])
        if not m or "," not in m["name"]:
            continue
        last, first = [x.strip() for x in m["name"].split(",", 1)]
        out.append(dict(name=f"{first} {last}", pos=POS.get(m["position"], m["position"]), team=m.get("team"),
                        adp=float(p["averagePick"]), high=int(p["minPick"]), low=int(p["maxPick"]), stdev=None,
                        n=int(p["draftsSelectedIn"]), as_of=when))
    return out

def main():
    season = int(sys.argv[1]) if len(sys.argv) > 1 else 2026
    ours = get(f"{SUPABASE}/players?select=id,name,position,nfl_team&limit=1000", {"apikey": KEY, **UA})
    by_name = {}
    for p in ours:
        by_name.setdefault((norm(p["name"]), p["position"]), []).append(p)
    by_def_team = {p["nfl_team"]: p["id"] for p in ours if p["position"] == "DEF"}

    rows, sources_used = [], []
    for (fmt, scoring, qb), choices in PLAN:
        label = f"{fmt}/{scoring}/{qb}"
        for source, kind, arg in choices:
            try:
                data = load_mfl(season, arg) if kind == "mfl" else load_ffc(season, arg)
            except Exception as e:
                print(f"  {label}: {source} failed ({e})")
                continue
            if len(data) < MIN_PLAYERS:
                print(f"  {label}: {source} has only {len(data)} players, skipping")
                continue
            matched, missing = 0, []
            for p in data:
                pid = None
                if p["pos"] == "DEF" and p["team"] in by_def_team and kind == "ffc":
                    pid = by_def_team[p["team"]]
                else:
                    cands = by_name.get((norm(p["name"]), p["pos"]), [])
                    pid = cands[0]["id"] if len(cands) == 1 else next((c["id"] for c in cands if c["nfl_team"] == p["team"]), None)
                if pid is None:
                    missing.append(p["name"])
                    continue
                matched += 1
                n = lambda v: "null" if v is None else v
                rows.append("(%d,'%s',%d,'%s','%s','%s',%s,%s,%s,%s,%s,12,%s)" % (
                    pid, source, season, fmt, scoring, qb, round(p["adp"], 1), n(p["high"]), n(p["low"]), n(p["stdev"]), n(p["n"]),
                    "'%s'" % p["as_of"] if p["as_of"] else "null"))
            print(f"  {label}: {source}, {len(data)} players, {matched} matched, {len(missing)} not in your player list")
            sources_used.append(source)
            break  # first good source wins for this setup

    sql = (f"-- ADP for the {season} season. Sources: {', '.join(sorted(set(sources_used)))}.\n"
           "-- Run migration 0006 first. Safe to re-run: existing rows are updated.\n"
           "insert into adp (player_id, source, season, format, scoring, qb_type, adp, high, low, stdev, times_drafted, teams, as_of) values\n"
           + ",\n".join(rows) +
           "\non conflict (player_id, source, season, format, scoring, qb_type) do update set\n"
           "  adp=excluded.adp, high=excluded.high, low=excluded.low, stdev=excluded.stdev,\n"
           "  times_drafted=excluded.times_drafted, teams=excluded.teams, as_of=excluded.as_of;\n")
    out = f"supabase/seed/adp_{season}.sql"
    open(out, "w").write(sql)
    print(f"wrote {len(rows)} ADP rows to {out}")

main()
