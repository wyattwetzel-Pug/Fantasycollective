import { ImportError, currentSeason, fetchJson, isMyTeam, type ImportedLeague, type Slot } from "./types";

type One<T> = T | T[];
const list = <T,>(x: One<T> | undefined): T[] => (x === undefined ? [] : Array.isArray(x) ? x : [x]);

type Rosters = { rosters?: { franchise?: One<{ id: string; player?: One<{ id: string; status?: string }> }> }; error?: unknown };
type League = { league?: { name?: string; franchises?: { franchise?: One<{ id: string; name: string }> } } };
type Players = { players?: { player?: One<{ id: string; name: string; position: string; team: string }> } };

const MFL = "https://api.myfantasyleague.com";

// MFL's roster export doesn't include who is starting, so only injured reserve is separated out.
export async function importMfl(input: { leagueId: string; myTeam: string }): Promise<ImportedLeague[]> {
  const leagueId = input.leagueId.match(/\d{3,}/)?.[0];
  if (!leagueId) throw new ImportError("Enter your MyFantasyLeague league ID (the number after L= in your league's web address).");

  const season = currentSeason();
  const base = `${MFL}/${season}/export?L=${leagueId}&JSON=1`;
  const [rosters, league, players] = await Promise.all([
    fetchJson<Rosters>(`${base}&TYPE=rosters`),
    fetchJson<League>(`${base}&TYPE=league`),
    fetchJson<Players>(`${MFL}/${season}/export?TYPE=players&DETAILS=0&JSON=1`),
  ]);
  const franchises = list(rosters.data?.rosters?.franchise);
  if (!franchises.length) {
    throw new ImportError(`MyFantasyLeague didn't share rosters for league ${leagueId}. The league ID may be wrong, or the commissioner hasn't made rosters public.`);
  }

  const info = new Map(list(players.data?.players?.player).map((p) => [p.id, p]));
  const names = new Map(list(league.data?.league?.franchises?.franchise).map((f) => [f.id, f.name]));
  // MFL writes names as "Last, First".
  const flip = (n: string) => (n.includes(",") ? n.split(",").map((s) => s.trim()).reverse().join(" ") : n);

  return [{
    externalId: leagueId,
    name: league.data?.league?.name || `MFL league ${leagueId}`,
    scoring: null, qbType: null, format: null,
    settings: { total_rosters: franchises.length },
    teams: franchises.map((f) => {
      const name = names.get(f.id) ?? `Team ${f.id}`;
      return {
        name,
        mine: isMyTeam(name, Number(f.id), input.myTeam),
        players: list(f.player).flatMap((pl) => {
          const p = info.get(pl.id);
          if (!p) return [];
          const slot: Slot = pl.status === "INJURED_RESERVE" ? "ir" : "bench";
          return [{ ref: { name: flip(p.name), position: p.position, team: p.team }, slot }];
        }),
      };
    }),
  }];
}
