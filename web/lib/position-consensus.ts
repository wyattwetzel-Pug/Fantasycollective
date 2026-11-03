import type { SupabaseClient } from "@supabase/supabase-js";
import { TIER_ORDER } from "@/lib/tier-config";
import { fixTiers } from "@/lib/tiers";
import { nowMs } from "@/lib/time";

type Player = { name: string; position: string; nfl_team: string | null };
type Entry = { rank: number; tier: string | null };
export type PosRow = { id: number; name: string; position: string; team: string | null; tier: string | null };
export type Combo = { format: string; scoring: string; qb_type: string };

const DAY = 24 * 60 * 60 * 1000;
const GROUPS: Record<string, string[]> = { FLEX: ["RB", "WR", "TE"] };

// The consensus for one position: the average of the contributors' own position rankings.
// A contributor who hasn't made one for that position counts with their Overall list for it.
// Lists untouched for over a week are left out (unless every list is that old).
export async function positionConsensus(supabase: SupabaseClient, combo: Combo, scope: string): Promise<PosRow[] | null> {
  const { data: sets } = await supabase.from("ranking_sets").select("id, updated_at").match(combo).eq("published", true).returns<{ id: number; updated_at: string }[]>();
  if (!sets?.length) return null;
  const fresh = sets.filter((s) => nowMs() - new Date(s.updated_at).getTime() < 7 * DAY);
  const group = GROUPS[scope] ?? [scope];

  type Row = { player_id: number; rank: number; tier: string | null; players: Player | null };
  const info = new Map<number, Player>();
  const perPlayer = new Map<number, Entry[]>();
  for (const src of fresh.length ? fresh : sets) {
    const { data: own } = await supabase
      .from("position_rankings").select("player_id, rank, tier, players(name, position, nfl_team)")
      .eq("set_id", src.id).eq("scope", scope).order("rank").limit(1000).returns<Row[]>();
    let list = own ?? [];
    if (!list.length) {
      const { data: all } = await supabase
        .from("rankings").select("player_id, rank, tier, players(name, position, nfl_team)")
        .eq("set_id", src.id).eq("needs_ranking", false).order("rank").limit(1000).returns<Row[]>();
      list = (all ?? []).filter((r) => r.players && group.includes(r.players.position)).map((r, i) => ({ ...r, rank: i + 1 }));
    }
    list.forEach((r) => {
      if (r.players) info.set(r.player_id, r.players);
      perPlayer.set(r.player_id, [...(perPlayer.get(r.player_id) ?? []), { rank: r.rank, tier: r.tier }]);
    });
  }
  if (!perPlayer.size) return null;

  const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const ordered = fixTiers([...perPlayer.entries()].map(([pid, es]) => {
    const tiers = es.map((e) => (e.tier ? TIER_ORDER.indexOf(e.tier) : -1)).filter((i) => i >= 0);
    return { player_id: pid, avg: avg(es.map((e) => e.rank)), tier: tiers.length ? TIER_ORDER[Math.round(avg(tiers))] : null };
  }).sort((a, b) => a.avg - b.avg));
  return ordered.map((r) => {
    const pl = info.get(r.player_id);
    return { id: r.player_id, name: pl?.name ?? "Unknown", position: pl?.position ?? "", team: pl?.nfl_team ?? null, tier: r.tier };
  });
}

// Each player's rank at his own position on the consensus (QB 1, RB 12, ...).
export async function positionRankMap(supabase: SupabaseClient, combo: Combo): Promise<Map<number, number>> {
  const out = new Map<number, number>();
  await Promise.all(["QB", "RB", "WR", "TE", "K", "DEF"].map(async (pos) => {
    (await positionConsensus(supabase, combo, pos))?.forEach((r, i) => out.set(r.id, i + 1));
  }));
  return out;
}
