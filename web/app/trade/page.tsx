import { fixTiers } from "@/lib/tiers";
import { Suspense } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { TradeCalc, type P } from "./trade-calc";

type Row = {
  player_id: number; position_in_list: number; tier: string | null; is_stale: boolean;
  players: { name: string; position: string; nfl_team: string | null } | null;
};

const FORMATS = [["redraft", "Redraft"], ["dynasty", "Dynasty"]] as const;
const SCORING = [["ppr", "PPR"], ["half", "Half PPR"], ["std", "Standard"]] as const;
const QBS = [["1qb", "1 QB"], ["superflex", "Superflex"]] as const;

type Params = { format: string; scoring: string; qb: string };

function href(current: Params, over: Partial<Params>) {
  const next = { ...current, ...over };
  const defaults: Params = { format: "redraft", scoring: "ppr", qb: "1qb" };
  const qs = new URLSearchParams();
  (Object.keys(next) as (keyof Params)[]).forEach((k) => { if (next[k] !== defaults[k]) qs.set(k, next[k]); });
  const s = qs.toString();
  return s ? `/trade?${s}` : "/trade";
}

async function TradeView({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const pick = (k: string, ok: readonly string[], d: string) => { const v = sp[k]; return typeof v === "string" && ok.includes(v) ? v : d; };
  const params: Params = {
    format: pick("format", FORMATS.map((t) => t[0]), "redraft"),
    scoring: pick("scoring", SCORING.map((t) => t[0]), "ppr"),
    qb: pick("qb", QBS.map((t) => t[0]), "1qb"),
  };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("consensus_current")
    .select("player_id, position_in_list, tier, is_stale, players(name, position, nfl_team)")
    .match({ format: params.format, scoring: params.scoring, qb_type: params.qb })
    .order("position_in_list").limit(1000)
    .returns<Row[]>();

  const count: Record<string, number> = {};
  const players: P[] = fixTiers(data ?? []).map((r) => {
    const position = r.players?.position ?? "";
    count[position] = (count[position] ?? 0) + 1;
    return { id: r.player_id, name: r.players?.name ?? "Unknown", position, team: r.players?.nfl_team ?? "", rank: r.position_in_list, posRank: count[position], tier: r.tier };
  });
  const pill = (on: boolean) => `gl-pill !rounded-full text-xs ${on ? "on-o" : ""}`;

  const intro = (
    <div>
      <p className="mb-1 text-xs tracking-[0.4em] text-zinc-400">FANTASY FOOTBALL</p>
      <h2 id="h-trade" className="gl-title text-4xl sm:text-5xl">Trade <span style={{ color: "var(--accent)" }}>Calculator</span></h2>
      <p className="mt-2 text-sm text-zinc-300">Compare trades, analyze value, and make smarter moves.</p>
    </div>
  );
  const settings = (
    <div className="gl-panel space-y-3 p-4">
      <h3 className="font-bold"><span style={{ color: "var(--accent)" }} aria-hidden="true">⚙</span> League Settings</h3>
      <div>
        <p className="mb-1 text-sm">League Type</p>
        <div className="grid grid-cols-2 gap-2">{FORMATS.map(([v, l]) => <Link key={v} href={href(params, { format: v })} className={`${pill(params.format === v)} text-center`}>{l}</Link>)}</div>
      </div>
      <div>
        <p className="mb-1 text-sm">Scoring Format</p>
        <div className="grid grid-cols-3 gap-2">{SCORING.map(([v, l]) => <Link key={v} href={href(params, { scoring: v })} className={`${pill(params.scoring === v)} !px-2 text-center`}>{l}</Link>)}</div>
      </div>
      <div>
        <p className="mb-1 text-sm">Starting Lineup</p>
        <div className="grid grid-cols-2 gap-2">{QBS.map(([v, l]) => <Link key={v} href={href(params, { qb: v })} className={`${pill(params.qb === v)} text-center`}>{l}</Link>)}</div>
      </div>
      <p className="text-xs text-zinc-500">Changing a setting clears the trade, since each setting has its own rankings.</p>
    </div>
  );

  return error ? (
    <p className="rounded border border-red-900 bg-red-950/30 p-3 text-sm text-red-300">Could not load players: {error.message}</p>
  ) : players.length ? (
    // Remount when the settings change so a trade never mixes two different rankings.
    <TradeCalc key={`${params.format}-${params.scoring}-${params.qb}`} players={players} intro={intro} settings={settings} />
  ) : (
    <div className="space-y-4">
      {intro}
      <div className="grid items-start gap-4 lg:grid-cols-[1fr_20rem]">
        <div className="gl-panel p-4 text-sm text-zinc-400">No published rankings yet for these settings, so there is nothing to price a trade with.</div>
        {settings}
      </div>
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
