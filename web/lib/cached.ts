import { cacheLife, cacheTag } from "next/cache";
import { publicClient } from "@/lib/supabase/public";
import { seasonLines } from "@/lib/season";
import { nowMs } from "@/lib/time";

// Public data that every visitor sees, so it is fetched once and kept for a minute or two. Saving a
// ranking throws the "rankings" copies away straight away.

type Combo = { format: string; scoring: string; qb_type: string };
const DAY = 24 * 60 * 60 * 1000;

export type PlayerInfo = { name: string; position: string; nfl_team: string | null };
export type SetRow = { id: number; updated_at: string; contributors: { slug: string; profiles: { display_name: string; avatar_url: string | null } | null } | null };
export type ConsensusRow = {
  player_id: number; consensus_rank: number; sources: number; tier: string | null;
  is_stale: boolean; position_in_list: number; players: PlayerInfo | null;
};

export async function publishedSets(combo: Combo): Promise<SetRow[]> {
  "use cache";
  cacheLife("minutes");
  cacheTag("rankings");
  const { data } = await publicClient()
    .from("ranking_sets")
    .select("id, updated_at, contributors(slug, profiles!contributors_profile_id_fkey(display_name, avatar_url))")
    .match(combo).eq("published", true)
    .returns<SetRow[]>();
  return data ?? [];
}

export async function consensusRows(combo: Combo): Promise<{ rows: ConsensusRow[]; error: string }> {
  "use cache";
  cacheLife("minutes");
  cacheTag("rankings");
  const { data, error } = await publicClient()
    .from("consensus_current")
    .select("player_id, consensus_rank, sources, tier, is_stale, position_in_list, players(name, position, nfl_team)")
    .match(combo).order("position_in_list").limit(1000)
    .returns<ConsensusRow[]>();
  return { rows: data ?? [], error: error?.message ?? "" };
}

type Top = { player_id: number; position_in_list: number; name: string; position: string };
export type HomeData = {
  top: Top[];
  risers: { id: number; name: string; pos: string; now: number; change: number }[];
  fallers: { id: number; name: string; pos: string; now: number; change: number }[];
  scorers: { id: number; name: string; position: string; points: number; played: number }[];
  hasHistory: boolean;
  total: number;
  contributors: number;
  stories: { id: number; headline: string; body: string | null; published_at: string; url: string | null; source: string | null; external_id: string | null }[];
};

const HOME_COMBO = { format: "redraft", scoring: "ppr", qb_type: "1qb" };

// Everything on the home page that is the same for everyone, gathered in parallel.
export async function homeData(): Promise<HomeData> {
  "use cache";
  cacheLife("minutes");
  cacheTag("rankings");
  const db = publicClient();
  const weekAgo = new Date(nowMs() - 6 * DAY).toISOString().slice(0, 10);

  const [topRes, oldDayRes, lines, skillRes, totalRes, setsRes, newsRes, nowRes] = await Promise.all([
    db.from("consensus_current").select("player_id, position_in_list, players!inner(name, position)").match(HOME_COMBO).not("players.position", "in", "(K,DEF)").order("position_in_list").limit(20)
      .returns<{ player_id: number; position_in_list: number; players: { name: string; position: string } }[]>(),
    db.from("rank_history").select("snapshot_date").match(HOME_COMBO).lte("snapshot_date", weekAgo).order("snapshot_date", { ascending: false }).limit(1),
    seasonLines("ppr"),
    db.from("players").select("id, name, position").in("position", ["QB", "RB", "WR", "TE", "K"]).limit(1000).returns<{ id: number; name: string; position: string }[]>(),
    db.from("consensus_current").select("player_id", { count: "exact", head: true }).match(HOME_COMBO),
    db.from("ranking_sets").select("updated_at, contributor_id").eq("published", true),
    db.from("news").select("id, headline, body, published_at, url, source, external_id").order("published_at", { ascending: false }).limit(30)
      .returns<HomeData["stories"]>(),
    db.from("consensus_current").select("player_id, position_in_list, players!inner(name, position)").match(HOME_COMBO).not("players.position", "in", "(K,DEF)").order("position_in_list").limit(1000)
      .returns<{ player_id: number; position_in_list: number; players: { name: string; position: string } }[]>(),
  ]);

  // Biggest movers: today's consensus order against the newest snapshot that is about a week old.
  const oldDay = oldDayRes.data?.[0]?.snapshot_date as string | undefined;
  const oldRows = oldDay
    ? (await db.from("rank_history").select("player_id, position_in_list, position").match(HOME_COMBO).eq("snapshot_date", oldDay).limit(1000)
        .returns<{ player_id: number; position_in_list: number; position: string }[]>()).data
    : null;
  const rankThen = new Map<number, number>();
  [...(oldRows ?? [])].filter((r) => r.position !== "K" && r.position !== "DEF").sort((a, b) => a.position_in_list - b.position_in_list).forEach((r, i) => rankThen.set(r.player_id, i + 1));
  const moves = oldRows?.length
    ? (nowRes.data ?? []).map((r, i) => ({ id: r.player_id, name: r.players.name, pos: r.players.position, now: i + 1, change: (rankThen.get(r.player_id) ?? NaN) - (i + 1) }))
        .filter((m) => Number.isFinite(m.change) && m.change !== 0)
    : [];

  // The top scorer at each position so far this season (PPR).
  const scorers = ["QB", "RB", "WR", "TE", "K"].flatMap((pos) => {
    const best = (skillRes.data ?? []).filter((p) => p.position === pos && lines[p.id]).sort((a, b) => lines[b.id].points - lines[a.id].points)[0];
    return best ? [{ id: best.id, name: best.name, position: pos, points: lines[best.id].points, played: lines[best.id].played }] : [];
  });

  // One row per story (a story naming several players is stored once per player).
  const seen = new Set<string>();
  const stories = (newsRes.data ?? []).filter((n) => { const k = n.external_id ?? String(n.id); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 5);

  return {
    top: (topRes.data ?? []).map((r) => ({ player_id: r.player_id, position_in_list: r.position_in_list, name: r.players.name, position: r.players.position })),
    risers: moves.filter((m) => m.change > 0).sort((a, b) => b.change - a.change).slice(0, 3),
    fallers: moves.filter((m) => m.change < 0).sort((a, b) => a.change - b.change).slice(0, 3),
    scorers,
    hasHistory: !!oldRows?.length,
    total: totalRes.count ?? 0,
    contributors: new Set((setsRes.data ?? []).filter((s) => nowMs() - new Date(s.updated_at).getTime() < 7 * DAY).map((s) => s.contributor_id)).size,
    stories,
  };
}

// ---- Player profile -------------------------------------------------------------------------

export type PlayerRow = { id: number; name: string; position: string; nfl_team: string | null; age: number | null; status: string | null; is_rookie: boolean };
export type StatRow = { week: number; season: number; stats: Record<string, number>; pts_ppr: number | null; pts_half: number | null; pts_std: number | null };
export type AdpRow = { season: number; source: string; format: string; scoring: string; qb_type: string; adp: number; high: number | null; low: number | null; times_drafted: number | null; teams: number };
export type NewsItem = { id: number; headline: string; body: string | null; published_at: string; url: string | null; source: string | null };
export type CallItem = {
  id: number; week: number; season: number; player_a: number; player_b: number; pick: number; reason: string | null;
  contributors: { profiles: { display_name: string; avatar_url: string | null } | null } | null;
};
export type SeasonItem = { season: number; gp: number | null; stats: Record<string, number>; pts_ppr: number | null; pts_half: number | null };
export type AllCons = { format: string; scoring: string; qb_type: string; position_in_list: number; tier: string | null };

// Everything on a player's profile that is the same for every visitor, fetched together and kept briefly.
export async function playerPublic(id: number, scoring: string) {
  "use cache";
  cacheLife("minutes");
  cacheTag("rankings");
  const db = publicClient();
  const [player, stats, proj, every, adp, news, calls, seasons] = await Promise.all([
    db.from("players").select("id, name, position, nfl_team, age, status, is_rookie").eq("id", id).maybeSingle<PlayerRow>(),
    db.from("player_stats").select("week, season, stats, pts_ppr, pts_half, pts_std").eq("player_id", id).order("season", { ascending: false }).order("week").returns<StatRow[]>(),
    db.from("projections").select("week, season, points").eq("player_id", id).eq("scoring", scoring).order("season", { ascending: false }).order("week", { ascending: false }).limit(2)
      .returns<{ week: number; season: number; points: number }[]>(),
    db.from("consensus_current").select("format, scoring, qb_type, position_in_list, tier").eq("player_id", id).returns<AllCons[]>(),
    db.from("adp").select("season, source, format, scoring, qb_type, adp, high, low, times_drafted, teams").eq("player_id", id).order("season", { ascending: false }).returns<AdpRow[]>(),
    db.from("news").select("id, headline, body, published_at, url, source").eq("player_id", id).order("published_at", { ascending: false }).limit(20).returns<NewsItem[]>(),
    db.from("start_sit_calls")
      .select("id, week, season, player_a, player_b, pick, reason, contributors(profiles!contributors_profile_id_fkey(display_name, avatar_url))")
      .or(`player_a.eq.${id},player_b.eq.${id}`).order("created_at", { ascending: false }).limit(10).returns<CallItem[]>(),
    db.from("player_seasons").select("season, gp, stats, pts_ppr, pts_half").eq("player_id", id).order("season", { ascending: false }).limit(40).returns<SeasonItem[]>(),
  ]);
  const otherIds = [...new Set((calls.data ?? []).flatMap((c) => [c.player_a, c.player_b]).filter((x) => x !== id))];
  const others = otherIds.length ? (await db.from("players").select("id, name").in("id", otherIds).returns<{ id: number; name: string }[]>()).data ?? [] : [];
  return {
    player: player.data, statRows: stats.data ?? [], projRows: proj.data ?? [], everyCombo: every.data ?? [], adpRows: adp.data ?? [],
    news: news.data ?? [], calls: calls.data ?? [], seasons: seasons.data ?? [], others,
  };
}

// Kickers' and defenses' consensus spots in every format, to take them out of Overall numbers.
export async function offListRanks(): Promise<{ format: string; scoring: string; qb_type: string; position_in_list: number }[]> {
  "use cache";
  cacheLife("minutes");
  cacheTag("rankings");
  const { data } = await publicClient().from("consensus_current").select("format, scoring, qb_type, position_in_list, players!inner(position)").in("players.position", ["K", "DEF"]).limit(1000)
    .returns<{ format: string; scoring: string; qb_type: string; position_in_list: number }[]>();
  return data ?? [];
}

// What each contributor with a published list has for this player (rank, tier, note).
export async function contributorRanks(id: number, setIds: number[]): Promise<{ set_id: number; rank: number; tier: string | null; note: string | null }[]> {
  "use cache";
  cacheLife("minutes");
  cacheTag("rankings");
  if (!setIds.length) return [];
  const { data } = await publicClient().from("rankings").select("set_id, rank, tier, note").eq("player_id", id).in("set_id", setIds).eq("needs_ranking", false).not("tier", "is", null)
    .returns<{ set_id: number; rank: number; tier: string | null; note: string | null }[]>();
  return data ?? [];
}

export async function teamGames(season: number, team: string): Promise<{ week: number; home: string; away: string; status: string | null }[]> {
  "use cache";
  cacheLife("minutes");
  const { data } = await publicClient().from("games").select("week, home, away, status").eq("season", season).or(`home.eq.${team},away.eq.${team}`).order("week")
    .returns<{ week: number; home: string; away: string; status: string | null }[]>();
  return data ?? [];
}
