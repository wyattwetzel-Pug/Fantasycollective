import { createClient } from "@supabase/supabase-js";

// Sends the browser to a player's headshot (or a defense's team logo) on Sleeper's image server.
// The redirect is cached so each photo costs one lookup per browser per day.
export async function GET(_req: Request, ctx: RouteContext<"/photo/[id]">) {
  const { id } = await ctx.params;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const pid = Number(id);
  if (!url || !key || !Number.isInteger(pid)) return new Response(null, { status: 404 });

  const db = createClient(url, key, { auth: { persistSession: false } });
  const { data } = await db.from("players").select("external_id, position, nfl_team").eq("id", pid).maybeSingle();
  if (!data) return new Response(null, { status: 404 });

  const target = data.position === "DEF"
    ? data.nfl_team && `https://sleepercdn.com/images/team_logos/nfl/${data.nfl_team.toLowerCase()}.png`
    : data.external_id && `https://sleepercdn.com/content/nfl/players/thumb/${data.external_id}.jpg`;
  if (!target) return new Response(null, { status: 404 });

  return new Response(null, { status: 302, headers: { Location: target, "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800" } });
}
