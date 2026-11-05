"use server";

import { positionSetId } from "@/lib/position-sets";
import { redirect } from "next/navigation";
import { updateTag } from "next/cache";
import { createClient } from "@/lib/supabase/server";

async function requireContributor() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: me } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (me?.role !== "contributor") redirect("/rankings");
  return { supabase, user };
}

// Opens the contributor's list for this format, creating it (with every player) if needed.
export async function createList(formData: FormData) {
  const { supabase, user } = await requireContributor();
  const combo = {
    contributor_id: user.id,
    format: String(formData.get("format")),
    scoring: String(formData.get("scoring")),
    qb_type: String(formData.get("qb_type")),
  };

  // Edit right on the Rankings page, for the settings that are showing.
  const inline = `/rankings?${new URLSearchParams({ format: combo.format, scoring: combo.scoring, qb: combo.qb_type, edit: "1" })}`;

  const { data: existing } = await supabase
    .from("ranking_sets").select("id").match(combo).maybeSingle();
  if (existing) redirect(inline);

  const { error } = await supabase.from("ranking_sets").insert(combo);
  if (error) redirect("/rankings");
  redirect(inline);
}

export type SaveItem = {
  player_id: number;
  rank: number;
  tier: string | null;
  note: string | null;
  needs_ranking: boolean;
};

// Saves the whole ordering, sets published or draft, then refreshes the consensus.
export async function saveList(setId: number, items: SaveItem[], published: boolean) {
  const { supabase } = await requireContributor();

  const { error } = await supabase
    .from("rankings")
    .upsert(items.map((i) => ({ ...i, set_id: setId })), { onConflict: "set_id,player_id" });
  if (error) return { ok: false as const, error: error.message };

  const { error: pubError } = await supabase.from("ranking_sets").update({ published }).eq("id", setId);
  if (pubError) return { ok: false as const, error: pubError.message };

  const { error: refreshError } = await supabase.rpc("refresh_consensus");
  if (refreshError) return { ok: false as const, error: refreshError.message };

  updateTag("rankings");
  return { ok: true as const };
}

const SCOPES = ["QB", "RB", "WR", "TE", "K", "DEF", "FLEX"];

// Saves one position's own ranking (its order and tiers), separate from the Overall list.
export async function saveScopeList(setId: number, scope: string, items: { player_id: number; rank: number; tier: string | null }[]) {
  const { supabase, user } = await requireContributor();
  if (!SCOPES.includes(scope)) return { ok: false as const, error: "Unknown position." };
  const { data: set } = await supabase.from("ranking_sets").select("id").eq("id", setId).eq("contributor_id", user.id).maybeSingle();
  if (!set) return { ok: false as const, error: "List not found." };
  const target = await positionSetId(supabase, setId);

  for (let i = 0; i < items.length; i += 500) {
    const { error } = await supabase.from("position_rankings")
      .upsert(items.slice(i, i + 500).map((r) => ({ ...r, set_id: target, scope })), { onConflict: "set_id,scope,player_id" });
    if (error) return { ok: false as const, error: error.message };
  }
  // Counts as an edit, so the list stays fresh for the consensus (position lists don't touch it themselves).
  await supabase.from("ranking_sets").update({ updated_at: new Date().toISOString() }).in("id", [...new Set([setId, target])]);

  updateTag("rankings");
  return { ok: true as const };
}

// Throws away a hand-edited Flex list, so Flex goes back to following the RB, WR and TE lists.
export async function resetFlexList(setId: number) {
  const { supabase, user } = await requireContributor();
  const { data: set } = await supabase.from("ranking_sets").select("id").eq("id", setId).eq("contributor_id", user.id).maybeSingle();
  if (!set) return { ok: false as const, error: "List not found." };
  const target = await positionSetId(supabase, setId);
  const { error } = await supabase.from("position_rankings").delete().eq("set_id", target).eq("scope", "FLEX");
  if (error) return { ok: false as const, error: error.message };
  await supabase.from("ranking_sets").update({ updated_at: new Date().toISOString() }).in("id", [...new Set([setId, target])]);
  updateTag("rankings");
  return { ok: true as const };
}

export type CopiedRankings = {
  label: string;
  overall: { player_id: number; tier: string; note: string; placed: boolean }[];
  scopes: Record<string, { player_id: number; tier: string }[]>;
};

// Replaces this list (Overall and every position list in the copy) with rankings copied from another setting.
export async function pasteRankings(setId: number, clip: CopiedRankings) {
  const { supabase, user } = await requireContributor();
  const { data: set } = await supabase.from("ranking_sets").select("id").eq("id", setId).eq("contributor_id", user.id).maybeSingle();
  if (!set) return { ok: false as const, error: "List not found." };

  for (let i = 0; i < clip.overall.length; i += 500) {
    const { error } = await supabase.from("rankings").upsert(
      clip.overall.slice(i, i + 500).map((r, k) => ({ set_id: setId, player_id: r.player_id, rank: i + k + 1, tier: r.tier || null, note: r.note || null, needs_ranking: !r.placed })),
      { onConflict: "set_id,player_id" },
    );
    if (error) return { ok: false as const, error: error.message };
  }
  // Position lists are shared with the Superflex list, so they only come in when pasting onto the one that holds them.
  const holder = await positionSetId(supabase, setId);
  for (const [scope, list] of holder === setId ? Object.entries(clip.scopes) : []) {
    if (!SCOPES.includes(scope) || !list.length) continue;
    const { error: delError } = await supabase.from("position_rankings").delete().eq("set_id", setId).eq("scope", scope);
    if (delError) return { ok: false as const, error: delError.message };
    for (let i = 0; i < list.length; i += 500) {
      const { error } = await supabase.from("position_rankings").insert(
        list.slice(i, i + 500).map((r, k) => ({ set_id: setId, scope, player_id: r.player_id, rank: i + k + 1, tier: r.tier || null })),
      );
      if (error) return { ok: false as const, error: error.message };
    }
  }
  await supabase.from("ranking_sets").update({ updated_at: new Date().toISOString() }).eq("id", setId);
  const { error: refreshError } = await supabase.rpc("refresh_consensus");
  if (refreshError) return { ok: false as const, error: refreshError.message };
  updateTag("rankings");
  return { ok: true as const };
}
