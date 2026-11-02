import type { SupabaseClient } from "@supabase/supabase-js";

// Sleeper stores "fantasy points allowed" on each team's DEF row, per position, in PPR.
const KEYS: Record<string, string> = { QB: "fan_pts_allow_qb", RB: "fan_pts_allow_rb", WR: "fan_pts_allow_wr", TE: "fan_pts_allow_te", K: "fan_pts_allow_k" };

export type Allowed = { avg: number; games: number; rank: number; of: number };
// position -> team -> how many points that defense gives up to the position.
// rank 1 = gives up the most points (best matchup), rank "of" = the toughest defense.
export type DefenseVs = Record<string, Map<string, Allowed>>;

type Raw = { week: number; players: { nfl_team: string | null } | null; [k: string]: unknown };

export async function defenseVsPosition(db: SupabaseClient, season: number): Promise<DefenseVs> {
  const alias = Object.entries(KEYS).map(([pos, key]) => `${pos.toLowerCase()}:stats->>${key}`).join(", ");
  const { data } = await db
    .from("player_stats")
    .select(`week, ${alias}, players!inner(nfl_team, position)`)
    .eq("season", season).eq("players.position", "DEF").limit(1000)
    .returns<Raw[]>();

  const out: DefenseVs = {};
  for (const pos of Object.keys(KEYS)) {
    const sums = new Map<string, { total: number; games: number }>();
    for (const r of data ?? []) {
      const team = r.players?.nfl_team;
      const v = r[pos.toLowerCase()];
      if (!team || v === null || v === undefined) continue;
      const cur = sums.get(team) ?? { total: 0, games: 0 };
      cur.total += Number(v); cur.games += 1;
      sums.set(team, cur);
    }
    const ranked = [...sums.entries()].map(([team, s]) => ({ team, avg: s.total / s.games, games: s.games })).sort((a, b) => b.avg - a.avg);
    out[pos] = new Map(ranked.map((r, i) => [r.team, { avg: r.avg, games: r.games, rank: i + 1, of: ranked.length }]));
  }
  return out;
}

export type Grade = { label: string; color: string };
// Plain-English read on a defense: rank 1 is the friendliest matchup.
export function matchupGrade(a: Allowed | undefined): Grade {
  if (!a || a.of < 2) return { label: "No data", color: "#a1a1aa" };
  const pct = (a.rank - 1) / (a.of - 1);
  if (pct <= 0.2) return { label: "Great", color: "#39ff14" };
  if (pct <= 0.4) return { label: "Good", color: "#7dff6a" };
  if (pct <= 0.6) return { label: "Neutral", color: "#FACC15" };
  if (pct <= 0.8) return { label: "Tough", color: "#F97316" };
  return { label: "Very tough", color: "#EF4444" };
}

export const ordinal = (n: number) => {
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
};

export type GameRow = { week: number; home: string; away: string; status: string | null };
export const isOpen = (g: GameRow) => g.status !== "complete" && g.status !== "in_progress";

// Opponent team code for a game, from the perspective of `team`.
export const opponentOf = (g: GameRow, team: string) => (g.home === team ? g.away : g.home);

export const average = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
