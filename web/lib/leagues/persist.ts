import { fetchAll } from "@/lib/fetch-all";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { makeMatcher } from "./match";
import type { Format, ImportedLeague, QbType, Scoring } from "./types";

type Db = SupabaseClient;
export type Overrides = { scoring: Scoring | null; qb: QbType | null; format: Format | null };

// Saves imported leagues and every team's roster. Returns how many leagues were stored and
// how many players we skipped because they aren't in our player list.
export async function persist(supabase: Db, userId: string, platform: string, leagues: ImportedLeague[], over: Overrides) {
  type Ours = { id: number; name: string; position: string; nfl_team: string | null; external_id: string | null };
  const load = () => fetchAll<Ours>((a, b) => supabase.from("players").select("id, name, position, nfl_team, external_id").order("id").range(a, b).returns<Ours[]>());
  let ours = await load();
  let match = makeMatcher(ours);

  // A Sleeper player who is on someone's roster but not in our table (a free agent, say) is added from Sleeper's
  // player list, so a roster never loses him. Needs the server key, since users can't add players themselves.
  const missing = new Set<string>();
  leagues.forEach((lg) => lg.teams.forEach((t) => t.players.forEach((pl) => { if ("sleeperId" in pl.ref && !match(pl.ref)) missing.add(pl.ref.sleeperId); })));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (missing.size && url && key) {
    try {
      const res = await fetch("https://api.sleeper.app/v1/players/nfl", { cache: "no-store" });
      const all = (await res.json()) as Record<string, { full_name?: string; first_name?: string; last_name?: string; position?: string; team?: string | null; age?: number | null; status?: string | null; injury_status?: string | null; years_exp?: number | null; search_rank?: number | null }>;
      const rows = [...missing].flatMap((id) => {
        const p = all[id];
        if (!p || !["QB", "RB", "WR", "TE", "K", "FB"].includes(p.position ?? "")) return [];
        return [{ external_id: id, name: p.full_name ?? `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim(), position: p.position === "FB" ? "RB" : p.position, nfl_team: p.team ?? null, age: p.age ?? null, status: p.injury_status || p.status || null, is_rookie: p.years_exp === 0, search_rank: p.search_rank ?? null }];
      });
      if (rows.length) {
        const admin = createClient(url, key, { auth: { persistSession: false } });
        await admin.from("players").upsert(rows, { onConflict: "external_id" });
        ours = await load();
        match = makeMatcher(ours);
      }
    } catch { /* the roster still saves; those players stay skipped */ }
  }

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

