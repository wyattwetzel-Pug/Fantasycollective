import { createClient } from "@supabase/supabase-js";
import { persist } from "./persist";
import { importSleeper } from "./sleeper";
import { importEspn } from "./espn";
import { importFleaflicker } from "./fleaflicker";
import { importMfl } from "./mfl";
import type { Format, ImportedLeague, QbType, Scoring } from "./types";

type L = { id: number; user_id: string; platform: string; external_league_id: string; name: string | null; scoring: string; qb_type: string; format: string; roster_settings: { sleeper_user_id?: string } | null };

// Refreshes every synced league (rosters, records, schedule). Private ESPN leagues are skipped when the
// site refuses us, because their cookies are never saved. A failed league keeps its old data.
export async function refreshAllLeagues() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return { ok: false, log: ["SUPABASE_SERVICE_ROLE_KEY is not set."] };
  const db = createClient(url, key, { auth: { persistSession: false } });

  const { data } = await db.from("leagues").select("id, user_id, platform, external_league_id, name, scoring, qb_type, format, roster_settings").limit(500);
  const log: string[] = [];
  const sleeperCache = new Map<string, Promise<ImportedLeague[]>>();

  for (const lg of (data ?? []) as L[]) {
    const label = `${lg.name ?? lg.external_league_id} (${lg.platform})`;
    try {
      const { data: mine } = await db.from("league_rosters").select("team_name").eq("league_id", lg.id).eq("is_mine", true).limit(1);
      const myTeam = mine?.[0]?.team_name ?? "";
      let found: ImportedLeague[] = [];
      if (lg.platform === "sleeper") {
        const uid = lg.roster_settings?.sleeper_user_id;
        if (!uid) { log.push(`${label}: skipped (no Sleeper account saved)`); continue; }
        if (!sleeperCache.has(uid)) sleeperCache.set(uid, importSleeper(uid));
        found = (await sleeperCache.get(uid)!).filter((l) => l.externalId === lg.external_league_id);
      } else if (lg.platform === "espn") found = await importEspn({ leagueId: lg.external_league_id, s2: "", swid: "", myTeam });
      else if (lg.platform === "fleaflicker") found = await importFleaflicker({ leagueId: lg.external_league_id, myTeam });
      else found = await importMfl({ leagueId: lg.external_league_id, myTeam });
      if (!found.length) { log.push(`${label}: not found, kept old data`); continue; }
      const res = await persist(db, lg.user_id, lg.platform, found, { scoring: lg.scoring as Scoring, qb: lg.qb_type as QbType, format: lg.format as Format });
      log.push(res.error ? `${label}: ${res.error}` : `${label}: refreshed`);
    } catch (e) {
      log.push(`${label}: skipped (${e instanceof Error ? e.message : "error"})`);
    }
  }
  return { ok: true, log };
}
