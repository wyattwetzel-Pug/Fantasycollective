"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

const SLEEPER = "https://api.sleeper.app/v1";

type SLeague = {
  league_id: string; name: string; total_rosters?: number;
  scoring_settings?: Record<string, number>; roster_positions?: string[]; settings?: { type?: number };
};
type SRoster = { roster_id: number; owner_id: string | null; players: string[] | null; starters: string[] | null; reserve: string[] | null };
type SUser = { user_id: string; display_name: string; metadata?: { team_name?: string } };

async function sleeper<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${SLEEPER}${path}`, { cache: "no-store" });
    return res.ok ? ((await res.json()) as T | null) : null;
  } catch {
    return null;
  }
}

const back = (key: "error" | "msg", text: string) => redirect(`/teams?${key}=${encodeURIComponent(text)}`);

// Pulls a Sleeper user's leagues and every team's roster into the database.
export async function syncSleeper(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const username = String(formData.get("username") ?? "").trim();
  if (!username) back("error", "Enter your Sleeper username.");

  const sUser = await sleeper<{ user_id: string }>(`/user/${encodeURIComponent(username)}`);
  if (!sUser?.user_id) back("error", `Couldn't find a Sleeper user named "${username}".`);

  const now = new Date();
  const season = now.getMonth() < 2 ? now.getFullYear() - 1 : now.getFullYear();
  const leagues = (await sleeper<SLeague[]>(`/user/${sUser!.user_id}/leagues/nfl/${season}`)) ?? [];
  if (!leagues.length) back("error", `No ${season} NFL leagues found for ${username}.`);

  const { data: ours } = await supabase.from("players").select("id, external_id").limit(1000);
  const idBySleeper = new Map((ours ?? []).map((p) => [p.external_id as string, p.id as number]));

  let synced = 0;
  for (const lg of leagues.slice(0, 12)) {
    const [rosters, users] = await Promise.all([
      sleeper<SRoster[]>(`/league/${lg.league_id}/rosters`),
      sleeper<SUser[]>(`/league/${lg.league_id}/users`),
    ]);
    if (!rosters) continue;

    const rec = lg.scoring_settings?.rec ?? 0;
    const { data: row, error } = await supabase
      .from("leagues")
      .upsert({
        user_id: user.id, platform: "sleeper", external_league_id: lg.league_id, name: lg.name,
        scoring: rec >= 1 ? "ppr" : rec >= 0.5 ? "half" : "std",
        qb_type: (lg.roster_positions ?? []).includes("SUPER_FLEX") ? "superflex" : "1qb",
        format: lg.settings?.type === 2 ? "dynasty" : "redraft",
        roster_settings: { positions: lg.roster_positions ?? [], sleeper_user_id: sUser!.user_id, total_rosters: lg.total_rosters ?? rosters.length },
        synced_at: new Date().toISOString(),
      }, { onConflict: "user_id,platform,external_league_id" })
      .select("id").single();
    if (error || !row) continue;

    const nameOf = new Map((users ?? []).map((u) => [u.user_id, u.metadata?.team_name || u.display_name]));
    const used = new Set<string>();
    const out: { league_id: number; team_name: string; is_mine: boolean; player_id: number; slot: string }[] = [];
    for (const r of rosters) {
      let team = (r.owner_id && nameOf.get(r.owner_id)) || `Team ${r.roster_id}`;
      if (used.has(team)) team = `${team} (${r.roster_id})`;
      used.add(team);
      const starters = new Set(r.starters ?? []);
      const reserve = new Set(r.reserve ?? []);
      for (const sid of new Set([...(r.players ?? []), ...reserve])) {
        const pid = idBySleeper.get(sid);
        if (!pid) continue;
        out.push({ league_id: row.id, team_name: team, is_mine: r.owner_id === sUser!.user_id, player_id: pid, slot: starters.has(sid) ? "starter" : reserve.has(sid) ? "ir" : "bench" });
      }
    }

    await supabase.from("league_rosters").delete().eq("league_id", row.id);
    for (let i = 0; i < out.length; i += 500) {
      const { error: insErr } = await supabase.from("league_rosters").insert(out.slice(i, i + 500));
      if (insErr) back("error", `Saved ${synced} leagues, then failed on ${lg.name}: ${insErr.message}`);
    }
    synced++;
  }

  revalidatePath("/teams");
  back("msg", `Synced ${synced} league${synced === 1 ? "" : "s"} from Sleeper.`);
}

export async function removeLeague(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  await supabase.from("leagues").delete().eq("id", Number(formData.get("id"))).eq("user_id", user.id);
  revalidatePath("/teams");
  redirect("/teams");
}
