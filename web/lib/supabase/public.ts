import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// A client with no login attached. For public data (consensus, published lists, news) that can be
// cached and shared between visitors.
export function publicClient(): SupabaseClient {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false } });
}
