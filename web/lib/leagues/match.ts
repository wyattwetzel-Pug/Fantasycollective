import type { PlayerRef } from "./types";

type Row = { id: number; name: string; position: string; nfl_team: string | null; external_id: string | null };

const TEAM_FIX: Record<string, string> = { WSH: "WAS", JAC: "JAX", LA: "LAR", OAK: "LV", SD: "LAC", STL: "LAR", ARZ: "ARI", GBP: "GB", KCC: "KC", NEP: "NE", NOS: "NO", SFO: "SF", TBB: "TB", LVR: "LV" };
export const normTeam = (t: string | null | undefined) => (t ? TEAM_FIX[t.toUpperCase()] ?? t.toUpperCase() : null);

export const normPos = (p: string) => {
  const u = p.toUpperCase().replace(/[^A-Z/]/g, "");
  if (u === "D/ST" || u === "DST" || u === "DEF" || u === "TMDEF") return "DEF";
  if (u === "PK") return "K";
  if (u === "FB") return "RB";
  return u;
};

export const normName = (n: string) =>
  n.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim()
    .replace(/ (jr|sr|ii|iii|iv|v)$/, "");

// Turns a provider's player reference into our players.id (or null if we don't track that player).
export function makeMatcher(players: Row[]) {
  const bySleeper = new Map<string, number>();
  const byNamePos = new Map<string, number>();
  const byName = new Map<string, number[]>();
  const defByTeam = new Map<string, number>();
  for (const p of players) {
    if (p.external_id) bySleeper.set(p.external_id, p.id);
    if (p.position === "DEF") { if (p.nfl_team) defByTeam.set(p.nfl_team, p.id); continue; }
    byNamePos.set(`${normName(p.name)}|${p.position}`, p.id);
    byName.set(normName(p.name), [...(byName.get(normName(p.name)) ?? []), p.id]);
  }
  return (ref: PlayerRef): number | null => {
    if ("sleeperId" in ref) return bySleeper.get(ref.sleeperId) ?? null;
    const pos = normPos(ref.position);
    if (pos === "DEF") return defByTeam.get(normTeam(ref.team) ?? "") ?? null;
    const n = normName(ref.name);
    const exact = byNamePos.get(`${n}|${pos}`);
    if (exact) return exact;
    const loose = byName.get(n);
    return loose?.length === 1 ? loose[0] : null;
  };
}
