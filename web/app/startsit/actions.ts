"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// A contributor records which of two players they would start.
export async function postCall(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: me } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (me?.role !== "contributor") redirect("/startsit");

  const a = Number(formData.get("player_a"));
  const b = Number(formData.get("player_b"));
  const pick = Number(formData.get("pick"));
  const week = Number(formData.get("week"));
  if (![a, b, pick, week].every(Number.isInteger) || (pick !== a && pick !== b) || week < 1 || week > 22) return;

  await supabase.from("start_sit_calls").insert({
    contributor_id: user.id,
    season: Number(formData.get("season")),
    week,
    player_a: a,
    player_b: b,
    pick,
    reason: String(formData.get("reason") ?? "").trim() || null,
  });
  revalidatePath("/startsit");
}
