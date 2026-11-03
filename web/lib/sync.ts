import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const SLEEPER = "https://api.sleeper.app";

type State = { season: string; week: number; display_week?: number; season_type: string };
type Game = { game_id: string; week: number; home: string; away: string; date: string | null; status: string | null };
type Projection = { player_id: string; stats?: Record<string, number> };

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${SLEEPER}${path}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Sleeper ${path} returned ${res.status}`);
  return (await res.json()) as T;
}

async function upsertChunks(table: string, rows: Record<string, unknown>[], onConflict: string, db: SupabaseClient) {
  for (let i = 0; i < rows.length; i += 400) {
    const { error } = await db.from(table).upsert(rows.slice(i, i + 400), { onConflict });
    if (error) throw new Error(`${table}: ${error.message}`);
  }
}

// Pulls the schedule, weekly stats and projections from Sleeper into Supabase.
// Default: the current week and the one before it. backfill: every week so far. weeks: exact weeks.
export async function runSync(opts: { weeks?: number[]; backfill?: boolean } = {}): Promise<{ ok: boolean; log: string[] }> {
  const log: string[] = [];
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return { ok: false, log: ["SUPABASE_SERVICE_ROLE_KEY is not set, so the sync can't write to the database."] };
  }
  const db = createClient(url, key, { auth: { persistSession: false } });

  try {
    const state = await getJson<State>("/v1/state/nfl");
    const season = Number(state.season);
    const current = Math.max(1, state.display_week ?? state.week ?? 1);
    log.push(`Sleeper says it is ${season} week ${current} (${state.season_type}).`);

    const { data: ours, error: pErr } = await db.from("players").select("id, external_id").limit(1000);
    if (pErr) throw new Error(`players: ${pErr.message}`);
    const idOf = new Map((ours ?? []).map((p) => [p.external_id as string, p.id as number]));

    // Schedule
    const schedule = await getJson<Game[]>(`/schedule/nfl/regular/${season}`);
    await upsertChunks("games", schedule.map((g) => ({
      season, game_id: g.game_id, week: g.week, home: g.home, away: g.away, game_date: g.date, status: g.status,
    })), "season,game_id", db);
    log.push(`Schedule: ${schedule.length} games.`);

    // Weekly stats
    const statWeeks = opts.weeks?.length
      ? opts.weeks
      : opts.backfill ? Array.from({ length: current }, (_, i) => i + 1) : [Math.max(1, current - 1), current];
    for (const w of [...new Set(statWeeks)].filter((x) => x >= 1 && x <= 22)) {
      const all = await getJson<Record<string, Record<string, number>>>(`/v1/stats/nfl/regular/${season}/${w}`);
      const rows: Record<string, unknown>[] = [];
      for (const [sid, st] of Object.entries(all)) {
        const pid = idOf.get(sid);
        if (!pid || !(st.gp > 0) || st.pts_ppr === undefined) continue;
        const trimmed = Object.fromEntries(Object.entries(st).filter(([k]) => !k.startsWith("pos_")));
        rows.push({ player_id: pid, season, week: w, stats: trimmed, pts_ppr: st.pts_ppr, pts_half: st.pts_half_ppr ?? null, pts_std: st.pts_std ?? null });
      }
      await upsertChunks("player_stats", rows, "player_id,season,week", db);
      log.push(`Stats week ${w}: ${rows.length} players.`);
    }

    // Projections: this week and next
    for (const w of [current, current + 1].filter((x) => x <= 18)) {
      const proj = await getJson<Projection[]>(`/projections/nfl/${season}/${w}?season_type=regular`);
      const rows: Record<string, unknown>[] = [];
      for (const p of proj) {
        const pid = idOf.get(p.player_id);
        const s = p.stats;
        if (!pid || !s || s.pts_ppr === undefined) continue;
        rows.push({ player_id: pid, season, week: w, scoring: "ppr", points: s.pts_ppr });
        if (s.pts_half_ppr !== undefined) rows.push({ player_id: pid, season, week: w, scoring: "half", points: s.pts_half_ppr });
        if (s.pts_std !== undefined) rows.push({ player_id: pid, season, week: w, scoring: "std", points: s.pts_std });
      }
      await upsertChunks("projections", rows, "player_id,season,week,scoring", db);
      log.push(`Projections week ${w}: ${rows.length} rows.`);
    }
    return { ok: true, log };
  } catch (e) {
    log.push(`Failed: ${e instanceof Error ? e.message : String(e)}`);
    return { ok: false, log };
  }
}

// Season totals for the three seasons before the current one (one request per season).
const KEEP = ["rush_att", "rush_yd", "rush_td", "rec", "rec_tgt", "rec_yd", "rec_td", "pass_att", "pass_cmp", "pass_yd", "pass_td", "pass_int", "fum_lost", "fgm", "fga", "xpm"];
export async function runHistory(): Promise<{ ok: boolean; log: string[] }> {
  const log: string[] = [];
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return { ok: false, log: ["SUPABASE_SERVICE_ROLE_KEY is not set, so the sync can't write to the database."] };
  const db = createClient(url, key, { auth: { persistSession: false } });
  try {
    const state = await getJson<State>("/v1/state/nfl");
    const season = Number(state.season);
    const { data: ours, error } = await db.from("players").select("id, external_id").limit(1000);
    if (error) throw new Error(`players: ${error.message}`);
    const idOf = new Map((ours ?? []).map((p) => [p.external_id as string, p.id as number]));
    for (const y of [season - 3, season - 2, season - 1]) {
      const all = await getJson<Record<string, Record<string, number>>>(`/v1/stats/nfl/regular/${y}`);
      const rows: Record<string, unknown>[] = [];
      for (const [sid, st] of Object.entries(all)) {
        const pid = idOf.get(sid);
        if (!pid || !(st.gp > 0) || st.pts_ppr === undefined) continue;
        rows.push({
          player_id: pid, season: y, gp: st.gp, pts_ppr: st.pts_ppr, pts_half: st.pts_half_ppr ?? null, pts_std: st.pts_std ?? null,
          stats: Object.fromEntries(KEEP.filter((k) => st[k] !== undefined).map((k) => [k, st[k]])),
        });
      }
      await upsertChunks("player_seasons", rows, "player_id,season", db);
      log.push(`Season ${y}: ${rows.length} players.`);
    }
    return { ok: true, log };
  } catch (e) {
    log.push(`Failed: ${e instanceof Error ? e.message : String(e)}`);
    return { ok: false, log };
  }
}
