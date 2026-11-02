import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cacheLife } from "next/cache";

export type SeasonLine = { played: number; points: number; snapPct: number | null; posFinish: number | null; proj: number | null };

type StatRow = { player_id: number; season: number; week: number; pts: number | null; snaps: string | null; tsnaps: string | null };

// Everything the Rankings table shows beyond the rank: games played, snap share, finish among
// players at the position (by total points this season) and the latest weekly projection.
async function compute(db: SupabaseClient, scoring: string): Promise<Map<number, SeasonLine>> {
  const col = scoring === "ppr" ? "pts_ppr" : scoring === "half" ? "pts_half" : "pts_std";

  const { data: latest } = await db.from("player_stats").select("season").order("season", { ascending: false }).limit(1);
  const season = latest?.[0]?.season as number | undefined;
  const out = new Map<number, SeasonLine>();
  if (!season) return out;

  // PostgREST returns at most 1000 rows a request, so page through the season.
  const rows: StatRow[] = [];
  for (let from = 0; from < 10000; from += 1000) {
    const { data } = await db
      .from("player_stats")
      .select(`player_id, season, week, pts:${col}, snaps:stats->>off_snp, tsnaps:stats->>tm_off_snp`)
      .eq("season", season).order("player_id").order("week").range(from, from + 999)
      .returns<StatRow[]>();
    rows.push(...(data ?? []));
    if ((data?.length ?? 0) < 1000) break;
  }

  const agg = new Map<number, { played: number; points: number; snaps: number; team: number }>();
  for (const r of rows) {
    const a = agg.get(r.player_id) ?? { played: 0, points: 0, snaps: 0, team: 0 };
    a.played += 1; a.points += Number(r.pts ?? 0);
    if (r.snaps !== null && r.tsnaps !== null) { a.snaps += Number(r.snaps); a.team += Number(r.tsnaps); }
    agg.set(r.player_id, a);
  }

  const { data: players } = await db.from("players").select("id, position").limit(1000);
  const posOf = new Map((players ?? []).map((p) => [p.id as number, p.position as string]));
  const byPos = new Map<string, { id: number; points: number }[]>();
  for (const [id, a] of agg) {
    const pos = posOf.get(id);
    if (pos) byPos.set(pos, [...(byPos.get(pos) ?? []), { id, points: a.points }]);
  }
  const finish = new Map<number, number>();
  for (const list of byPos.values()) list.sort((x, y) => y.points - x.points).forEach((x, i) => finish.set(x.id, i + 1));

  const { data: pj } = await db.from("projections").select("season, week").eq("scoring", scoring)
    .order("season", { ascending: false }).order("week", { ascending: false }).limit(1);
  const projOf = new Map<number, number>();
  if (pj?.[0]) {
    const { data } = await db.from("projections").select("player_id, points")
      .eq("scoring", scoring).eq("season", pj[0].season).eq("week", pj[0].week).limit(1000);
    (data ?? []).forEach((p) => projOf.set(p.player_id as number, Number(p.points)));
  }

  for (const [id, a] of agg) {
    out.set(id, { played: a.played, points: a.points, snapPct: a.team ? (a.snaps / a.team) * 100 : null, posFinish: finish.get(id) ?? null, proj: projOf.get(id) ?? null });
  }
  for (const [id, p] of projOf) if (!out.has(id)) out.set(id, { played: 0, points: 0, snapPct: null, posFinish: null, proj: p });
  return out;
}

// Stats and projections are public and change a few times a day, so this is cached for a few minutes.
// Switching a position or setting on Rankings then doesn't reload the whole season from the database.
export async function seasonLines(scoring: string): Promise<Record<number, SeasonLine>> {
  "use cache";
  cacheLife("minutes");
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false } });
  return Object.fromEntries(await compute(db, scoring));
}
