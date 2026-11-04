"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { logEvent } from "@/lib/supabase/service";

const back = (key: "error" | "message", text: string) =>
  redirect(`/login?${key}=${encodeURIComponent(text)}`);

export async function signIn(formData: FormData) {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: String(formData.get("email")),
    password: String(formData.get("password")),
  });
  if (error) back("error", error.message);
  await logEvent("login", { userId: data?.user?.id });
  redirect("/rankings");
}

export async function signUp(formData: FormData) {
  const supabase = await createClient();
  const origin = (await headers()).get("origin") ?? "http://localhost:3000";
  const { data, error } = await supabase.auth.signUp({
    email: String(formData.get("email")),
    password: String(formData.get("password")),
    options: {
      data: { display_name: String(formData.get("display_name") || "") || undefined },
      emailRedirectTo: `${origin}/auth/callback`,
    },
  });
  if (error) back("error", error.message);
  await logEvent("signup", { userId: data.user?.id });
  if (data.session) redirect("/rankings");
  back("message", "Check your email for a confirmation link, then log in.");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
