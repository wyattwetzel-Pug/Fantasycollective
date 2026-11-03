import { sessionUser, profileOf } from "@/lib/session";
import { Sidebar } from "./sidebar";

// Looks up the signed-in user's role so the sidebar can show My Lists / Admin.
export async function SidebarLoader() {
  const user = await sessionUser();
  const me = user ? await profileOf(user.id) : null;
  return <Sidebar isAdmin={!!me?.is_admin} />;
}
