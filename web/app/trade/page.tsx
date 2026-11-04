import { fixTiers } from "@/lib/tiers";
import { Suspense } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { sessionUser } from "@/lib/session";
import { positionRankMap } from "@/lib/position-consensus";
import { defaultLineup } from "@/lib/lineup";
import { isOpen, type GameRow } from "@/lib/matchup";
import { TradeCalc, type P } from "./trade-calc";

type Row = {
  player_id: number; position_in_list: number; tier: string | null; is_stale: boolean;
  players: { name: string; position: string; nfl_team: string | null } | null;
};

const FORMATS = [["redraft", "Redraft"], ["dynasty", "Dynasty"]] as const;
const SCORING = [["ppr", "PPR"], ["half", "Half PPR"], ["std", "Standard"]] as const;
const QBS = [["1qb", "1 QB"], ["superflex", "Superflex"]] as const;

type Params = { format: string; scoring: string; qb: string; league: string };

function href(current: Params, over: Partial<Params>) {
  const next = { ...current, ...over };
  const defaults: Params = { format: "redraft", scoring: "ppr", qb: "1qb", league: "" };
  const qs = new URLSearchParams();
  (Object.keys(next) as (keyof Params)[]).forEach((k) => { if (next[k] !== defaults[k]) qs.set(k, next[k]); });
  const s = qs.toString();
  return s ? `/trade?${s}` : "/trade";
}

type LeagueRow = { id: number; name: string | null; format: string; scoring: string; qb_type: string; roster_settings: { lineup?: string[] } | null };
type RosterRow = { team_name: string; player_id: number; is_mine: boolean };
type PlayerRow = { id: number; name: string; position: string; nfl_team: string | null };

async function TradeView({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const pick = (k: string, ok: readonly string[], d: string) => { const v = sp[k]; return typeof v === "string" && ok.includes(v) ? v : d; };
  const params: Params = {
    format: pick("format", FORMATS.map((t) => t[0]), "redraft"),
    scoring: pick("scoring", SCORING.map((t) => t[0]), "ppr"),
    qb: pick("qb", QBS.map((t) => t[0]), "1qb"),
    league: "",
  };
  const byHand = ["format", "scoring", "qb"].some((k) => typeof sp[k] === "string");

  const supabase = await createClient();
  const user = await sessionUser();

  // Someone with a synced league trades inside that league, with its settings, unless they pick otherwise.
  const { data: leagueRows } = user
    ? await supabase.from("leagues").select("id, name, format, scoring, qb_type, roster_settings").order("synced_at", { ascending: false }).returns<LeagueRow[]>()
    : { data: [] as LeagueRow[] };
  const leagues = leagueRows ?? [];
  const wantLeague = typeof sp.league === "string" ? sp.league : "";
  const active = wantLeague === "all" || (!wantLeague && byHand) ? null : leagues.find((l) => String(l.id) === wantLeague) ?? (wantLeague ? null : leagues[0] ?? null);
  if (active) { params.format = active.format; params.scoring = active.scoring; params.qb = active.qb_type; params.league = String(active.id); }
  else if (leagues.length) params.league = "all";
  const combo = { format: params.format, scoring: params.scoring, qb_type: params.qb };

  const { data, error } = await supabase
    .from("consensus_current")
    .select("player_id, position_in_list, tier, is_stale, players(name, position, nfl_team)")
    .match(combo)
    .order("position_in_list").limit(1000)
    .returns<Row[]>();

  const rows = fixTiers(data ?? []);
  const posRank = new Map<number, number>();
  const count: Record<string, number> = {};
  rows.forEach((r) => { const k = r.players?.position ?? ""; count[k] = (count[k] ?? 0) + 1; posRank.set(r.player_id, count[k]); });
  Object.entries(await positionRankMap(combo)).forEach(([id, rank]) => posRank.set(Number(id), rank));

  // Every team in the league: who owns whom.
  const owner = new Map<number, { team: string; mine: boolean }>();
  let teams: string[] = [];
  if (active) {
    const { data: ros } = await supabase.from("league_rosters").select("team_name, player_id, is_mine").eq("league_id", active.id).limit(2000).returns<RosterRow[]>();
    (ros ?? []).forEach((r) => owner.set(r.player_id, { team: r.team_name, mine: r.is_mine }));
    teams = [...new Set((ros ?? []).filter((r) => !r.is_mine).map((r) => r.team_name))].sort();
  }
  const have = new Set(rows.map((r) => r.player_id));
  const missing = [...owner.keys()].filter((id) => !have.has(id));
  const extra = missing.length ? (await supabase.from("players").select("id, name, position, nfl_team").in("id", missing).returns<PlayerRow[]>()).data ?? [] : [];

  const players: P[] = [
    ...rows.map((r) => ({ id: r.player_id, name: r.players?.name ?? "Unknown", position: r.players?.position ?? "", team: r.players?.nfl_team ?? "", rank: r.position_in_list, posRank: posRank.get(r.player_id) ?? 0, tier: r.tier })),
    // Rostered players the rankings don't cover count after everyone who is ranked.
    ...extra.map((p, i) => ({ id: p.id, name: p.name, position: p.position, team: p.nfl_team ?? "", rank: 900 + i, posRank: 0, tier: null })),
  ].map((p) => ({ ...p, owner: owner.get(p.id)?.team ?? null, mine: owner.get(p.id)?.mine ?? false }));

  // The next three weeks of games, for each NFL team.
  const { data: latest } = await supabase.from("games").select("season").order("season", { ascending: false }).limit(1);
  const season = latest?.[0]?.season as number | undefined;
  const { data: gm } = season ? await supabase.from("games").select("week, home, away, status").eq("season", season).order("week").limit(1000).returns<GameRow[]>() : { data: [] as GameRow[] };
  const weeks = [...new Set((gm ?? []).filter(isOpen).map((g) => g.week))].sort((a, b) => a - b).slice(0, 3);
  const sched: Record<string, string[]> = {};
  (gm ?? []).forEach((g) => {
    const i = weeks.indexOf(g.week);
    if (i < 0) return;
    (sched[g.home] ??= weeks.map(() => "BYE"))[i] = `vs ${g.away}`;
    (sched[g.away] ??= weeks.map(() => "BYE"))[i] = `@${g.home}`;
  });

  const lineup = active?.roster_settings?.lineup?.length ? active.roster_settings.lineup : defaultLineup(params.qb === "superflex", { K: false, DEF: false });
  const pill = (on: boolean) => `gl-pill !rounded-full !px-3 !py-1 text-xs ${on ? "on" : ""}`;

  const intro = (
    <div>
      <p className="mb-1 text-xs tracking-[0.4em] text-zinc-400">FANTASY FOOTBALL</p>
      <h2 id="h-trade" className="gl-title text-4xl sm:text-5xl">Trade <span style={{ color: "var(--accent)" }}>Calculator</span></h2>
      <p className="mt-2 text-sm text-zinc-300">See how the trade impacts your roster, lineup, and upcoming matchups.</p>
    </div>
  );
  const settings = (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
      {leagues.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-bold uppercase tracking-wider text-zinc-400">Your league</span>
          {leagues.map((l) => <Link key={l.id} href={`/trade?league=${l.id}`} className={pill(active?.id === l.id)}>{l.name ?? "League"}</Link>)}
          <Link href={href({ ...params, league: "all" }, {})} className={pill(!active)}>No league</Link>
        </div>
      )}
      {active ? (
        <p className="text-zinc-400">Using {active.name ?? "your league"}&apos;s settings: {FORMATS.find((f) => f[0] === params.format)?.[1]} · {SCORING.find((f) => f[0] === params.scoring)?.[1]} · {QBS.find((f) => f[0] === params.qb)?.[1]}</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-1.5">{FORMATS.map(([v, l]) => <Link key={v} href={href(params, { format: v })} className={pill(params.format === v)}>{l}</Link>)}</div>
          <div className="flex flex-wrap gap-1.5">{SCORING.map(([v, l]) => <Link key={v} href={href(params, { scoring: v })} className={pill(params.scoring === v)}>{l}</Link>)}</div>
          <div className="flex flex-wrap gap-1.5">{QBS.map(([v, l]) => <Link key={v} href={href(params, { qb: v })} className={pill(params.qb === v)}>{l}</Link>)}</div>
        </>
      )}
    </div>
  );

  return error ? (
    <p className="rounded border border-red-900 bg-red-950/30 p-3 text-sm text-red-300">Could not load players: {error.message}</p>
  ) : players.length ? (
    // Remount when the settings change so a trade never mixes two different rankings.
    <TradeCalc key={`${params.format}-${params.scoring}-${params.qb}-${params.league}`} players={players} intro={intro} settings={settings}
      synced={!!active} teams={teams} lineup={lineup} weeks={weeks} sched={sched} />
  ) : (
    <div className="space-y-4">
      {intro}
      {settings}
      <div className="gl-panel p-4 text-sm text-zinc-400">No published rankings yet for these settings, so there is nothing to price a trade with.</div>
    </div>
  );
}

export default function TradePage(props: PageProps<"/trade">) {
  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-5 md:px-10 md:py-8">
      <Suspense fallback={<p className="text-zinc-400">Loading...</p>}>
        <TradeView searchParams={props.searchParams} />
      </Suspense>
    </main>
  );
}
