"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

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
