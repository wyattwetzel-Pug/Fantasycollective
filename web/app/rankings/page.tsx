import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { nowMs } from "@/lib/time";
import { createList } from "../lists/actions";

type Player = { name: string; position: string; nfl_team: string | null };
type ConsensusRow = {
  player_id: number; consensus_rank: number; sources: number; tier: string | null;
  is_stale: boolean; position_in_list: number; players: Player | null;
};
type ListRow = { player_id: number; rank: number; tier: string | null; note: string | null; players: Player | null };
type SetRow = {
  id: number; updated_at: string;
  contributors: { slug: string; profiles: { display_name: string } | null } | null;
};
type Row = {
  rank: number; name: string; position: string; posRank: number; team: string;
  tier: string | null; a: string; b: string;
};

const TIER_COLORS: Record<string, string> = {
  S: "#D4AF37", A: "#22A722", B: "#9333EA", C: "#3B82F6", D: "#FACC15", E: "#F97316", F: "#EF4444",
};
const FORMATS = [["redraft", "Redraft"], ["dynasty", "Dynasty"]] as const;
const SCORING = [["ppr", "PPR"], ["half", "Half PPR"], ["std", "Standard"]] as const;
const QBS = [["1qb", "1 QB"], ["superflex", "Superflex"]] as const;
const POSITIONS = ["All", "QB", "RB", "WR", "TE", "K", "DEF"];
const DAY = 24 * 60 * 60 * 1000;

type Params = { format: string; scoring: string; qb: string; pos: string; ranker: string; q: string };

function href(current: Params, over: Partial<Params>) {
  const next = { ...current, ...over };
  const defaults: Params = { format: "redraft", scoring: "ppr", qb: "1qb", pos: "All", ranker: "consensus", q: "" };
  const qs = new URLSearchParams();
  (Object.keys(next) as (keyof Params)[]).forEach((k) => { if (next[k] !== defaults[k]) qs.set(k, next[k]); });
  const s = qs.toString();
  return s ? `/rankings?${s}` : "/rankings";
}

function ago(iso: string) {
  const mins = Math.max(0, Math.round((nowMs() - new Date(iso).getTime()) / 60000));
  if (mins < 2) return "just now";
  if (mins < 60) return `${mins}m ago`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / 1440)}d ago`;
}

async function RankingsView({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const pick = (k: string, ok: readonly string[], d: string) => { const v = sp[k]; return typeof v === "string" && ok.includes(v) ? v : d; };
  const params: Params = {
    format: pick("format", FORMATS.map((f) => f[0]), "redraft"),
    scoring: pick("scoring", SCORING.map((f) => f[0]), "ppr"),
    qb: pick("qb", QBS.map((f) => f[0]), "1qb"),
    pos: pick("pos", POSITIONS, "All"),
    ranker: typeof sp.ranker === "string" ? sp.ranker : "consensus",
    q: typeof sp.q === "string" ? sp.q : "",
  };

  const supabase = await createClient();
  const combo = { format: params.format, scoring: params.scoring, qb_type: params.qb };

  // Contributors (the admin is one too) get a small Edit button.
  const { data: { user } } = await supabase.auth.getUser();
  const { data: me } = user
    ? await supabase.from("profiles").select("role").eq("id", user.id).single()
    : { data: null };
  const canEdit = me?.role === "contributor";

  // Everyone with a published list for this combination (for the Expert Sources panel).
  const { data: sets } = await supabase
    .from("ranking_sets")
    .select("id, updated_at, contributors(slug, profiles!contributors_profile_id_fkey(display_name))")
    .match(combo).eq("published", true)
    .returns<SetRow[]>();
  const sources = (sets ?? []).filter((s) => s.contributors);
  const fresh = sources.filter((s) => nowMs() - new Date(s.updated_at).getTime() < 7 * DAY);

  let rows: Row[] = [];
  let aLabel = "AVG RANK", bLabel = "SOURCES";
  let showing = "Ball Knowers Consensus";
  let stale = false;
  let loadError = "";

  const chosen = sources.find((s) => s.contributors?.slug === params.ranker);
  if (chosen) {
    showing = chosen.contributors?.profiles?.display_name ?? "Contributor";
    aLabel = "UPDATED"; bLabel = "NOTE";
    const { data, error } = await supabase
      .from("rankings")
      .select("player_id, rank, tier, note, players(name, position, nfl_team)")
      .eq("set_id", chosen.id).eq("needs_ranking", false)
      .order("rank").limit(1000)
      .returns<ListRow[]>();
    if (error) loadError = error.message;
    rows = (data ?? []).map((r, i) => ({
      rank: i + 1, name: r.players?.name ?? "Unknown", position: r.players?.position ?? "", posRank: 0,
      team: r.players?.nfl_team ?? "", tier: r.tier, a: ago(chosen.updated_at), b: r.note ?? "",
    }));
  } else {
    const { data, error } = await supabase
      .from("consensus_current")
      .select("player_id, consensus_rank, sources, tier, is_stale, position_in_list, players(name, position, nfl_team)")
      .match(combo).order("position_in_list").limit(1000)
      .returns<ConsensusRow[]>();
    if (error) loadError = error.message;
    stale = !!data?.length && data.every((r) => r.is_stale);
    rows = (data ?? []).map((r) => ({
      rank: r.position_in_list, name: r.players?.name ?? "Unknown", position: r.players?.position ?? "", posRank: 0,
      team: r.players?.nfl_team ?? "", tier: r.tier, a: String(r.consensus_rank), b: String(r.sources),
    }));
  }

  // Position rank across the whole list, then apply filters.
  const counts: Record<string, number> = {};
  rows.forEach((r) => { counts[r.position] = (counts[r.position] ?? 0) + 1; r.posRank = counts[r.position]; });
  const q = params.q.trim().toLowerCase();
  const shown = rows.filter((r) => (params.pos === "All" || r.position === params.pos) && (!q || r.name.toLowerCase().includes(q)));

  // Consecutive players with the same tier share one box.
  const runs: { tier: string | null; rows: Row[] }[] = [];
  shown.forEach((r) => {
    const last = runs[runs.length - 1];
    if (last && last.tier === r.tier) last.rows.push(r); else runs.push({ tier: r.tier, rows: [r] });
  });

  const season = new Date().getFullYear();
  const settings = `${FORMATS.find((f) => f[0] === params.format)?.[1]} · ${SCORING.find((f) => f[0] === params.scoring)?.[1]} · ${QBS.find((f) => f[0] === params.qb)?.[1]}`;
  const pill = (on: boolean) => `gl-pill ${on ? "on" : ""}`;

  return (
    <div className="space-y-4">
      <form action="/rankings" className="flex gap-2">
        {(Object.entries(params) as [keyof Params, string][]).filter(([k, v]) => k !== "q" && v).map(([k, v]) => (
          <input key={k} type="hidden" name={k} value={v} />
        ))}
        <label htmlFor="gsearch" className="sr-only">Search players</label>
        <input id="gsearch" name="q" type="search" defaultValue={params.q} placeholder="Search players..." className="gl-search" />
      </form>

      <div className="gl-hero grid items-center gap-4 p-5 md:grid-cols-[1fr_auto]">
        <div>
          <p className="text-[11px] tracking-[0.4em] text-zinc-400">FANTASY FOOTBALL</p>
          <h2 id="h-rank" className="gl-title text-5xl sm:text-6xl">RANKINGS</h2>
          <p className="mt-3 text-sm text-zinc-400">Player rankings from our contributors, plus the Ball Knowers Consensus.</p>
        </div>
        <div className="flex items-stretch gap-3">
          <div className="gl-stat"><span className="text-2xl font-extrabold italic">{rows.length}</span><span className="text-xs text-zinc-400">Player Rankings</span></div>
          <div className="gl-stat"><span className="text-2xl font-extrabold italic">{fresh.length}</span><span className="text-xs text-zinc-400">Contributors</span></div>
          <div className="gl-stat"><span className="text-2xl font-extrabold italic">{season}</span><span className="text-xs text-zinc-400">Season</span></div>
        </div>
      </div>

      <div className="gl-panel flex flex-wrap items-center gap-3 p-3">
        <div role="group" aria-label="League format" className="flex flex-wrap gap-2">
          {FORMATS.map(([v, label]) => <a key={v} href={href(params, { format: v })} className={pill(params.format === v)}>{label}</a>)}
        </div>
        <span className="hidden h-6 w-px bg-zinc-700 sm:block" aria-hidden="true" />
        <div role="group" aria-label="Position filter" className="flex flex-wrap gap-2">
          {POSITIONS.map((p) => <a key={p} href={href(params, { pos: p })} className={`gl-pill ${params.pos === p ? "on-o" : ""}`}>{p}</a>)}
        </div>
        <div className="flex-1" />
        {canEdit && (
          <form action={createList}>
            <input type="hidden" name="format" value={params.format} />
            <input type="hidden" name="scoring" value={params.scoring} />
            <input type="hidden" name="qb_type" value={params.qb} />
            <button className="gl-pill text-xs" title="Edit your own ranking for these settings">✎ Edit</button>
          </form>
        )}
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-[1fr_21rem]">
        <div className="min-w-0 space-y-4">
          <p className="text-xs text-zinc-500">Showing {showing} · {settings}</p>
          {stale && (
            <p className="rounded border border-yellow-900 bg-yellow-950/30 p-3 text-sm text-yellow-300">
              No contributor has updated in over 7 days, so this is the last known consensus.
            </p>
          )}
          {loadError && <p className="rounded border border-red-900 bg-red-950/30 p-3 text-sm text-red-300">Could not load rankings: {loadError}</p>}
          {!runs.length && !loadError && (
            <p className="text-zinc-400">
              {rows.length ? "No players match your filters." : "No rankings yet for this combination. Once a contributor publishes a list, it shows up here."}
            </p>
          )}
          <div className="space-y-4 overflow-x-auto">
            {runs.map((run, i) => {
              const c = run.tier ? TIER_COLORS[run.tier] : "#71717a";
              return (
                <div key={i} className="gl-tierbox min-w-[34rem]" style={{ borderColor: `${c}66` }}>
                  <div className="gl-tier" style={{ background: `linear-gradient(90deg,${c}55,${c}10 60%,transparent)` }}>
                    <span className="letter" style={{ background: `${c}99`, color: "#fff" }}>{run.tier ?? "–"}</span>
                    <span className="ml-3 text-xl font-extrabold italic">{run.tier ? "TIER" : "UNSORTED"}</span>
                  </div>
                  <table className="gl-table">
                    <thead>
                      <tr>
                        <th scope="col" className="w-8">#</th>
                        <th scope="col" className="!text-left">PLAYER</th>
                        <th scope="col">POS</th>
                        <th scope="col">TEAM</th>
                        <th scope="col">{aLabel}</th>
                        <th scope="col">{bLabel}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {run.rows.map((r) => (
                        <tr key={`${r.rank}-${r.name}`}>
                          <td>{r.rank}</td>
                          <td className="!text-left"><span className="flex items-center gap-2"><span className="h-8 w-8 shrink-0 rounded-full bg-zinc-700" aria-hidden="true" /><span className="pn">{r.name}</span></span></td>
                          <td><span className={`bd ${r.position}`}>{r.position} {r.posRank}</span></td>
                          <td>{r.team}</td>
                          <td>{r.a}</td>
                          <td className="max-w-[12rem] truncate">{r.b}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              );
            })}
          </div>
        </div>

        <div className="space-y-4 lg:sticky lg:top-4">
          <div className="gl-panel space-y-3 p-3">
            <h3 className="font-semibold">League settings</h3>
            <div>
              <p className="mb-1 text-xs text-zinc-400">Scoring</p>
              <div className="flex flex-wrap gap-2">
                {SCORING.map(([v, label]) => <a key={v} href={href(params, { scoring: v })} className={`${pill(params.scoring === v)} text-xs`}>{label}</a>)}
              </div>
            </div>
            <div>
              <p className="mb-1 text-xs text-zinc-400">QB slots</p>
              <div className="flex flex-wrap gap-2">
                {QBS.map(([v, label]) => <a key={v} href={href(params, { qb: v })} className={`${pill(params.qb === v)} text-xs`}>{label}</a>)}
              </div>
            </div>
          </div>

          <div className="gl-panel p-3">
            <h3 className="mb-3 font-semibold">👥 Expert Sources</h3>
            <div className="grid grid-cols-3 gap-2 text-center text-xs">
              <a href={href(params, { ranker: "consensus" })} className={`rounded-lg p-2 ${!chosen ? "gl-src-on" : ""}`}>
                <span className="mx-auto mb-1 flex h-10 w-10 items-center justify-center rounded-full bg-zinc-700 text-sm font-bold">∑</span>
                Ball Knowers Consensus
              </a>
              {sources.map((s) => {
                const name = s.contributors?.profiles?.display_name ?? "Contributor";
                const slug = s.contributors!.slug;
                const isStale = nowMs() - new Date(s.updated_at).getTime() >= 7 * DAY;
                return (
                  <a key={s.id} href={href(params, { ranker: slug })} className={`rounded-lg p-2 ${chosen?.id === s.id ? "gl-src-on" : ""}`}>
                    <span className="mx-auto mb-1 flex h-10 w-10 items-center justify-center rounded-full bg-zinc-700 text-sm font-bold">{name.slice(0, 1).toUpperCase()}</span>
                    {name}
                    <span className={`block text-[10px] ${isStale ? "text-yellow-400" : "text-zinc-500"}`}>{isStale ? "stale" : ago(s.updated_at)}</span>
                  </a>
                );
              })}
            </div>
            {!sources.length && <p className="mt-2 text-xs text-zinc-500">No published lists for these settings yet.</p>}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function RankingsPage(props: PageProps<"/rankings">) {
  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-5 md:px-10 md:py-8">
      <Suspense fallback={<p className="text-zinc-400">Loading...</p>}>
        <RankingsView searchParams={props.searchParams} />
      </Suspense>
    </main>
  );
}
