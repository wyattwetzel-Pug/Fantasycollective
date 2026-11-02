import { ImportError, currentSeason, fetchJson, isMyTeam, type ImportedLeague } from "./types";

type Resp = {
  rosters?: { team: { id: number; name: string }; players?: { proPlayer?: { nameFull: string; position: string; proTeamAbbreviation?: string } }[] }[];
};
type Standings = { league?: { name?: string } };

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

  return [{
    externalId: leagueId,
    name: standings.data?.league?.name || `Fleaflicker league ${leagueId}`,
    scoring: null, qbType: null, format: null,
    settings: { total_rosters: rosters.data.rosters.length },
    teams: rosters.data.rosters.map((r) => ({
      name: r.team.name,
      mine: isMyTeam(r.team.name, r.team.id, input.myTeam),
      players: (r.players ?? []).flatMap((p) => p.proPlayer
        ? [{ ref: { name: p.proPlayer.nameFull, position: p.proPlayer.position, team: p.proPlayer.proTeamAbbreviation ?? null }, slot: "bench" as const }]
        : []),
    })),
  }];
}
