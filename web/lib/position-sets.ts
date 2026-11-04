import type { SupabaseClient } from "@supabase/supabase-js";

// Position lists (QB, RB, WR, TE, FLEX, K, DST) don't change with Superflex. They are kept on a
// contributor's 1 QB list for that format and scoring, and the Superflex list reads and writes the same ones.
// Only the Overall list differs. Returns the set that holds the position lists for each set given.
export async function positionSetIds(db: SupabaseClient, setIds: number[]): Promise<Map<number, number>> {
  const out = new Map<number, number>(setIds.map((id) => [id, id]));
  if (!setIds.length) return out;
  type S = { id: number; contributor_id: string; format: string; scoring: string; qb_type: string };
  const { data: sets } = await db.from("ranking_sets").select("id, contributor_id, format, scoring, qb_type").in("id", setIds).returns<S[]>();
  const sf = (sets ?? []).filter((s) => s.qb_type !== "1qb");
  if (!sf.length) return out;
  const { data: ones } = await db.from("ranking_sets").select("id, contributor_id, format, scoring, qb_type")
    .eq("qb_type", "1qb").in("contributor_id", [...new Set(sf.map((s) => s.contributor_id))]).returns<S[]>();
  sf.forEach((s) => {
    const one = (ones ?? []).find((o) => o.contributor_id === s.contributor_id && o.format === s.format && o.scoring === s.scoring);
    if (one) out.set(s.id, one.id);
  });
  return out;
}

export async function positionSetId(db: SupabaseClient, setId: number): Promise<number> {
  return (await positionSetIds(db, [setId])).get(setId) ?? setId;
}
