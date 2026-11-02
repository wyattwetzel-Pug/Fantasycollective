"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { runSync } from "@/lib/sync";

// Every action below also fails at the database level for non-admins (row-level security).
async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: me } = await supabase.from("profiles").select("is_admin").eq("id", user.id).single();
  if (!me?.is_admin) redirect("/rankings");
  return { supabase, user };
}

export async function inviteContributor(formData: FormData) {
  const { supabase, user } = await requireAdmin();
  const email = String(formData.get("email")).trim();
  if (!email) return;

  // Already has an account: promote right away. Otherwise save an invite.
  const { data: promoted } = await supabase.rpc("promote_by_email", { target_email: email });
  if (!promoted) {
    await supabase.from("invites").insert({ email, invited_by: user.id });
  }
  revalidatePath("/admin");
}

export async function revokeInvite(formData: FormData) {
  const { supabase } = await requireAdmin();
  await supabase.from("invites").delete().eq("id", Number(formData.get("id")));
  revalidatePath("/admin");
}

// Demotes to viewer and unpublishes their lists. Nothing is deleted.
export async function removeContributor(formData: FormData) {
  const { supabase } = await requireAdmin();
  const id = String(formData.get("id"));
  const { data: target } = await supabase.from("profiles").select("is_admin").eq("id", id).single();
  if (!target || target.is_admin) return; // the admin can never be removed here
  await supabase.from("ranking_sets").update({ published: false }).eq("contributor_id", id);
  await supabase.from("profiles").update({ role: "user" }).eq("id", id);
  revalidatePath("/admin");
}

// Runs the Sleeper stats, schedule and projections sync now. "backfill" loads every week of the season.
export async function syncStats(formData: FormData) {
  await requireAdmin();
  const result = await runSync({ backfill: formData.get("mode") === "backfill" });
  redirect(`/admin?sync=${encodeURIComponent((result.ok ? "OK. " : "Problem. ") + result.log.join(" "))}`);
}

// CFB prospects (Dynasty hub, CFB Rankings tab).
export async function addProspect(formData: FormData) {
  const { supabase } = await requireAdmin();
  const text = (k: string) => String(formData.get(k) ?? "").trim();
  const name = text("name"), position = text("position").toUpperCase(), school = text("school");
  if (!name || !position || !school) return;
  const { data: last } = await supabase.from("prospects").select("rank").order("rank", { ascending: false }).limit(1);
  const draft = Number(text("draft_year"));
  await supabase.from("prospects").insert({
    name, position, school, class_year: text("class_year") || null, note: text("note") || null,
    draft_year: Number.isInteger(draft) && draft > 2000 ? draft : null, rank: (last?.[0]?.rank ?? 0) + 1,
  });
  revalidatePath("/admin");
  revalidatePath("/dynasty");
}

export async function moveProspect(formData: FormData) {
  const { supabase } = await requireAdmin();
  const id = Number(formData.get("id"));
  const dir = formData.get("dir") === "up" ? -1 : 1;
  const { data } = await supabase.from("prospects").select("id").order("rank").order("id");
  const ids = (data ?? []).map((r) => r.id as number);
  const i = ids.indexOf(id), j = i + dir;
  if (i < 0 || j < 0 || j >= ids.length) return;
  [ids[i], ids[j]] = [ids[j], ids[i]];
  await Promise.all(ids.map((pid, k) => supabase.from("prospects").update({ rank: k + 1 }).eq("id", pid)));
  revalidatePath("/admin");
  revalidatePath("/dynasty");
}

export async function deleteProspect(formData: FormData) {
  const { supabase } = await requireAdmin();
  await supabase.from("prospects").delete().eq("id", Number(formData.get("id")));
  revalidatePath("/admin");
  revalidatePath("/dynasty");
}
