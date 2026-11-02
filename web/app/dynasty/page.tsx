import { Suspense } from "react";
import { PlayerLink } from "@/app/player-link";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

type Row = {
  player_id: number; position_in_list: number; consensus_rank: number; sources: number; tier: string | null; is_stale: boolean;
  players: { name: string; position: string; nfl_team: string | null; age: number | null; is_rookie: boolean } | null;
};

const TIER_COLORS: Record<string, string> = {
  S: "#D4AF37", A: "#22A722", B: "#9333EA", C: "#3B82F6", D: "#FACC15", E: "#F97316", F: "#EF4444",
};
const TABS = [["overview", "Overview"], ["rookies", "Rookie Rankings"], ["breakouts", "Breakouts"], ["strategy", "Strategy"]] as const;
const SCORING = [["ppr", "PPR"], ["half", "Half PPR"], ["std", "Standard"]] as const;
const QBS = [["1qb", "1 QB"], ["superflex", "Superflex"]] as const;

type Params = { tab: string; qb: string; scoring: string };

function href(current: Params, over: Partial<Params>) {
  const next = { ...current, ...over };
  const defaults: Params = { tab: "overview", qb: "1qb", scoring: "ppr" };
  const qs = new URLSearchParams();
  (Object.keys(next) as (keyof Params)[]).forEach((k) => { if (next[k] !== defaults[k]) qs.set(k, next[k]); });
  const s = qs.toString();
  return s ? `/dynasty?${s}` : "/dynasty";
}

function PlayerTable({ rows, ranked }: { rows: { rank: number; r: Row }[]; ranked?: boolean }) {
  return (
    <table className="gl-table">
      <thead>
        <tr>
          <th scope="col" className="w-8">#</th>
          <th scope="col" className="!text-left">PLAYER</th>
          <th scope="col">POS</th>
          <th scope="col">TEAM</th>
          <th scope="col">AGE</th>
          <th scope="col">TIER</th>
          <th scope="col">{ranked ? "OVR" : "AVG RANK"}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(({ rank, r }) => {
          const c = r.tier ? TIER_COLORS[r.tier] : undefined;
          return (
            <tr key={r.position_in_list}>
              <td>{rank}</td>
              <td className="!text-left"><span className="flex items-center gap-2"><span className="h-8 w-8 shrink-0 rounded-full bg-zinc-700" aria-hidden="true" /><PlayerLink id={r.player_id} name={r.players?.name} /></span></td>
              <td><span className={`bd ${r.players?.position}`}>{r.players?.position}</span></td>
              <td>{r.players?.nfl_team}</td>
              <td>{r.players?.age ?? ""}</td>
              <td>{r.tier ? <span className="inline-block rounded-full border px-3 py-0.5 text-xs" style={{ color: c, borderColor: c }}>{r.tier}</span> : ""}</td>
              <td>{ranked ? r.position_in_list : r.consensus_rank}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function Panel({ title, sub, more, children }: { title: string; sub?: string; more?: { href: string; label: string }; children: React.ReactNode }) {
  return (
    <div className="gl-panel p-4">
      <div className="mb-3 flex items-start justify-between">
        <div>
          <h3 className="text-lg font-bold">{title}</h3>
          {sub && <p className="text-xs text-zinc-500">{sub}</p>}
        </div>
        {more && <Link href={more.href} className="text-xs" style={{ color: "#39ff14" }}>{more.label}</Link>}
      </div>
      {children}
    </div>
  );
}

async function DynastyView({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const pick = (k: string, ok: readonly string[], d: string) => { const v = sp[k]; return typeof v === "string" && ok.includes(v) ? v : d; };
  const params: Params = {
    tab: pick("tab", TABS.map((t) => t[0]), "overview"),
    qb: pick("qb", QBS.map((t) => t[0]), "1qb"),
    scoring: pick("scoring", SCORING.map((t) => t[0]), "ppr"),
  };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("consensus_current")
    .select("player_id, position_in_list, consensus_rank, sources, tier, is_stale, players(name, position, nfl_team, age, is_rookie)")
    .match({ format: "dynasty", scoring: params.scoring, qb_type: params.qb })
    .order("position_in_list").limit(1000)
    .returns<Row[]>();

  const all = data ?? [];
  const overall = all.map((r) => ({ rank: r.position_in_list, r }));
  const rookies = all.filter((r) => r.players?.is_rookie).map((r, i) => ({ rank: i + 1, r }));
  const stale = all.length > 0 && all.every((r) => r.is_stale);
  const pill = (on: boolean) => `gl-pill text-xs ${on ? "on" : ""}`;

  const empty = (
    <p className="text-sm text-zinc-400">
      No dynasty rankings yet for these settings. A contributor can add one from the Rankings page: choose Dynasty, then click Edit.
    </p>
  );

  return (
    <div className="space-y-4">
      <div className="gl-hero grid items-center gap-4 p-6 sm:p-8">
        <div className="flex items-center gap-4">
          <span className="hidden text-6xl sm:block" style={{ color: "#39ff14" }} aria-hidden="true">♛</span>
          <div>
            <h2 id="h-dyn" className="gl-title text-4xl sm:text-6xl">DYNASTY <span style={{ color: "#39ff14" }}>HUB</span></h2>
            <p className="mt-2 text-sm text-zinc-200">Long-term value, rookie insights, and dynasty strategy, all in one place.</p>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div role="tablist" aria-label="Dynasty sections" className="flex flex-wrap gap-2">
          {TABS.map(([v, label]) => (
            <Link key={v} role="tab" aria-selected={params.tab === v} href={href(params, { tab: v })} className={`gl-pill !px-5 ${params.tab === v ? "on-o" : ""}`}>{label}</Link>
          ))}
        </div>
        <div className="flex-1" />
        <div className="flex flex-wrap gap-2" role="group" aria-label="Scoring">
          {SCORING.map(([v, label]) => <Link key={v} href={href(params, { scoring: v })} className={pill(params.scoring === v)}>{label}</Link>)}
        </div>
        <div className="flex flex-wrap gap-2" role="group" aria-label="QB slots">
          {QBS.map(([v, label]) => <Link key={v} href={href(params, { qb: v })} className={pill(params.qb === v)}>{label}</Link>)}
        </div>
      </div>

      {error && <p className="rounded border border-red-900 bg-red-950/30 p-3 text-sm text-red-300">Could not load rankings: {error.message}</p>}
      {stale && (
        <p className="rounded border border-yellow-900 bg-yellow-950/30 p-3 text-sm text-yellow-300">
          No contributor has updated in over 7 days, so this is the last known consensus.
        </p>
      )}

      {params.tab === "overview" && (
        <div className="grid items-start gap-4 lg:grid-cols-2">
          <Panel title="▮ Dynasty Rankings" sub="Ball Knowers Consensus · top 10" more={{ href: "/rankings?format=dynasty", label: "View All →" }}>
            {overall.length ? <PlayerTable rows={overall.slice(0, 10)} /> : empty}
          </Panel>
          <Panel title="🎓 Rookie Rankings" sub="Ball Knowers Consensus · top 5" more={{ href: href(params, { tab: "rookies" }), label: "View Class →" }}>
            {rookies.length ? <PlayerTable rows={rookies.slice(0, 5)} ranked /> : <p className="text-sm text-zinc-400">No ranked rookies yet for these settings.</p>}
          </Panel>
          <Panel title="↗ Breakout Candidates" more={{ href: href(params, { tab: "breakouts" }), label: "View All →" }}>
            <p className="text-sm text-zinc-400">Breakout scores need usage and target data, which isn&apos;t loaded yet.</p>
          </Panel>
          <Panel title="🛠 Dynasty Tools">
            <div className="space-y-2">
              <Link href={href(params, { tab: "rookies" })} className="gl-row"><span className="flex-1">Rookie Rankings</span><span aria-hidden="true">›</span></Link>
              <Link href={href(params, { tab: "breakouts" })} className="gl-row"><span className="flex-1">Breakout Finder</span><span aria-hidden="true">›</span></Link>
              <Link href="/trade?format=dynasty" className="gl-row"><span className="flex-1">Trade Calculator</span><span aria-hidden="true">›</span></Link>
            </div>
          </Panel>
        </div>
      )}

      {params.tab === "rookies" && (
        <Panel title="🎓 Rookie Rankings" sub="Ball Knowers Consensus · full class">
          {rookies.length ? <PlayerTable rows={rookies} ranked /> : <p className="text-sm text-zinc-400">No ranked rookies yet for these settings.</p>}
        </Panel>
      )}

      {params.tab === "breakouts" && (
        <Panel title="↗ Breakout Candidates">
          <p className="text-sm text-zinc-400">Breakout scores need usage and target data, which isn&apos;t loaded yet. This page will list them once it is.</p>
        </Panel>
      )}

      {params.tab === "strategy" && (
        <Panel title="💡 Dynasty Strategy">
          <p className="text-sm text-zinc-400">Contributor strategy notes will go here.</p>
        </Panel>
      )}
    </div>
  );
}

export default function DynastyPage(props: PageProps<"/dynasty">) {
  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-5 md:px-10 md:py-8">
      <Suspense fallback={<p className="text-zinc-400">Loading...</p>}>
        <DynastyView searchParams={props.searchParams} />
      </Suspense>
    </main>
  );
}
