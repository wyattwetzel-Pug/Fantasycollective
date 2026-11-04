import { ImportError, type Season, currentSeason, fetchJson, type ImportedLeague, type ImportedTeam, type Slot } from "./types";

const API = "https://api.sleeper.app/v1";

type SLeague = {
  league_id: string; name: string; total_rosters?: number;
  scoring_settings?: Record<string, number>; roster_positions?: string[]; settings?: { type?: number; playoff_week_start?: number };
};
type SRoster = { settings?: { wins?: number; losses?: number; ties?: number }; roster_id: number; owner_id: string | null; players: string[] | null; starters: string[] | null; reserve: string[] | null };
type SUser = { user_id: string; display_name: string; metadata?: { team_name?: string } };

const get = async <T>(path: string) => (await fetchJson<T>(`${API}${path}`)).data;

// Starting slots only (no bench, IR or taxi), in our own names.
type SMatch = { roster_id: number; matchup_id: number | null };

// Records so far, and who each team plays in the weeks that are left.
async function sleeperSeason(lg: SLeague, rosters: SRoster[], nameOf: (r: SRoster) => string): Promise<Season | null> {
  const games = Math.max(1, (lg.settings?.playoff_week_start ?? 15) - 1);
  const records: Season["records"] = {};
  const remaining: Season["remaining"] = {};
  const byId = new Map(rosters.map((r) => [r.roster_id, r]));
  let played = 0;
  rosters.forEach((r) => {
    const s = r.settings ?? {};
    records[nameOf(r)] = { w: s.wins ?? 0, l: s.losses ?? 0, t: s.ties ?? 0 };
    played = Math.max(played, (s.wins ?? 0) + (s.losses ?? 0) + (s.ties ?? 0));
  });
  rosters.forEach((r) => (remaining[nameOf(r)] = []));
  const weeks = Array.from({ length: Math.max(0, games - played) }, (_, i) => played + 1 + i);
  const results = await Promise.all(weeks.map((w) => get<SMatch[]>(`/league/${lg.league_id}/matchups/${w}`)));
  results.forEach((m) => {
    const groups = new Map<number, SRoster[]>();
    (m ?? []).forEach((x) => { const r = byId.get(x.roster_id); if (r && x.matchup_id) groups.set(x.matchup_id, [...(groups.get(x.matchup_id) ?? []), r]); });
    groups.forEach(([a, b]) => { if (a && b) { remaining[nameOf(a)].push(nameOf(b)); remaining[nameOf(b)].push(nameOf(a)); } });
  });
  return { games, records, remaining };
}

const SLEEPER_SLOTS: Record<string, string> = { QB: "QB", RB: "RB", WR: "WR", TE: "TE", K: "K", DEF: "DEF", FLEX: "FLEX", SUPER_FLEX: "SUPERFLEX", REC_FLEX: "WRTE", WRRB_FLEX: "RBWR" };
const sleeperLineup = (positions: string[]) => positions.map((p) => SLEEPER_SLOTS[p]).filter((p): p is string => !!p);

export async function importSleeper(username: string): Promise<ImportedLeague[]> {
  if (!username) throw new ImportError("Enter your Sleeper username.");
  const user = await get<{ user_id: string }>(`/user/${encodeURIComponent(username)}`);
  if (!user?.user_id) throw new ImportError(`Couldn't find a Sleeper user named "${username}".`);

  const season = currentSeason();
  const leagues = (await get<SLeague[]>(`/user/${user.user_id}/leagues/nfl/${season}`)) ?? [];
  if (!leagues.length) throw new ImportError(`No ${season} NFL leagues found for ${username}.`);

  const out: ImportedLeague[] = [];
  for (const lg of leagues.slice(0, 12)) {
    const [rosters, users] = await Promise.all([get<SRoster[]>(`/league/${lg.league_id}/rosters`), get<SUser[]>(`/league/${lg.league_id}/users`)]);
    if (!rosters) continue;
    const nameOf = new Map((users ?? []).map((u) => [u.user_id, u.metadata?.team_name || u.display_name]));
    const rec = lg.scoring_settings?.rec ?? 0;

    const teamName = (r: SRoster) => (r.owner_id && nameOf.get(r.owner_id)) || `Team ${r.roster_id}`;
    const season_ = await sleeperSeason(lg, rosters, teamName);
    const teams: ImportedTeam[] = rosters.map((r) => {
      const starters = new Set(r.starters ?? []);
      const reserve = new Set(r.reserve ?? []);
      return {
        name: teamName(r),
        mine: r.owner_id === user.user_id,
        players: [...new Set([...(r.players ?? []), ...reserve])].map((sid) => ({
          ref: { sleeperId: sid },
          slot: (starters.has(sid) ? "starter" : reserve.has(sid) ? "ir" : "bench") as Slot,
        })),
      };
    });
    out.push({
      externalId: lg.league_id, name: lg.name,
      scoring: rec >= 1 ? "ppr" : rec >= 0.5 ? "half" : "std",
      qbType: (lg.roster_positions ?? []).includes("SUPER_FLEX") ? "superflex" : "1qb",
      format: lg.settings?.type === 2 ? "dynasty" : "redraft",
      settings: { positions: lg.roster_positions ?? [], lineup: sleeperLineup(lg.roster_positions ?? []), sleeper_user_id: user.user_id, total_rosters: lg.total_rosters ?? rosters.length, season: season_ },
      teams,
    });
  }
  return out;
}
