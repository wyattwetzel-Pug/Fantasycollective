import { createClient } from "@supabase/supabase-js";

// Server-only client with the service role key (bypasses row level security). Null when the key isn't set,
// e.g. on a laptop without it, so callers can skip quietly.
export function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

// Records a login, sign-up or page view. Never throws: tracking must not break the site.
export async function logEvent(kind: "view" | "login" | "signup", fields: { path?: string; userId?: string | null; visitorId?: string | null } = {}) {
  try {
    const db = serviceClient();
    if (!db) return;
    await db.from("site_events").insert({ kind, path: fields.path ?? null, user_id: fields.userId ?? null, visitor_id: fields.visitorId ?? null });
  } catch {
    // ignore
  }
}
