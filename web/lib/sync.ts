import { fetchAll } from "@/lib/fetch-all";
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

type SleeperPlayer = { player_id: string; full_name?: string; first_name?: string; last_name?: string; position?: string; team?: string | null; age?: number | null; status?: string | null; injury_status?: string | null; active?: boolean; years_exp?: number | null; search_rank?: number | null };

// The app reads the player table a page at a time, so the pool can be big. This keeps it to the players people use.
const POOL_LIMIT = 2500;

// What the profile shows as a player's status: the injury designation when there is one.
const statusOf = (p: SleeperPlayer) => p.injury_status || p.status || null;

// Keeps the player table in step with Sleeper: current team (trades, signings, releases), injury status,
// age and popularity for players we have, plus any active player on an NFL team that we are missing, most popular
// first. Free agents are left out; when one signs, the next sync adds him. New players are appended to the bottom of every list as unsorted by the database,
// so no ranking moves.
async function syncPlayers(db: SupabaseClient, log: string[]) {
  const ours = await fetchAll<{ id: number; external_id: string | null; name: string; position: string; nfl_team: string | null; age: number | null; status: string | null; is_rookie: boolean; search_rank: number | null }>((a, b) =>
    db.from("players").select("id, external_id, name, position, nfl_team, age, status, is_rookie, search_rank").order("id").range(a, b));
  const all = await getJson<Record<string, SleeperPlayer>>("/v1/players/nfl");
  const have = new Set(ours.map((p) => p.external_id));

  // Update the players we have, only where something changed.
  const changed = ours.flatMap((o) => {
    const sp = o.external_id ? all[o.external_id] : undefined;
    if (!sp) return [];
    const team = sp.team ?? null, status = statusOf(sp), age = sp.age ?? null, rank = sp.search_rank ?? null;
    if (team === o.nfl_team && status === o.status && age === o.age && rank === o.search_rank) return [];
    return [{ external_id: o.external_id, name: o.name, position: o.position, nfl_team: team, status, age, is_rookie: o.is_rookie, search_rank: rank }];
  });
  if (changed.length) await upsertChunks("players", changed, "external_id", db);
  log.push(`Players: updated team/status/age for ${changed.length}.`);

  const room = POOL_LIMIT - ours.length;
  if (room <= 0) { log.push("Players: pool is full, none added."); return; }
  const fresh = Object.entries(all)
    .map(([id, p]) => ({ ...p, player_id: id }))
    .filter((p) => p.active && !!p.team && ["QB", "RB", "WR", "TE", "K"].includes(p.position ?? "") && !have.has(p.player_id) && (p.full_name || p.last_name))
    .sort((a, b) => (a.search_rank ?? 999999) - (b.search_rank ?? 999999))
    .slice(0, room);
  if (!fresh.length) { log.push("Players: nobody new."); return; }
  await upsertChunks("players", fresh.map((p) => ({
    external_id: p.player_id, name: p.full_name ?? `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim(), position: p.position, nfl_team: p.team ?? null,
    age: p.age ?? null, status: statusOf(p), is_rookie: p.years_exp === 0, search_rank: p.search_rank ?? null,
  })), "external_id", db);
  log.push(`Players: added ${fresh.length} new, e.g. ${fresh.slice(0, 3).map((p) => p.full_name).join(", ")}.`);
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

    await syncPlayers(db, log);

    const ours = await fetchAll<{ id: number; external_id: string }>((a, b) => db.from("players").select("id, external_id").order("id").range(a, b));
    const idOf = new Map(ours.map((p) => [p.external_id as string, p.id as number]));

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
    await snapshotRanks(db, log);
    await syncNews(db, log);
    return { ok: true, log };
  } catch (e) {
    log.push(`Failed: ${e instanceof Error ? e.message : String(e)}`);
    return { ok: false, log };
  }
}

// NFL headlines from ESPN's public news feeds: the general feed plus one feed per team. Stories that
// name players we track are saved against those players (their News tab), and every story keeps the
// teams it was filed under, so a profile can show its team's news too. Only new stories are added.
type EspnArticle = {
  id: number; headline?: string; description?: string; published?: string; type?: string;
  links?: { web?: { href?: string } }; categories?: { type?: string; description?: string }[];
};
const plain = (n: string) => n.toLowerCase().replace(/\b(jr|sr|ii|iii|iv|v)\b\.?/g, "").replace(/[^a-z]/g, "");
const ESPN = "https://site.api.espn.com/apis/site/v2/sports/football/nfl";
const TEAM_ALIAS: Record<string, string> = { WSH: "WAS" };

async function espnArticles(url: string): Promise<EspnArticle[]> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) return [];
  return (((await res.json()) as { articles?: EspnArticle[] }).articles ?? []).filter((a) => a.headline && a.type !== "Media" && a.links?.web?.href);
}

async function syncNews(db: SupabaseClient, log: string[]) {
  try {
    const teamsRes = await fetch(`${ESPN}/teams`, { cache: "no-store" });
    const teamList = teamsRes.ok
      ? (((await teamsRes.json()) as { sports?: { leagues?: { teams?: { team: { id: string; abbreviation: string } }[] }[] }[] }).sports?.[0]?.leagues?.[0]?.teams ?? []).map((t) => ({ id: t.team.id, abbr: TEAM_ALIAS[t.team.abbreviation] ?? t.team.abbreviation }))
      : [];

    const stories = new Map<number, { a: EspnArticle; teams: Set<string> }>();
    const take = (list: EspnArticle[], team?: string) => list.forEach((a) => {
      const cur = stories.get(a.id) ?? { a, teams: new Set<string>() };
      if (team) cur.teams.add(team);
      stories.set(a.id, cur);
    });
    take(await espnArticles(`${ESPN}/news?limit=40`));
    for (let i = 0; i < teamList.length; i += 8) {
      const batch = teamList.slice(i, i + 8);
      const got = await Promise.all(batch.map((t) => espnArticles(`${ESPN}/news?team=${t.id}&limit=50`).catch(() => [])));
      got.forEach((list, k) => take(list, batch[k].abbr));
    }
    if (!stories.size) return;

    const ids = [...stories.keys()].map(String);
    const known = new Set<string>();
    for (let i = 0; i < ids.length; i += 200) {
      const { data: have } = await db.from("news").select("external_id").in("external_id", ids.slice(i, i + 200));
      (have ?? []).forEach((r) => known.add(r.external_id as string));
    }
    const ours = await fetchAll<{ id: number; name: string }>((a, b) => db.from("players").select("id, name").order("id").range(a, b));
    const byName = new Map(ours.map((p) => [plain(p.name as string), p.id as number]));

    const rows: Record<string, unknown>[] = [];
    for (const { a, teams } of stories.values()) {
      if (known.has(String(a.id))) continue;
      const matched = [...new Set((a.categories ?? []).filter((c) => c.type === "athlete" && c.description).map((c) => byName.get(plain(c.description!))).filter((x): x is number => !!x))].slice(0, 3);
      const base = {
        headline: a.headline, body: a.description ?? null, url: a.links!.web!.href, source: "ESPN", external_id: String(a.id),
        published_at: a.published ?? new Date().toISOString(), teams: [...teams],
      };
      if (matched.length) matched.forEach((pid) => rows.push({ ...base, player_id: pid })); else rows.push({ ...base, player_id: null });
    }
    for (let i = 0; i < rows.length; i += 400) {
      const { error } = await db.from("news").insert(rows.slice(i, i + 400));
      if (error) { log.push(`News skipped: ${error.message}`); return; }
    }
    await db.from("news").delete().lt("published_at", new Date(Date.now() - 45 * 86400000).toISOString());
    log.push(`News: ${rows.length} new rows.`);
  } catch (e) {
    log.push(`News skipped: ${e instanceof Error ? e.message : String(e)}`);
  }
}

// Saves today's consensus order for the home page's Biggest Movers (the redraft PPR 1QB list).
// Safe to run more than once a day: it just replaces today's snapshot. Keeps about two months.
async function snapshotRanks(db: SupabaseClient, log: string[]) {
  const combo = { format: "redraft", scoring: "ppr", qb_type: "1qb" };
  const { data, error } = await db.from("consensus_current")
    .select("player_id, position_in_list, players!inner(position)").match(combo).limit(1000)
    .returns<{ player_id: number; position_in_list: number; players: { position: string } | { position: string }[] }[]>();
  if (error) { log.push(`Rank snapshot skipped: ${error.message}`); return; }
  const today = new Date().toISOString().slice(0, 10);
  const rows = (data ?? []).map((r) => ({
    snapshot_date: today, ...combo, player_id: r.player_id, position_in_list: r.position_in_list,
    position: Array.isArray(r.players) ? r.players[0]?.position : r.players?.position,
  }));
  if (!rows.length) return;
  const up = await db.from("rank_history").upsert(rows, { onConflict: "snapshot_date,format,scoring,qb_type,player_id" });
  if (up.error) { log.push(`Rank snapshot skipped: ${up.error.message}`); return; }
  await db.from("rank_history").delete().lt("snapshot_date", new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10));
  log.push(`Rank snapshot: ${rows.length} players.`);
}

// Season totals for every season before the current one, back to 2009 (one request per season).
// Seasons already loaded are skipped, so running it again carries on where a timeout stopped it.
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
    const ours = await fetchAll<{ id: number; external_id: string }>((a, b) => db.from("players").select("id, external_id").order("id").range(a, b));
    const idOf = new Map(ours.map((p) => [p.external_id as string, p.id as number]));
    const started = Date.now();
    for (let y = season - 1; y >= 2009; y--) {
      const { count } = await db.from("player_seasons").select("player_id", { count: "exact", head: true }).eq("season", y);
      if ((count ?? 0) > 0) { log.push(`Season ${y}: already loaded.`); continue; }
      if (Date.now() - started > 40_000) { log.push(`Stopped early to stay within the time limit. Click again to load the rest, from ${y} back.`); break; }
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
