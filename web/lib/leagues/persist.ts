import { fetchAll } from "@/lib/fetch-all";
import type { SupabaseClient } from "@supabase/supabase-js";
import { makeMatcher } from "./match";
import type { Format, ImportedLeague, QbType, Scoring } from "./types";

type Db = SupabaseClient;
export type Overrides = { scoring: Scoring | null; qb: QbType | null; format: Format | null };

// Saves imported leagues and every team's roster. Returns how many leagues were stored and
// how many players we skipped because they aren't in our player list.
export async function persist(supabase: Db, userId: string, platform: string, leagues: ImportedLeague[], over: Overrides) {
  const ours = await fetchAll<{ id: number; name: string; position: string; nfl_team: string | null; external_id: string | null }>((a, b) => supabase.from("players").select("id, name, position, nfl_team, external_id").order("id").range(a, b).returns<{ id: number; name: string; position: string; nfl_team: string | null; external_id: string | null }[]>());
  const match = makeMatcher(ours);

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
      if (insErr) return { synced, unmatched, error: `Saved ${synced} leagues, then failed on ${lg.name}: ${insErr.message}` };
    }
    synced++;
  }
  return { synced, unmatched, error: null as string | null };
}

