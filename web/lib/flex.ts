import type { SupabaseClient } from "@supabase/supabase-js";
import { fixTiers } from "@/lib/tiers";
import { positionSetId } from "@/lib/position-sets";

export const FLEX_POSITIONS = ["RB", "WR", "TE"];

type Base = { player_id: number; position: string; tier: string | null };

// A contributor's Flex list, built from their RB, WR and TE lists. The three lists can't just be glued
// together, so Overall decides how they interleave: each position's players take the Overall spots that
// position holds, in the order of that position's own list. Tiers come from the position lists.
// A position with no list of its own simply follows Overall. Players the lists don't cover are left out.
// Overall must be in rank order, and only hold ranked players.
export function deriveFlex(overall: Base[], lists: Partial<Record<string, Base[]>>): { player_id: number; tier: string | null }[] {
  const out: { player_id: number; slot: number; tier: string | null; pos: number }[] = [];
  FLEX_POSITIONS.forEach((pos, pi) => {
    const own = (lists[pos] ?? []).filter((p) => p.position === pos);
    const slots = overall.flatMap((o, i) => (o.position === pos ? [i] : []));
    if (!own.length) {
      overall.forEach((o, i) => { if (o.position === pos) out.push({ player_id: o.player_id, slot: i, tier: o.tier, pos: pi }); });
      return;
    }
    own.forEach((p, i) => out.push({ player_id: p.player_id, slot: i < slots.length ? slots[i] : overall.length + i, tier: p.tier, pos: pi }));
  });
  out.sort((a, b) => a.slot - b.slot || a.pos - b.pos);
  return fixTiers(out.map((x) => ({ player_id: x.player_id, tier: x.tier })));
}

export type FlexRow = { player_id: number; rank: number; tier: string | null; players: { name: string; position: string; nfl_team: string | null } | null };

// One contributor's Flex list as it should be shown: their own saved Flex list if they edited it,
// otherwise the one built from their RB, WR and TE lists.
export async function loadFlex(db: SupabaseClient, setId: number): Promise<FlexRow[]> {
  const holder = await positionSetId(db, setId);
  const cols = "player_id, rank, tier, players(name, position, nfl_team)";
  const { data: own } = await db.from("position_rankings").select(cols).eq("set_id", holder).eq("scope", "FLEX").not("tier", "is", null).order("rank").limit(1000).returns<FlexRow[]>();
  if (own?.length) return own;

  const [all, ...byPos] = await Promise.all([
    db.from("rankings").select(cols).eq("set_id", setId).eq("needs_ranking", false).not("tier", "is", null).order("rank").limit(1000).returns<FlexRow[]>(),
    ...FLEX_POSITIONS.map((sc) => db.from("position_rankings").select(cols).eq("set_id", holder).eq("scope", sc).not("tier", "is", null).order("rank").limit(1000).returns<FlexRow[]>()),
  ]);
  const info = new Map<number, FlexRow["players"]>();
  const base = (rows: FlexRow[] | null): Base[] => (rows ?? []).flatMap((r) => {
    if (!r.players) return [];
    info.set(r.player_id, r.players);
    return [{ player_id: r.player_id, position: r.players.position, tier: r.tier }];
  });
  const overall = base(all.data).filter((p) => FLEX_POSITIONS.includes(p.position));
  const lists = Object.fromEntries(FLEX_POSITIONS.map((sc, i) => [sc, base(byPos[i].data)]));
  return deriveFlex(overall, lists).map((r, i) => ({ player_id: r.player_id, rank: i + 1, tier: r.tier, players: info.get(r.player_id) ?? null }));
}
