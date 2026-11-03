import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

// Who is signed in, read from the login token itself instead of asking Supabase over the network
// (the layout, the sidebar and the page all need this on every visit).
export const sessionUser = cache(async (): Promise<{ id: string } | null> => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const id = data?.claims?.sub;
  return id ? { id } : null;
});

export type Profile = { display_name: string | null; is_admin: boolean; role: string };

// The signed-in person's profile, fetched once per visit however many parts of the page ask.
export const profileOf = cache(async (id: string): Promise<Profile | null> => {
  const supabase = await createClient();
  const { data } = await supabase.from("profiles").select("display_name, is_admin, role").eq("id", id).maybeSingle<Profile>();
  return data;
});
