import { ImportError, currentSeason, fetchJson, type ImportedLeague, type ImportedTeam, type Slot } from "./types";

const API = "https://api.sleeper.app/v1";

type SLeague = {
  league_id: string; name: string; total_rosters?: number;
  scoring_settings?: Record<string, number>; roster_positions?: string[]; settings?: { type?: number };
};
type SRoster = { roster_id: number; owner_id: string | null; players: string[] | null; starters: string[] | null; reserve: string[] | null };
type SUser = { user_id: string; display_name: string; metadata?: { team_name?: string } };

const get = async <T>(path: string) => (await fetchJson<T>(`${API}${path}`)).data;

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

    const teams: ImportedTeam[] = rosters.map((r) => {
      const starters = new Set(r.starters ?? []);
      const reserve = new Set(r.reserve ?? []);
      return {
        name: (r.owner_id && nameOf.get(r.owner_id)) || `Team ${r.roster_id}`,
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
      settings: { positions: lg.roster_positions ?? [], sleeper_user_id: user.user_id, total_rosters: lg.total_rosters ?? rosters.length },
      teams,
    });
  }
  return out;
}
