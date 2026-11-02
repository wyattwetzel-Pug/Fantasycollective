"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { makeMatcher } from "@/lib/leagues/match";
import { importSleeper } from "@/lib/leagues/sleeper";
import { importEspn } from "@/lib/leagues/espn";
import { importFleaflicker } from "@/lib/leagues/fleaflicker";
import { importMfl } from "@/lib/leagues/mfl";
import { ImportError, type Format, type ImportedLeague, type QbType, type Scoring } from "@/lib/leagues/types";

const back = (key: "error" | "msg", text: string) => redirect(`/teams?${key}=${encodeURIComponent(text)}`);
const PLATFORMS: Record<string, string> = { sleeper: "Sleeper", espn: "ESPN", fleaflicker: "Fleaflicker", mfl: "MyFantasyLeague" };
const text = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const pickOf = <T extends string>(v: string, ok: readonly T[]): T | null => (ok.includes(v as T) ? (v as T) : null);

// Pulls leagues and every team's roster from the chosen site into the database.
export async function syncLeague(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const platform = text(formData, "platform");
  if (!(platform in PLATFORMS)) back("error", "Pick a site to sync from.");
  const myTeam = text(formData, "team");

  let leagues: ImportedLeague[] = [];
  try {
    if (platform === "sleeper") leagues = await importSleeper(text(formData, "username"));
    else if (platform === "espn") leagues = await importEspn({ leagueId: text(formData, "league_id"), s2: text(formData, "espn_s2"), swid: text(formData, "swid"), myTeam });
    else if (platform === "fleaflicker") leagues = await importFleaflicker({ leagueId: text(formData, "league_id"), myTeam });
    else leagues = await importMfl({ leagueId: text(formData, "league_id"), myTeam });
  } catch (e) {
    back("error", e instanceof ImportError ? e.message : `Couldn't reach ${PLATFORMS[platform]}. Try again in a minute.`);
  }

  // The user can override what a site doesn't tell us (or we can't detect).
  const pickedScoring = pickOf<Scoring>(text(formData, "scoring"), ["ppr", "half", "std"]);
  const pickedQb = pickOf<QbType>(text(formData, "qb"), ["1qb", "superflex"]);
  const pickedFormat = pickOf<Format>(text(formData, "format"), ["redraft", "dynasty"]);

  const { data: ours } = await supabase.from("players").select("id, name, position, nfl_team, external_id").limit(1000);
  const match = makeMatcher(ours ?? []);

  let synced = 0, unmatched = 0;
  for (const lg of leagues) {
    const { data: row, error } = await supabase
      .from("leagues")
      .upsert({
        user_id: user.id, platform, external_league_id: lg.externalId, name: lg.name,
        scoring: pickedScoring ?? lg.scoring ?? "ppr",
        qb_type: pickedQb ?? lg.qbType ?? "1qb",
        format: pickedFormat ?? lg.format ?? "redraft",
        roster_settings: lg.settings,
        synced_at: new Date().toISOString(),
      }, { onConflict: "user_id,platform,external_league_id" })
      .select("id").single();
    if (error || !row) continue;

    // Only one team can be "mine": the first match wins.
    let claimed = false;
    const used = new Set<string>();
    const out: { league_id: number; team_name: string; is_mine: boolean; player_id: number; slot: string }[] = [];
    lg.teams.forEach((t, idx) => {
      let team = t.name;
      if (used.has(team)) team = `${team} (${idx + 1})`;
      used.add(team);
      const mine = t.mine && !claimed;
      if (mine) claimed = true;
      const seen = new Set<number>();
      for (const pl of t.players) {
        const pid = match(pl.ref);
        if (!pid) { unmatched++; continue; }
        if (seen.has(pid)) continue;
        seen.add(pid);
        out.push({ league_id: row.id, team_name: team, is_mine: mine, player_id: pid, slot: pl.slot });
      }
    });

    await supabase.from("league_rosters").delete().eq("league_id", row.id);
    for (let i = 0; i < out.length; i += 500) {
      const { error: insErr } = await supabase.from("league_rosters").insert(out.slice(i, i + 500));
      if (insErr) back("error", `Saved ${synced} leagues, then failed on ${lg.name}: ${insErr.message}`);
    }
    synced++;
  }

  revalidatePath("/teams");
  const extra = unmatched ? ` ${unmatched} players weren't in our player list and were skipped.` : "";
  back("msg", `Synced ${synced} league${synced === 1 ? "" : "s"} from ${PLATFORMS[platform]}.${extra}`);
}

export async function removeLeague(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  await supabase.from("leagues").delete().eq("id", Number(formData.get("id"))).eq("user_id", user.id);
  revalidatePath("/teams");
  redirect("/teams");
}
