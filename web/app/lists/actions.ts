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

const FORMATS = ["redraft", "dynasty"];
const SCORINGS = ["ppr", "half", "std"];
const QB_TYPES = ["1qb", "superflex"];

// Copies a saved list to every other setting that has no ranked players yet, as drafts.
// Lists you've already ranked are never touched.
export async function copyListToOtherSettings(setId: number) {
  const { supabase, user } = await requireContributor();

  const { data: source } = await supabase.from("ranking_sets").select("id, format, scoring, qb_type").eq("id", setId).eq("contributor_id", user.id).maybeSingle();
  if (!source) return { ok: false as const, error: "List not found." };

  const rows: { player_id: number; rank: number; tier: string | null; note: string | null; needs_ranking: boolean }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from("rankings").select("player_id, rank, tier, note, needs_ranking").eq("set_id", setId).order("rank").range(from, from + 999);
    if (error) return { ok: false as const, error: error.message };
    rows.push(...(data ?? []));
    if ((data?.length ?? 0) < 1000) break;
  }
  if (!rows.some((r) => !r.needs_ranking)) return { ok: false as const, error: "Rank some players in this list first." };

  const copied: string[] = [];
  const skipped: string[] = [];
  for (const format of FORMATS) for (const scoring of SCORINGS) for (const qb_type of QB_TYPES) {
    if (format === source.format && scoring === source.scoring && qb_type === source.qb_type) continue;
    const label = `${format} ${scoring} ${qb_type}`;
    const combo = { contributor_id: user.id, format, scoring, qb_type };

    let { data: target } = await supabase.from("ranking_sets").select("id").match(combo).maybeSingle();
    if (target) {
      const { count } = await supabase.from("rankings").select("player_id", { count: "exact", head: true }).eq("set_id", target.id).eq("needs_ranking", false);
      if ((count ?? 0) > 0) { skipped.push(label); continue; }
    } else {
      const { data: made, error } = await supabase.from("ranking_sets").insert(combo).select("id").single();
      if (error || !made) return { ok: false as const, error: error?.message ?? "Could not create a list." };
      target = made;
    }

    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await supabase.from("rankings")
        .upsert(rows.slice(i, i + 500).map((r) => ({ ...r, set_id: target!.id })), { onConflict: "set_id,player_id" });
      if (error) return { ok: false as const, error: error.message };
    }
    copied.push(label);
  }

  return { ok: true as const, copied: copied.length, skipped: skipped.length };
}
