"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { persist, type Overrides } from "@/lib/leagues/persist";
import { importSleeper } from "@/lib/leagues/sleeper";
import { importEspn } from "@/lib/leagues/espn";
import { importFleaflicker } from "@/lib/leagues/fleaflicker";
import { importMfl } from "@/lib/leagues/mfl";
import { ImportError, type Format, type ImportedLeague, type QbType, type Scoring } from "@/lib/leagues/types";


const back = (key: "error" | "msg", text: string) => redirect(`/teams?${key}=${encodeURIComponent(text)}`);
const PLATFORMS: Record<string, string> = { sleeper: "Sleeper", espn: "ESPN", fleaflicker: "Fleaflicker", mfl: "MyFantasyLeague" };
const text = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const pickOf = <T extends string>(v: string, ok: readonly T[]): T | null => (ok.includes(v as T) ? (v as T) : null);

async function requireUser() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return { supabase, user };
}

const skipped = (n: number) => (n ? ` ${n} players weren't in our player list and were skipped.` : "");
const failure = (e: unknown, platform: string) =>
  e instanceof ImportError ? e.message : `Couldn't reach ${PLATFORMS[platform]}. Try again in a minute.`;

// Pulls leagues and every team's roster from the chosen site into the database.
export async function syncLeague(formData: FormData) {
  const { supabase, user } = await requireUser();

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
    back("error", failure(e, platform));
  }

  // The user can override what a site doesn't tell us (or we can't detect).
  const { synced, unmatched, error: saveError } = await persist(supabase, user.id, platform, leagues, {
    scoring: pickOf<Scoring>(text(formData, "scoring"), ["ppr", "half", "std"]),
    qb: pickOf<QbType>(text(formData, "qb"), ["1qb", "superflex"]),
    format: pickOf<Format>(text(formData, "format"), ["redraft", "dynasty"]),
  });

  if (saveError) back("error", saveError);
  revalidatePath("/teams");
  back("msg", `Synced ${synced} league${synced === 1 ? "" : "s"} from ${PLATFORMS[platform]}.${skipped(unmatched)}`);
}

// Refreshes one saved league from its site, keeping the settings and "my team" you already have.
// Private ESPN leagues can't be refreshed this way, because their cookies are never saved.
export async function refreshLeague(formData: FormData) {
  const { supabase, user } = await requireUser();
  const id = Number(formData.get("id"));

  const { data: lg } = await supabase
    .from("leagues").select("id, platform, external_league_id, name, scoring, qb_type, format, roster_settings")
    .eq("id", id).eq("user_id", user.id).maybeSingle();
  if (!lg) back("error", "That league isn't in your list any more.");
  const league = lg!;

  const { data: mineRow } = await supabase.from("league_rosters").select("team_name").eq("league_id", id).eq("is_mine", true).limit(1);
  const myTeam = mineRow?.[0]?.team_name ?? "";
  const platform = league.platform as string;

  let leagues: ImportedLeague[] = [];
  try {
    if (platform === "sleeper") {
      const uid = (league.roster_settings as { sleeper_user_id?: string } | null)?.sleeper_user_id;
      if (!uid) back("error", "Sync this league again from the form so we can remember your Sleeper account.");
      leagues = (await importSleeper(uid!)).filter((l) => l.externalId === league.external_league_id);
    } else if (platform === "espn") leagues = await importEspn({ leagueId: league.external_league_id, s2: "", swid: "", myTeam });
    else if (platform === "fleaflicker") leagues = await importFleaflicker({ leagueId: league.external_league_id, myTeam });
    else leagues = await importMfl({ leagueId: league.external_league_id, myTeam });
  } catch (e) {
    back("error", `${failure(e, platform)}${platform === "espn" ? " If this is a private league, sync it again from the form with your cookies." : ""}`);
  }
  if (!leagues.length) back("error", `${league.name ?? "That league"} wasn't found on ${PLATFORMS[platform]} any more.`);

  const { unmatched, error: saveError } = await persist(supabase, user.id, platform, leagues, {
    scoring: league.scoring as Scoring, qb: league.qb_type as QbType, format: league.format as Format,
  });
  if (saveError) back("error", saveError);
  revalidatePath("/teams");
  redirect(`/teams?league=${id}&msg=${encodeURIComponent(`Refreshed ${league.name}.${skipped(unmatched)}`)}`);
}

export async function removeLeague(formData: FormData) {
  const { supabase, user } = await requireUser();
  await supabase.from("leagues").delete().eq("id", Number(formData.get("id"))).eq("user_id", user.id);
  revalidatePath("/teams");
  redirect("/teams");
}
