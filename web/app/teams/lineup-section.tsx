import { createClient } from "@/lib/supabase/server";
import { defaultLineup, fillLineup } from "@/lib/lineup";
import { defenseVsPosition, isOpen, opponentOf, type GameRow } from "@/lib/matchup";
import { seasonLines } from "@/lib/season";
import { fixTiers } from "@/lib/tiers";
import { LineupBoard, type P } from "./lineup-board";

type Db = Awaited<ReturnType<typeof createClient>>;
export type LineupLeague = { id: number; name: string | null; platform: string; scoring: string; qb_type: string; format: string; roster_settings: { lineup?: string[] } | null };
type RosterRow = { team_name: string; player_id: number; slot: string };
type PlayerRow = { id: number; name: string; position: string; nfl_team: string | null };
type ConsensusRow = { player_id: number; position_in_list: number; tier: string | null };

// Your starters, bench, and the best lineup your roster can field, for one synced league.
export async function LineupSection({ supabase, userId, chosen, isContributor, source }: {
  supabase: Db; userId: string; chosen: LineupLeague; isContributor: boolean; source: "mine" | "consensus" | "proj";
}) {
  const combo = { format: chosen.format, scoring: chosen.scoring, qb_type: chosen.qb_type };

  const { data: rosterAll } = await supabase.from("league_rosters").select("team_name, player_id, slot").eq("league_id", chosen.id).eq("is_mine", true).limit(500).returns<RosterRow[]>();
  const rosterRows = rosterAll ?? [];

  if (!rosterRows.length) {
    return <div className="gl-panel p-5 text-sm text-zinc-300">We couldn&apos;t tell which team is yours in {chosen.name}. Sync it again and type part of your team name in the form on the left.</div>;
  }

  const [{ data: playerRows }, { data: cons }, { data: mySet }, lineMap] = await Promise.all([
    supabase.from("players").select("id, name, position, nfl_team").limit(1000).returns<PlayerRow[]>(),
    supabase.from("consensus_current").select("player_id, position_in_list, tier").match(combo).order("position_in_list").limit(1000).returns<ConsensusRow[]>(),
    isContributor ? supabase.from("ranking_sets").select("id").match({ ...combo, contributor_id: userId }).maybeSingle() : Promise.resolve({ data: null }),
    seasonLines(chosen.scoring),
  ]);
  const info = new Map((playerRows ?? []).map((p) => [p.id, p]));
  const consensus = new Map<number, number>(fixTiers(cons ?? []).map((c) => [c.player_id, c.position_in_list]));
  const mine = new Map<number, number>();
  if (source === "mine" && mySet) {
    const { data: own } = await supabase.from("rankings").select("player_id").eq("set_id", mySet.id).eq("needs_ranking", false).order("rank").limit(2000).returns<{ player_id: number }[]>();
    (own ?? []).forEach((r, i) => mine.set(r.player_id, i + 1));
  }
  const rankOf = (id: number) => (source === "mine" ? mine.get(id) ?? consensus.get(id) : consensus.get(id)) ?? null;

  // Position rank across the whole pool on the chosen ranking.
  const posRank = new Map<number, number>();
  const counts: Record<string, number> = {};
  [...info.values()].map((p) => ({ p, r: rankOf(p.id) })).filter((x) => x.r !== null).sort((a, b) => a.r! - b.r!)
    .forEach(({ p }) => { counts[p.position] = (counts[p.position] ?? 0) + 1; posRank.set(p.id, counts[p.position]); });

  // Next game and how that defense does against each position.
  const teams = [...new Set(rosterRows.map((r) => info.get(r.player_id)?.nfl_team).filter((t): t is string => !!t))];
  const { data: latest } = await supabase.from("games").select("season").order("season", { ascending: false }).limit(1);
  const season = latest?.[0]?.season as number | undefined;
  const [{ data: gm }, defense] = await Promise.all([
    season && teams.length
      ? supabase.from("games").select("week, home, away, status").eq("season", season).or(`home.in.(${teams.join(",")}),away.in.(${teams.join(",")})`).order("week").returns<GameRow[]>()
      : Promise.resolve({ data: [] as GameRow[] }),
    season ? defenseVsPosition(supabase, season) : Promise.resolve({} as Awaited<ReturnType<typeof defenseVsPosition>>),
  ]);

  const roster: P[] = rosterRows.flatMap((r) => {
    const p = info.get(r.player_id);
    if (!p) return [];
    const l = lineMap[p.id];
    const next = p.nfl_team ? (gm ?? []).find((g) => (g.home === p.nfl_team || g.away === p.nfl_team) && isOpen(g)) ?? null : null;
    const opp = next && p.nfl_team ? opponentOf(next, p.nfl_team) : null;
    return [{
      id: p.id, name: p.name, pos: p.position, team: p.nfl_team, slot: r.slot, rank: rankOf(p.id), posRank: posRank.get(p.id) ?? null,
      proj: l?.proj ?? null, ppg: l && l.played ? l.points / l.played : null, next, opp,
      allowed: opp ? defense[p.position]?.get(opp) : undefined,
    }];
  });

  const hasPos = (pos: string) => roster.some((p) => p.pos === pos);
  const lineup = chosen.roster_settings?.lineup?.length ? chosen.roster_settings.lineup : defaultLineup(chosen.qb_type === "superflex", { K: hasPos("K"), DEF: hasPos("DEF") });
  const score = (p: P) => (source === "proj" ? p.proj ?? -1 : p.rank === null ? -9999 : -p.rank);

  const starters = roster.filter((p) => p.slot === "starter");
  const current = fillLineup(lineup, starters, (p) => (p.rank === null ? -9999 : -p.rank));
  const recommended = fillLineup(lineup, roster.filter((p) => p.slot !== "ir"), score);

  // Pair each new starter with a current starter who comes out.
  const startIds = new Set(starters.map((p) => p.id));
  const recIds = new Set(recommended.map((r) => r.player?.id));
  const sits = starters.filter((p) => !recIds.has(p.id));
  const swapFor = new Map<number, P>();
  recommended.forEach(({ player }) => {
    if (!player || startIds.has(player.id)) return;
    const pick = sits.find((s) => s.pos === player.pos && ![...swapFor.values()].includes(s)) ?? sits.find((s) => ![...swapFor.values()].includes(s));
    if (pick) swapFor.set(player.id, pick);
  });
  // Everyone not in the best lineup, as the bench (injured reserve last).
  const benchBest = roster.filter((p) => !recIds.has(p.id)).sort((a, b) => (a.slot === "ir" ? 1 : 0) - (b.slot === "ir" ? 1 : 0) || score(b) - score(a));
  const changes = recommended.filter((r) => r.player && !startIds.has(r.player.id)).length;
  const sum = (xs: (P | null)[]) => xs.reduce((s, p) => s + (p?.proj ?? 0), 0);
  const curProj = sum(current.map((c) => c.player));
  const recProj = sum(recommended.map((r) => r.player));
  const recPpg = recommended.reduce((t, r) => t + (r.player?.ppg ?? 0), 0);

  return (
    <LineupBoard
      platform={chosen.platform} leagueId={chosen.id} source={source} isContributor={isContributor}
      starters={starters} recommended={recommended} benchBest={benchBest} recPpg={recPpg}
      startIds={startIds} swapFor={swapFor} changes={changes} curProj={curProj} recProj={recProj}
    />
  );
}
