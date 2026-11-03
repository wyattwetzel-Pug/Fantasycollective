import { PointsChart } from "./points-chart";
import { TIER_COLORS } from "@/lib/tier-config";
import { fixTiers } from "@/lib/tiers";
import { Avatar } from "@/app/avatar";
import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { pickLabel } from "@/lib/adp";
import { playerValue } from "@/lib/value";
import { defenseVsPosition, matchupGrade, ordinal, isOpen, opponentOf, average } from "@/lib/matchup";

type Player = { id: number; name: string; position: string; nfl_team: string | null; age: number | null; status: string | null; is_rookie: boolean };
type Cons = { player_id: number; position_in_list: number; consensus_rank: number; sources: number; tier: string | null; is_stale: boolean; players: { position: string } | null };
type AllCons = { format: string; scoring: string; qb_type: string; position_in_list: number; tier: string | null };
type SetRow = { id: number; updated_at: string; contributors: { profiles: { display_name: string } | null } | null };
type RankRow = { set_id: number; rank: number; tier: string | null; note: string | null };
type AdpRow = { season: number; source: string; format: string; scoring: string; qb_type: string; adp: number; high: number | null; low: number | null; times_drafted: number | null; teams: number };
type NewsRow = { id: number; headline: string; body: string | null; published_at: string; url: string | null; source: string | null };
type StatRow = { week: number; season: number; stats: Record<string, number>; pts_ppr: number | null; pts_half: number | null; pts_std: number | null };
type GameRow = { week: number; home: string; away: string; status: string | null };
type CallRow = {
  id: number; week: number; season: number; player_a: number; player_b: number; pick: number; reason: string | null;
  contributors: { profiles: { display_name: string } | null } | null;
};

const FORMATS = [["redraft", "Redraft"], ["dynasty", "Dynasty"]] as const;
const SCORING = [["ppr", "PPR"], ["half", "Half PPR"]] as const;
const QBS = [["1qb", "1 QB"], ["superflex", "Superflex"]] as const;
const TABS = [["overview", "Overview"], ["log", "Game Log"], ["matchup", "Matchup"], ["adp", "ADP"], ["news", "News"], ["career", "Career"]] as const;
const LABEL: Record<string, string> = { redraft: "Redraft", dynasty: "Dynasty", ppr: "PPR", half: "Half PPR", std: "Standard", "1qb": "1 QB", superflex: "Superflex" };

type Params = { tab: string; format: string; scoring: string; qb: string };

const n = (v: number | undefined) => Math.round(v ?? 0);
// A short, position-aware stat line for one game.
function statLine(pos: string, s: Record<string, number>) {
  const rush = s.rush_att ? `${n(s.rush_att)} car, ${n(s.rush_yd)} yds${s.rush_td ? `, ${n(s.rush_td)} TD` : ""}` : "";
  const rec = s.rec_tgt || s.rec ? `${n(s.rec)}/${n(s.rec_tgt)} rec, ${n(s.rec_yd)} yds${s.rec_td ? `, ${n(s.rec_td)} TD` : ""}` : "";
  if (pos === "QB") {
    const pass = `${n(s.pass_cmp)}/${n(s.pass_att)}, ${n(s.pass_yd)} yds, ${n(s.pass_td)} TD${s.pass_int ? `, ${n(s.pass_int)} INT` : ""}`;
    return [pass, rush].filter(Boolean).join(" · ");
  }
  if (pos === "K") return `${n(s.fgm)}/${n(s.fga)} FG, ${n(s.xpm)}/${n(s.xpa)} XP`;
  if (pos === "DEF") return `${n(s.sack)} sacks, ${n(s.int)} INT, ${n(s.fum_rec)} FR, ${n(s.pts_allow)} pts allowed`;
  return [rush, rec].filter(Boolean).join(" · ") || "–";
}

async function Profile({ params: pp, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id: rawId } = await pp;
  const id = Number(rawId);
  if (!Number.isInteger(id) || id < 1) notFound();
  const sp = await searchParams;
  const pick = (k: string, ok: readonly string[], d: string) => { const v = sp[k]; return typeof v === "string" && ok.includes(v) ? v : d; };
  const params: Params = {
    tab: pick("tab", TABS.map((t) => t[0]), "overview"),
    format: pick("format", FORMATS.map((t) => t[0]), "redraft"),
    scoring: pick("scoring", SCORING.map((t) => t[0]), "ppr"),
    qb: pick("qb", QBS.map((t) => t[0]), "1qb"),
  };
  const href = (over: Partial<Params>) => {
    const n = { ...params, ...over };
    const qs = new URLSearchParams({ format: n.format, scoring: n.scoring, qb: n.qb });
    if (n.tab !== "overview") qs.set("tab", n.tab);
    return `/players/${id}?${qs}`;
  };

  const supabase = await createClient();
  const { data: player } = await supabase.from("players").select("id, name, position, nfl_team, age, status, is_rookie").eq("id", id).maybeSingle<Player>();
  if (!player) notFound();

  const combo = { format: params.format, scoring: params.scoring, qb_type: params.qb };
  const [{ data: statRows }, { data: projRows }, { data: consAll }, { data: everyCombo }, { data: sets }, { data: adpRows }, { data: news }, { data: calls }] = await Promise.all([
    supabase.from("player_stats").select("week, season, stats, pts_ppr, pts_half, pts_std").eq("player_id", id).order("season", { ascending: false }).order("week").returns<StatRow[]>(),
    supabase.from("projections").select("week, season, points").eq("player_id", id).eq("scoring", params.scoring).order("season", { ascending: false }).order("week", { ascending: false }).limit(2),
    supabase.from("consensus_current").select("player_id, position_in_list, consensus_rank, sources, tier, is_stale, players(position)").match(combo).order("position_in_list").limit(1000).returns<Cons[]>(),
    supabase.from("consensus_current").select("format, scoring, qb_type, position_in_list, tier").eq("player_id", id).returns<AllCons[]>(),
    supabase.from("ranking_sets").select("id, updated_at, contributors(profiles!contributors_profile_id_fkey(display_name))").match(combo).eq("published", true).returns<SetRow[]>(),
    supabase.from("adp").select("season, source, format, scoring, qb_type, adp, high, low, times_drafted, teams").eq("player_id", id).order("season", { ascending: false }).returns<AdpRow[]>(),
    supabase.from("news").select("id, headline, body, published_at, url, source").eq("player_id", id).order("published_at", { ascending: false }).limit(20).returns<NewsRow[]>(),
    supabase.from("start_sit_calls")
      .select("id, week, season, player_a, player_b, pick, reason, contributors(profiles!contributors_profile_id_fkey(display_name))")
      .or(`player_a.eq.${id},player_b.eq.${id}`).order("created_at", { ascending: false }).limit(10).returns<CallRow[]>(),
  ]);

  const fixedCons = fixTiers(consAll ?? []);
  const mine = fixedCons.find((c) => c.player_id === id);
  const samePos = fixedCons.filter((c) => c.players?.position === player.position);
  // Overall ranks leave out kickers and defenses, so only count the players who are on that list.
  const offList = (pos: string | undefined) => pos === "K" || pos === "DEF";
  const overallRank = mine
    ? offList(player.position) ? mine.position_in_list : fixedCons.filter((c) => !offList(c.players?.position) && c.position_in_list <= mine.position_in_list).length
    : 0;
  const posRank = mine ? samePos.findIndex((c) => c.player_id === id) + 1 : 0;

  // Same rule for the other formats: take out the kickers and defenses ranked ahead.
  const { data: offAll } = offList(player.position) ? { data: [] as { format: string; scoring: string; qb_type: string; position_in_list: number }[] } : await supabase
    .from("consensus_current").select("format, scoring, qb_type, position_in_list, players!inner(position)").in("players.position", ["K", "DEF"]).limit(1000)
    .returns<{ format: string; scoring: string; qb_type: string; position_in_list: number }[]>();
  const overallIn = (c: AllCons) => c.position_in_list - (offAll ?? []).filter((o) => o.format === c.format && o.scoring === c.scoring && o.qb_type === c.qb_type && o.position_in_list < c.position_in_list).length;

  const setIds = (sets ?? []).map((s) => s.id);
  const { data: theirRanks } = setIds.length
    ? await supabase.from("rankings").select("set_id, rank, tier, note").eq("player_id", id).in("set_id", setIds).eq("needs_ranking", false).returns<RankRow[]>()
    : { data: [] as RankRow[] };
  const contributorRows = (sets ?? []).map((s) => ({ s, r: (theirRanks ?? []).find((r) => r.set_id === s.id) })).filter((x) => x.r);

  // Game log for the newest season we have stats for.
  const logSeason = statRows?.[0]?.season;
  const log = (statRows ?? []).filter((r) => r.season === logSeason);
  const pts = (r: StatRow) => Number((params.scoring === "ppr" ? r.pts_ppr : params.scoring === "half" ? r.pts_half : r.pts_std) ?? 0);
  const total = log.reduce((sum, r) => sum + pts(r), 0);
  const ppg = log.length ? total / log.length : null;
  const best = log.length ? Math.max(...log.map(pts)) : null;
  const { data: games } = player.nfl_team && logSeason
    ? await supabase.from("games").select("week, home, away, status").eq("season", logSeason).or(`home.eq.${player.nfl_team},away.eq.${player.nfl_team}`).order("week").returns<GameRow[]>()
    : { data: [] as GameRow[] };
  const oppFor = (g: GameRow) => (g.home === player.nfl_team ? `vs ${g.away}` : `@ ${g.home}`);
  const next = (games ?? []).find(isOpen);
  const proj = projRows?.[0];

  // Matchup tab: how the next opponents' defenses do against this position.
  const defense = (params.tab === "matchup" || params.tab === "overview") && logSeason ? await defenseVsPosition(supabase, logSeason) : null;
  const vsPos = defense?.[player.position];
  const upcoming = (games ?? []).filter(isOpen).slice(0, 5);
  const recent = log.slice(-3).map(pts);
  const recentAvg = average(recent);

  const adpHere = (adpRows ?? []).find((a) => a.format === params.format && a.scoring === params.scoring && a.qb_type === params.qb);

  const otherIds = [...new Set((calls ?? []).flatMap((c) => [c.player_a, c.player_b]).filter((x) => x !== id))];
  const { data: others } = otherIds.length ? await supabase.from("players").select("id, name").in("id", otherIds) : { data: [] as { id: number; name: string }[] };
  const nameOf = (x: number) => (x === id ? player.name : others?.find((o) => o.id === x)?.name ?? "Unknown");

  const pill = (on: boolean) => `gl-pill !rounded-full text-xs ${on ? "on-o" : ""}`;
  const stat = (label: string, value: React.ReactNode, sub?: string) => (
    <div className="gl-stat"><span className="text-xl font-extrabold italic">{value}</span><span className="text-[11px] leading-tight text-zinc-400">{label}{sub ? ` · ${sub}` : ""}</span></div>
  );

  // Last three seasons, set by the Admin page's "Load past seasons" button.
  type SeasonRow = { season: number; gp: number | null; stats: Record<string, number>; pts_ppr: number | null; pts_half: number | null };
  const { data: seasonRows } = await supabase.from("player_seasons").select("season, gp, stats, pts_ppr, pts_half").eq("player_id", id).order("season", { ascending: false }).limit(3).returns<SeasonRow[]>();
  const n0 = (v: number | undefined) => (v === undefined ? "–" : Math.round(v).toLocaleString());
  const div1 = (a: number | undefined, b: number | undefined) => (a === undefined || !b ? "–" : (a / b).toFixed(1));
  type Col = [string, (r: SeasonRow) => string];
  const seasonCols: Col[] = player.position === "QB"
    ? [["CMP", (r) => n0(r.stats.pass_cmp)], ["ATT", (r) => n0(r.stats.pass_att)], ["YDS", (r) => n0(r.stats.pass_yd)], ["TD", (r) => n0(r.stats.pass_td)], ["INT", (r) => n0(r.stats.pass_int)], ["RUSH YDS", (r) => n0(r.stats.rush_yd)]]
    : player.position === "RB"
      ? [["CAR", (r) => n0(r.stats.rush_att)], ["YDS", (r) => n0(r.stats.rush_yd)], ["AVG", (r) => div1(r.stats.rush_yd, r.stats.rush_att)], ["TD", (r) => n0(r.stats.rush_td)], ["REC", (r) => n0(r.stats.rec)]]
      : player.position === "WR" || player.position === "TE"
        ? [["TGT", (r) => n0(r.stats.rec_tgt)], ["REC", (r) => n0(r.stats.rec)], ["YDS", (r) => n0(r.stats.rec_yd)], ["AVG", (r) => div1(r.stats.rec_yd, r.stats.rec)], ["TD", (r) => n0(r.stats.rec_td)]]
        : player.position === "K"
          ? [["FGM", (r) => n0(r.stats.fgm)], ["FGA", (r) => n0(r.stats.fga)], ["XPM", (r) => n0(r.stats.xpm)]]
          : [];
  const seasonPts = (r: SeasonRow) => Number((params.scoring === "half" ? r.pts_half : r.pts_ppr) ?? 0);
  const lastSeasons = (
    <div className="gl-panel px-4 py-3">
      <div className="mb-1 flex items-center justify-between gap-2">
        <h3 className="text-sm font-bold">Last 3 seasons <span className="text-xs font-normal text-zinc-400">{LABEL[params.scoring]}</span></h3>
        <Link href={href({ tab: "career" })} className="gl-pill !px-3 !py-1 text-xs">Full Career Log</Link>
      </div>
      {seasonRows?.length ? (
        <div className="overflow-x-auto">
          <table className="gl-table !text-[13px] [&_td]:!px-1.5 [&_td]:!py-1 [&_th]:!px-1.5 [&_th]:!py-0.5 [&_th]:!text-[10px]">
            <thead>
              <tr>
                <th scope="col" className="!text-left">SEASON</th>
                <th scope="col">GP</th>
                {seasonCols.map(([h]) => <th key={h} scope="col">{h}</th>)}
                <th scope="col">FPTS AVG</th>
                <th scope="col">FPTS</th>
              </tr>
            </thead>
            <tbody>
              {seasonRows.map((r) => (
                <tr key={r.season}>
                  <td className="!text-left text-zinc-400">{r.season}</td>
                  <td>{r.gp ?? "–"}</td>
                  {seasonCols.map(([h, f]) => <td key={h}>{f(r)}</td>)}
                  <td className="hl font-semibold">{r.gp ? (seasonPts(r) / r.gp).toFixed(1) : "–"}</td>
                  <td className="font-semibold">{seasonPts(r).toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <p className="text-sm text-zinc-400">No past seasons for {player.name} yet.</p>}
    </div>
  );

  // Career tab: every season we have, plus the season in progress (added up from the weekly stats).
  const careerCols: Col[] = player.position === "QB"
    ? [["CMP", (r) => n0(r.stats.pass_cmp)], ["ATT", (r) => n0(r.stats.pass_att)], ["PCT", (r) => (r.stats.pass_att ? `${((r.stats.pass_cmp ?? 0) / r.stats.pass_att * 100).toFixed(1)}%` : "–")], ["YDS", (r) => n0(r.stats.pass_yd)], ["TD", (r) => n0(r.stats.pass_td)], ["INT", (r) => n0(r.stats.pass_int)], ["CAR", (r) => n0(r.stats.rush_att)], ["RUSH YDS", (r) => n0(r.stats.rush_yd)], ["RUSH TD", (r) => n0(r.stats.rush_td)]]
    : player.position === "RB"
      ? [["CAR", (r) => n0(r.stats.rush_att)], ["RUSH YDS", (r) => n0(r.stats.rush_yd)], ["AVG", (r) => div1(r.stats.rush_yd, r.stats.rush_att)], ["RUSH TD", (r) => n0(r.stats.rush_td)], ["TGT", (r) => n0(r.stats.rec_tgt)], ["REC", (r) => n0(r.stats.rec)], ["REC YDS", (r) => n0(r.stats.rec_yd)], ["AVG", (r) => div1(r.stats.rec_yd, r.stats.rec)], ["REC TD", (r) => n0(r.stats.rec_td)], ["FUM", (r) => n0(r.stats.fum_lost)]]
      : player.position === "WR" || player.position === "TE"
        ? [["TGT", (r) => n0(r.stats.rec_tgt)], ["REC", (r) => n0(r.stats.rec)], ["REC YDS", (r) => n0(r.stats.rec_yd)], ["AVG", (r) => div1(r.stats.rec_yd, r.stats.rec)], ["REC TD", (r) => n0(r.stats.rec_td)], ["CAR", (r) => n0(r.stats.rush_att)], ["RUSH YDS", (r) => n0(r.stats.rush_yd)], ["AVG", (r) => div1(r.stats.rush_yd, r.stats.rush_att)], ["RUSH TD", (r) => n0(r.stats.rush_td)], ["FUM", (r) => n0(r.stats.fum_lost)]]
        : player.position === "K"
        ? [["FGM", (r) => n0(r.stats.fgm)], ["FGA", (r) => n0(r.stats.fga)], ["XPM", (r) => n0(r.stats.xpm)]]
        : [];
  let careerRows: SeasonRow[] = [];
  if (params.tab === "career") {
    const { data: all } = await supabase.from("player_seasons").select("season, gp, stats, pts_ppr, pts_half").eq("player_id", id).order("season", { ascending: false }).limit(40).returns<SeasonRow[]>();
    careerRows = all ?? [];
    if (logSeason && log.length && !careerRows.some((r) => r.season === logSeason)) {
      const sum: Record<string, number> = {};
      log.forEach((r) => Object.entries(r.stats).forEach(([k, v]) => { if (typeof v === "number") sum[k] = (sum[k] ?? 0) + v; }));
      careerRows = [{ season: logSeason, gp: log.length, stats: sum, pts_ppr: log.reduce((t, r) => t + Number(r.pts_ppr ?? 0), 0), pts_half: log.reduce((t, r) => t + Number(r.pts_half ?? 0), 0) }, ...careerRows];
    }
  }
  const careerTotal: SeasonRow = {
    season: 0, gp: careerRows.reduce((t, r) => t + (r.gp ?? 0), 0),
    stats: careerRows.reduce<Record<string, number>>((acc, r) => { Object.entries(r.stats).forEach(([k, v]) => { acc[k] = (acc[k] ?? 0) + v; }); return acc; }, {}),
    pts_ppr: careerRows.reduce((t, r) => t + Number(r.pts_ppr ?? 0), 0), pts_half: careerRows.reduce((t, r) => t + Number(r.pts_half ?? 0), 0),
  };

  // News tab: stories that name the player, then (if few) the latest from his team's feeds.
  let teamNews: NewsRow[] = [];
  if (params.tab === "news" && player.nfl_team && (news ?? []).length < 8) {
    const have = new Set((news ?? []).map((n) => n.headline));
    const { data: tn } = await supabase.from("news").select("id, headline, body, published_at, url, source").contains("teams", [player.nfl_team]).is("player_id", null).order("published_at", { ascending: false }).limit(12).returns<NewsRow[]>();
    const { data: tn2 } = await supabase.from("news").select("id, headline, body, published_at, url, source").contains("teams", [player.nfl_team]).not("player_id", "is", null).order("published_at", { ascending: false }).limit(30).returns<NewsRow[]>();
    const seenHead = new Set<string>();
    teamNews = [...(tn ?? []), ...(tn2 ?? [])].sort((a, b) => b.published_at.localeCompare(a.published_at))
      .filter((n) => { if (have.has(n.headline) || seenHead.has(n.headline)) return false; seenHead.add(n.headline); return true; }).slice(0, 10);
  }

  const newsRow = (n: NewsRow) => (
    <div key={n.id} className="gl-row !items-start">
      <span className="flex-1">
        {n.url ? <a href={n.url} target="_blank" rel="noopener noreferrer" className="block text-sm font-semibold hover:underline">{n.headline}</a> : <span className="block text-sm font-semibold">{n.headline}</span>}
        {n.body && <span className="block text-xs text-zinc-400">{n.body}</span>}
        <span className="block text-[11px] text-zinc-500">{n.source ? `${n.source} · ` : ""}{new Date(n.published_at).toLocaleDateString()}</span>
      </span>
    </div>
  );

  const nextMatchup = (
      <div className="gl-panel space-y-3 p-4">
        <h3 className="font-bold">Next matchup</h3>
        {next && player.nfl_team ? (() => {
          const opp = opponentOf(next, player.nfl_team);
          const a = vsPos?.get(opp);
          const grade = matchupGrade(a);
          return (
            <>
              <p className="text-2xl font-extrabold italic">{oppFor(next)} <span className="text-sm font-normal not-italic text-zinc-400">week {next.week}</span></p>
              {vsPos ? (
                a ? (
                  <p className="text-sm text-zinc-300">
                    {opp} gives up <span className="font-semibold text-white">{a.avg.toFixed(1)}</span> PPR points a game to {player.position}s,
                    {" "}<span className="font-semibold text-white">{ordinal(a.rank)} most</span> of {a.of} defenses.
                    {" "}Matchup: <span className="font-bold" style={{ color: grade.color }}>{grade.label}</span>.
                  </p>
                ) : <p className="text-sm text-zinc-400">No points-allowed data for {player.position}s against {opp} yet.</p>
              ) : <p className="text-sm text-zinc-400">Matchup ratings aren&apos;t available for {player.position}s.</p>}
              <dl className="grid grid-cols-2 gap-y-2 text-sm">
                <dt className="text-zinc-400">Projected ({LABEL[params.scoring]})</dt><dd>{proj ? `${Number(proj.points).toFixed(1)} (week ${proj.week})` : "–"}</dd>
                <dt className="text-zinc-400">Season average</dt><dd>{ppg === null ? "–" : ppg.toFixed(1)}</dd>
                <dt className="text-zinc-400">Last {recent.length || 3} games</dt><dd>{recentAvg === null ? "–" : recentAvg.toFixed(1)}</dd>
              </dl>
            </>
          );
        })() : <p className="text-sm text-zinc-400">{player.nfl_team ? "No upcoming game found." : `${player.name} is not on a team.`} Load the schedule from the Admin page.</p>}
      </div>
  );

  return (
    <div className="space-y-4">
      <div className="gl-hero flex flex-wrap items-center gap-5 p-5 sm:p-6">
        <Avatar id={player.id} name={player.name} size={80} />
        <div className="min-w-[16rem] flex-1">
          <h2 className="gl-title flex flex-wrap items-center gap-3 text-3xl sm:text-5xl">{player.name}{mine?.tier && <span className="relative top-[3px] inline-block rounded-full border px-5 py-0.5 align-middle font-sans text-base font-extrabold italic leading-snug" style={{ color: TIER_COLORS[mine.tier], borderColor: TIER_COLORS[mine.tier] }} title={`${mine.tier} tier`}>{mine.tier}</span>}</h2>
          <p className="mt-2 flex flex-wrap items-center gap-2 text-sm text-zinc-300">
            <span className={`bd ${player.position}`}>{player.position}</span>
            <span>{player.nfl_team ?? "Free agent"}</span>
            {player.age && <span>· Age {player.age}</span>}
            {player.status && player.status !== "Active" && <span>· {player.status}</span>}
            {player.is_rookie && <span className="rounded bg-green-900 px-2 text-xs text-green-300">Rookie</span>}
          </p>
        </div>
        <div className="grid w-full grid-cols-3 gap-2 sm:grid-flow-col sm:auto-cols-fr [&_.gl-stat]:min-w-0 [&_.gl-stat]:px-3 [&_.gl-stat]:py-2.5">
          {stat("Consensus rank", mine ? `#${overallRank}` : "–", mine && posRank ? `${player.position} ${posRank}` : undefined)}
          {stat("ADP", adpHere ? pickLabel(adpHere.adp, adpHere.teams) : "–", adpHere ? String(adpHere.season) : undefined)}
          {stat("Trade value", mine ? playerValue(mine.position_in_list).toFixed(1) : "–")}
          {stat("Pts / game", ppg === null ? "–" : ppg.toFixed(1), log.length ? `${log.length} games` : undefined)}
          {proj && stat("Projected", Number(proj.points).toFixed(1), `week ${proj.week}`)}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div role="tablist" aria-label="Profile sections" className="flex gap-2">
          {TABS.map(([v, l]) => <Link key={v} role="tab" aria-selected={params.tab === v} href={href({ tab: v })} className={`gl-pill !px-5 ${params.tab === v ? "on" : ""}`}>{l}</Link>)}
        </div>
        <div className="flex-1" />
        <div className="flex flex-wrap gap-2">{SCORING.map(([v, l]) => <Link key={v} href={href({ scoring: v })} className={pill(params.scoring === v)}>{l}</Link>)}</div>
      </div>

      {params.tab === "overview" && (
        <div className="grid items-start gap-4 md:grid-cols-2">
          <div className="space-y-4">
            {nextMatchup}
            {lastSeasons}
          </div>

          <div className="gl-panel p-4">
            <h3 className="mb-2 font-bold">Points by week{logSeason ? ` · ${logSeason}` : ""} <span className="text-xs font-normal text-zinc-400">{LABEL[params.scoring]}</span></h3>
            <PointsChart data={log.map((r) => ({ week: r.week, pts: pts(r) }))} scoring={LABEL[params.scoring]} />
            {(everyCombo ?? []).length > 0 && (
              <>
                <h4 className="mb-1 mt-4 text-sm font-bold">Consensus in every format</h4>
                <ul className="space-y-1 text-sm">
                  {(everyCombo ?? []).map((c) => (
                    <li key={`${c.format}${c.scoring}${c.qb_type}`} className="flex justify-between">
                      <span className="text-zinc-300">{LABEL[c.format]} · {LABEL[c.scoring]} · {LABEL[c.qb_type]}</span>
                      <span>#{overallIn(c)}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>

          <div className="gl-panel p-4">
            <h3 className="mb-2 font-bold">Contributor takes</h3>
            {contributorRows.some(({ r }) => r!.note) ? (
              <ul className="space-y-3 text-sm">
                {contributorRows.filter(({ r }) => r!.note).map(({ s, r }) => (
                  <li key={s.id}><span className="pn">{s.contributors?.profiles?.display_name}</span><span className="block text-zinc-300">{r!.note}</span></li>
                ))}
              </ul>
            ) : <p className="text-sm text-zinc-400">No contributor has left a note on {player.name} yet.</p>}
          </div>

          <div className="gl-panel p-4">
            <h3 className="mb-2 font-bold">Start / Sit calls</h3>
            {(calls ?? []).length ? (
              <ul className="space-y-2 text-sm">
                {(calls ?? []).map((c) => (
                  <li key={c.id}>
                    <span className="pn">{c.contributors?.profiles?.display_name ?? "Contributor"}</span> starts{" "}
                    <span className="pn" style={{ color: "var(--accent)" }}>{nameOf(c.pick)}</span> over {nameOf(c.pick === c.player_a ? c.player_b : c.player_a)}
                    <span className="block text-xs text-zinc-500">Week {c.week}, {c.season}</span>
                    {c.reason && <span className="block text-zinc-300">{c.reason}</span>}
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-zinc-400">No calls involve {player.name} yet.</p>}
            <Link href={`/startsit?p=${id}`} className="mt-3 inline-block text-xs" style={{ color: "var(--accent)" }}>Compare in Start/Sit →</Link>
          </div>
        </div>
      )}

      {params.tab === "log" && (
        <div className="gl-panel p-4">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-bold">Game Log{logSeason ? ` · ${logSeason}` : ""}</h3>
            {next && <span className="text-xs text-zinc-300">Next: {oppFor(next)} (week {next.week})</span>}
          </div>
          {log.length ? (
            <div className="overflow-x-auto">
              <table className="gl-table min-w-[34rem]">
                <thead><tr><th scope="col">WK</th><th scope="col">OPP</th><th scope="col" className="!text-left">LINE</th><th scope="col">{LABEL[params.scoring].toUpperCase()} PTS</th></tr></thead>
                <tbody>
                  {log.map((r) => {
                    const g = (games ?? []).find((x) => x.week === r.week);
                    const p = pts(r);
                    return (
                      <tr key={r.week}>
                        <td>{r.week}</td>
                        <td>{g ? oppFor(g) : "–"}</td>
                        <td className="!text-left text-zinc-200">{statLine(player.position, r.stats)}</td>
                        <td className="font-semibold" style={{ color: best !== null && p === best ? "var(--accent)" : undefined }}>{p.toFixed(1)}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t border-zinc-700"><td /><td /><td className="!text-left font-semibold">Total · {log.length} games</td><td className="font-semibold">{total.toFixed(1)}</td></tr>
                </tfoot>
              </table>
            </div>
          ) : (
            <p className="text-sm text-zinc-400">No game stats are loaded for {player.name} yet. The admin can load them from the Admin page (Stats and schedule).</p>
          )}
        </div>
      )}

      {params.tab === "matchup" && (
        <div className="grid items-start gap-4 md:grid-cols-2">
          {nextMatchup}

          <div className="gl-panel p-4">
            <h3 className="mb-2 font-bold">Upcoming schedule</h3>
            {upcoming.length && player.nfl_team ? (
              <table className="gl-table">
                <thead><tr><th scope="col">WK</th><th scope="col">OPP</th><th scope="col">PTS ALLOWED TO {player.position}</th><th scope="col">MATCHUP</th></tr></thead>
                <tbody>
                  {upcoming.map((g) => {
                    const a = vsPos?.get(opponentOf(g, player.nfl_team!));
                    const grade = matchupGrade(a);
                    return (
                      <tr key={g.week}>
                        <td>{g.week}</td>
                        <td>{oppFor(g)}</td>
                        <td>{a ? `${a.avg.toFixed(1)} (${ordinal(a.rank)})` : "–"}</td>
                        <td className="font-semibold" style={{ color: grade.color }}>{grade.label}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : <p className="text-sm text-zinc-400">No upcoming games loaded.</p>}
            <p className="mt-3 text-xs text-zinc-500">Points allowed are PPR fantasy points to the position this season. 1st means the friendliest defense.</p>
          </div>
        </div>
      )}

      {params.tab === "career" && (
        <div className="gl-panel p-4">
          <h3 className="mb-2 font-bold">Career log <span className="text-xs font-normal text-zinc-400">{LABEL[params.scoring]}</span></h3>
          {careerRows.length ? (
            <div className="overflow-x-auto">
              <table className="gl-table">
                <thead>
                  <tr>
                    <th scope="col" className="!text-left">SEASON</th>
                    <th scope="col">GP</th>
                    {careerCols.map(([h], i) => <th key={`${h}${i}`} scope="col">{h}</th>)}
                    <th scope="col">FPTS AVG</th>
                    <th scope="col">FPTS</th>
                  </tr>
                </thead>
                <tbody>
                  {[...careerRows, careerTotal].map((r) => (
                    <tr key={r.season} className={r.season === 0 ? "font-bold" : undefined} style={r.season === 0 ? { background: "var(--hilite)" } : undefined}>
                      <td className="!text-left whitespace-nowrap text-zinc-400">{r.season === 0 ? "Career" : r.season === logSeason ? `${r.season} *` : r.season}</td>
                      <td>{r.gp ?? "–"}</td>
                      {careerCols.map(([h, f], i) => <td key={`${h}${i}`}>{f(r)}</td>)}
                      <td className="font-semibold">{r.gp ? (seasonPts(r) / r.gp).toFixed(1) : "–"}</td>
                      <td className="font-semibold">{seasonPts(r).toFixed(1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-2 text-xs text-zinc-500">* Season in progress. Past seasons come from the Admin page&apos;s Load past seasons button.</p>
            </div>
          ) : <p className="text-sm text-zinc-400">No career stats for {player.name} yet. Load past seasons from the Admin page.</p>}
        </div>
      )}

      {params.tab === "adp" && (
        <div className="gl-panel p-4">
          <h3 className="mb-2 font-bold">Average draft position</h3>
          {(adpRows ?? []).length ? (
            <div className="overflow-x-auto">
              <table className="gl-table min-w-[30rem]">
                <thead><tr><th scope="col" className="!text-left">SETTINGS</th><th scope="col">SEASON</th><th scope="col">ADP</th><th scope="col">HIGH-LOW</th><th scope="col">DRAFTED</th><th scope="col" className="!text-left">SOURCE</th></tr></thead>
                <tbody>
                  {(adpRows ?? []).map((a) => (
                    <tr key={`${a.season}${a.source}${a.format}${a.scoring}${a.qb_type}`}>
                      <td className="!text-left">{LABEL[a.format]} · {LABEL[a.scoring]} · {LABEL[a.qb_type]}</td>
                      <td>{a.season}</td>
                      <td><span className="inline-block rounded-full border px-3 py-0.5 text-xs font-semibold" style={{ background: "#E3EAD9", color: "#46634E", borderColor: "#55745D" }}>{pickLabel(a.adp, a.teams)}</span></td>
                      <td>{a.high ?? "–"}-{a.low ?? "–"}</td>
                      <td>{a.times_drafted ?? "–"}</td>
                      <td className="!text-left text-zinc-400">{a.source}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="text-sm text-zinc-400">No ADP is loaded for {player.name}.</p>}
        </div>
      )}

      {params.tab === "news" && (
        <div className="gl-panel space-y-2 p-4">
          <h3 className="mb-2 font-bold">News</h3>
          {[...(news ?? [])].map((n) => newsRow(n))}
          {!(news ?? []).length && <p className="text-sm text-zinc-400">No stories name {player.name} right now.</p>}
          {teamNews.length > 0 && (
            <>
              <h4 className="pt-3 text-sm font-bold">More from {player.nfl_team}</h4>
              {teamNews.map((n) => newsRow(n))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default function PlayerPage(props: PageProps<"/players/[id]">) {
  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-5 md:px-10 md:py-8">
      <Suspense fallback={<p className="text-zinc-400">Loading...</p>}>
        <Profile params={props.params} searchParams={props.searchParams} />
      </Suspense>
    </main>
  );
}
