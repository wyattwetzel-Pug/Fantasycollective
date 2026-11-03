"use server";

import { revalidatePath, updateTag } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { fetchSheet, sheetIdFrom } from "@/lib/sheets";
import { makeMatcher } from "@/lib/leagues/match";
import { importSleeper } from "@/lib/leagues/sleeper";
import { importEspn } from "@/lib/leagues/espn";
import { importFleaflicker } from "@/lib/leagues/fleaflicker";
import { importMfl } from "@/lib/leagues/mfl";
import { ImportError, type Format, type ImportedLeague, type QbType, type Scoring } from "@/lib/leagues/types";

type Db = Awaited<ReturnType<typeof createClient>>;
type Overrides = { scoring: Scoring | null; qb: QbType | null; format: Format | null };

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

// Saves imported leagues and every team's roster. Returns how many leagues were stored and
// how many players we skipped because they aren't in our player list.
async function persist(supabase: Db, userId: string, platform: string, leagues: ImportedLeague[], over: Overrides) {
  const { data: ours } = await supabase.from("players").select("id, name, position, nfl_team, external_id").limit(1000);
  const match = makeMatcher(ours ?? []);

  let synced = 0, unmatched = 0;
  for (const lg of leagues) {
    const { data: row, error } = await supabase
      .from("leagues")
      .upsert({
        user_id: userId, platform, external_league_id: lg.externalId, name: lg.name,
        scoring: over.scoring ?? lg.scoring ?? "ppr",
        qb_type: over.qb ?? lg.qbType ?? "1qb",
        format: over.format ?? lg.format ?? "redraft",
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
  return { synced, unmatched };
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
  const { synced, unmatched } = await persist(supabase, user.id, platform, leagues, {
    scoring: pickOf<Scoring>(text(formData, "scoring"), ["ppr", "half", "std"]),
    qb: pickOf<QbType>(text(formData, "qb"), ["1qb", "superflex"]),
    format: pickOf<Format>(text(formData, "format"), ["redraft", "dynasty"]),
  });

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

  const { unmatched } = await persist(supabase, user.id, platform, leagues, {
    scoring: league.scoring as Scoring, qb: league.qb_type as QbType, format: league.format as Format,
  });
  revalidatePath("/teams");
  redirect(`/teams?league=${id}&msg=${encodeURIComponent(`Refreshed ${league.name}.${skipped(unmatched)}`)}`);
}

export async function removeLeague(formData: FormData) {
  const { supabase, user } = await requireUser();
  await supabase.from("leagues").delete().eq("id", Number(formData.get("id"))).eq("user_id", user.id);
  revalidatePath("/teams");
  redirect("/teams");
}

// Links a Google Sheet to a league. It has to be shared as "Anyone with the link can view".
export async function connectSheet(formData: FormData) {
  const { supabase } = await requireUser();
  const leagueId = Number(formData.get("league"));
  const url = text(formData, "url");
  const dest = (extra: string) => `/teams?league=${leagueId}${extra}`;
  const id = sheetIdFrom(url);
  if (!id) redirect(dest(`&sheeterr=${encodeURIComponent("That doesn't look like a Google Sheets link. Copy it from the address bar of your sheet.")}`));
  const check = await fetchSheet(id);
  if (!check.ok) redirect(dest(`&sheeterr=${encodeURIComponent(check.error)}`));
  const { error } = await supabase.from("league_sheets").upsert({ league_id: leagueId, sheet_id: id, url });
  if (error) redirect(dest(`&sheeterr=${encodeURIComponent(error.message)}`));
  updateTag(`sheet-${id}`);
  redirect(dest("&tab=sheet"));
}

export async function disconnectSheet(formData: FormData) {
  const { supabase } = await requireUser();
  const leagueId = Number(formData.get("league"));
  await supabase.from("league_sheets").delete().eq("league_id", leagueId);
  redirect(`/teams?league=${leagueId}`);
}

// Pulls the sheet again right now instead of waiting for the few-minute cache.
export async function refreshSheet(formData: FormData) {
  await requireUser();
  const id = text(formData, "sheet");
  const leagueId = Number(formData.get("league"));
  if (id) updateTag(`sheet-${id}`);
  redirect(`/teams?league=${leagueId}&tab=sheet${formData.get("tabname") ? `&sheettab=${encodeURIComponent(text(formData, "tabname"))}` : ""}`);
}
