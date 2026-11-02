import { ImportError, currentSeason, fetchJson, isMyTeam, type ImportedLeague, type Slot } from "./types";

const POS: Record<number, string> = { 1: "QB", 2: "RB", 3: "WR", 4: "TE", 5: "K", 16: "DEF" };
const TEAMS: Record<number, string> = {
  1: "ATL", 2: "BUF", 3: "CHI", 4: "CIN", 5: "CLE", 6: "DAL", 7: "DEN", 8: "DET", 9: "GB", 10: "TEN", 11: "IND", 12: "KC", 13: "LV", 14: "LAR",
  15: "MIA", 16: "MIN", 17: "NE", 18: "NO", 19: "NYG", 20: "NYJ", 21: "PHI", 22: "ARI", 23: "PIT", 24: "LAC", 25: "SF", 26: "SEA", 27: "TB",
  28: "WAS", 29: "CAR", 30: "JAX", 33: "BAL", 34: "HOU",
};
const BENCH = 20, IR = 21, OP = "7";
const PTS_PER_RECEPTION = 53;

type Entry = { lineupSlotId: number; playerPoolEntry?: { player?: { fullName?: string; defaultPositionId?: number; proTeamId?: number } } };
type Team = { id: number; name?: string; location?: string; nickname?: string; owners?: string[]; roster?: { entries?: Entry[] } };
type Resp = {
  settings?: {
    name?: string;
    scoringSettings?: { scoringItems?: { statId: number; points?: number }[] };
    rosterSettings?: { lineupSlotCounts?: Record<string, number> };
  };
  teams?: Team[];
};

export async function importEspn(input: { leagueId: string; s2: string; swid: string; myTeam: string }): Promise<ImportedLeague[]> {
  const leagueId = input.leagueId.match(/\d{3,}/)?.[0];
  if (!leagueId) throw new ImportError("Enter your ESPN league ID (the number after leagueId= in your league's web address).");

  const season = currentSeason();
  const headers: Record<string, string> = { Accept: "application/json" };
  const s2 = input.s2.trim();
  const swid = input.swid.trim();
  if (s2 && swid) headers.Cookie = `espn_s2=${s2}; SWID=${swid.startsWith("{") ? swid : `{${swid}}`}`;

  const url = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${season}/segments/0/leagues/${leagueId}?view=mTeam&view=mRoster&view=mSettings`;
  const { status, data } = await fetchJson<Resp>(url, { headers });
  if (status === 401 || status === 403) {
    throw new ImportError(s2 && swid
      ? "ESPN rejected those cookies. They may be expired or copied wrong. Copy espn_s2 and SWID again from your browser while logged in to ESPN."
      : "This ESPN league is private. Add your espn_s2 and SWID cookies (instructions below the form) and try again.");
  }
  if (status === 404) throw new ImportError(`ESPN has no ${season} league with ID ${leagueId}.`);
  if (!data?.teams?.length) throw new ImportError("ESPN didn't return any teams for that league. Check the league ID.");

  const rec = data.settings?.scoringSettings?.scoringItems?.find((i) => i.statId === PTS_PER_RECEPTION)?.points ?? 0;
  const swidClean = swid.replace(/[{}]/g, "").toLowerCase();

  return [{
    externalId: leagueId,
    name: data.settings?.name || `ESPN league ${leagueId}`,
    scoring: rec >= 1 ? "ppr" : rec >= 0.5 ? "half" : "std",
    qbType: (data.settings?.rosterSettings?.lineupSlotCounts?.[OP] ?? 0) > 0 ? "superflex" : "1qb",
    format: null,
    settings: { total_rosters: data.teams.length },
    teams: data.teams.map((t) => {
      const name = t.name || [t.location, t.nickname].filter(Boolean).join(" ") || `Team ${t.id}`;
      const owned = !!swidClean && (t.owners ?? []).some((o) => o.replace(/[{}]/g, "").toLowerCase() === swidClean);
      return {
        name,
        mine: owned || isMyTeam(name, t.id, input.myTeam),
        players: (t.roster?.entries ?? []).flatMap((e) => {
          const p = e.playerPoolEntry?.player;
          const pos = POS[p?.defaultPositionId ?? 0];
          if (!p?.fullName || !pos) return [];
          const slot: Slot = e.lineupSlotId === IR ? "ir" : e.lineupSlotId === BENCH ? "bench" : "starter";
          return [{ ref: { name: p.fullName, position: pos, team: TEAMS[p.proTeamId ?? 0] ?? null }, slot }];
        }),
      };
    }),
  }];
}
