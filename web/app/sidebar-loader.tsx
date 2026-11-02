import { createClient } from "@/lib/supabase/server";
import { Sidebar } from "./sidebar";

// Looks up the signed-in user's role so the sidebar can show My Lists / Admin.
export async function SidebarLoader() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: me } = user
    ? await supabase.from("profiles").select("is_admin").eq("id", user.id).single()
    : { data: null };
  return <Sidebar isAdmin={!!me?.is_admin} />;
}
