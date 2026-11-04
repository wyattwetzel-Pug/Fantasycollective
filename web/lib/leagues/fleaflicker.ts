import { ImportError, currentSeason, fetchJson, isMyTeam, type ImportedLeague, type Season } from "./types";

type Resp = {
  rosters?: { team: { id: number; name: string }; players?: { proPlayer?: { nameFull: string; position: string; proTeamAbbreviation?: string } }[] }[];
};
type Standings = { league?: { name?: string }; divisions?: { teams?: { id: number; name: string; recordOverall?: { wins?: number; losses?: number; ties?: number } }[] }[] };
type Sched = { games?: { away?: { id: number }; home?: { id: number } }[] };
const GAMES = 14;

const API = "https://www.fleaflicker.com/api";

// Fleaflicker's public roster feed doesn't say who is starting, so everyone lands on the bench.
export async function importFleaflicker(input: { leagueId: string; myTeam: string }): Promise<ImportedLeague[]> {
  const leagueId = input.leagueId.match(/\d{3,}/)?.[0];
  if (!leagueId) throw new ImportError("Enter your Fleaflicker league ID (the number in your league's web address).");

  const season = currentSeason();
  const q = `sport=NFL&league_id=${leagueId}&season=${season}`;
  const [rosters, standings] = await Promise.all([
    fetchJson<Resp>(`${API}/FetchLeagueRosters?${q}`),
    fetchJson<Standings>(`${API}/FetchLeagueStandings?${q}`),
  ]);
  if (!rosters.data?.rosters?.length) throw new ImportError(`Fleaflicker has no ${season} league with ID ${leagueId}, or it isn't public.`);

  // Records so far and who each team still plays, so standings can be projected. Weeks after the games already
  // played count as remaining. If Fleaflicker doesn't share them, the league just has no season data.
  let seasonData: Season | undefined;
  try {
    const teams = (standings.data?.divisions ?? []).flatMap((d) => d.teams ?? []);
    if (teams.length) {
      const nameOf = new Map(teams.map((t) => [t.id, t.name]));
      const sched: Season = { games: GAMES, records: {}, remaining: {} };
      teams.forEach((t) => { sched.records[t.name] = { w: t.recordOverall?.wins ?? 0, l: t.recordOverall?.losses ?? 0, t: t.recordOverall?.ties ?? 0 }; sched.remaining[t.name] = []; });
      const played = Math.max(0, ...Object.values(sched.records).map((r) => r.w + r.l + r.t));
      const weeks = Array.from({ length: GAMES - played }, (_, i) => played + i + 1);
      const results = await Promise.all(weeks.map((w) => fetchJson<Sched>(`${API}/FetchLeagueSchedule?${q}&scoring_period=${w}`)));
      results.forEach((r) => (r.data?.games ?? []).forEach((g) => {
        const a = nameOf.get(g.home?.id ?? -1), b = nameOf.get(g.away?.id ?? -1);
        if (a && b) { sched.remaining[a].push(b); sched.remaining[b].push(a); }
      }));
      seasonData = sched;
    }
  } catch { /* no season data */ }

  return [{
    externalId: leagueId,
    name: standings.data?.league?.name || `Fleaflicker league ${leagueId}`,
    scoring: null, qbType: null, format: null,
    settings: { total_rosters: rosters.data.rosters.length, ...(seasonData ? { season: seasonData } : {}) },
    teams: rosters.data.rosters.map((r) => ({
      name: r.team.name,
      mine: isMyTeam(r.team.name, r.team.id, input.myTeam),
      players: (r.players ?? []).flatMap((p) => p.proPlayer
        ? [{ ref: { name: p.proPlayer.nameFull, position: p.proPlayer.position, team: p.proPlayer.proTeamAbbreviation ?? null }, slot: "bench" as const }]
        : []),
    })),
  }];
}
