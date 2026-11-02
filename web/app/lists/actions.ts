"use server";

import { redirect } from "next/navigation";
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

  return { ok: true as const };
}
