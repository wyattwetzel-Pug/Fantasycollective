import { fixTiers } from "@/lib/tiers";
import { Avatar } from "@/app/avatar";
import { Suspense } from "react";
import Link from "next/link";
import { PlayerLink } from "@/app/player-link";
import { createClient } from "@/lib/supabase/server";
import { nowMs } from "@/lib/time";
import { createList } from "../lists/actions";
import { TeamLogo } from "@/app/team-logo";
import { seasonLines } from "@/lib/season";
import { InlineEditor, type Item, type Line } from "./inline-editor";

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
  id: number; rank: number; name: string; position: string; posRank: number; team: string;
  tier: string | null; sub: string;
};

const TIER_COLORS: Record<string, string> = {
  S: "#D4A72C", A: "#43B02A", B: "#2F7BEA", C: "#8B5CF6", D: "#E0A800", E: "#F28C28", F: "#E5484D",
};
const FORMATS = [["redraft", "Redraft"], ["dynasty", "Dynasty"]] as const;
const SCORING = [["ppr", "PPR"], ["half", "Half PPR"], ["std", "Standard"]] as const;
const QBS = [["1qb", "1 QB"], ["superflex", "Superflex"]] as const;
const POSITIONS = ["All", "QB", "RB", "WR", "TE", "K", "DEF"];
const DAY = 24 * 60 * 60 * 1000;

type Params = { format: string; scoring: string; qb: string; pos: string; ranker: string; q: string; proj: string; edit: string; n: string };

function href(current: Params, over: Partial<Params>) {
  const next = { ...current, ...over };
  if (!("n" in over)) next.n = "100";
  const defaults: Params = { format: "redraft", scoring: "ppr", qb: "1qb", pos: "All", ranker: "consensus", q: "", proj: "1", edit: "", n: "100" };
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
    proj: sp.proj === "0" ? "0" : "1",
    edit: sp.edit === "1" ? "1" : "",
    n: String(Math.min(1000, Math.max(100, Math.round((Number(sp.n) || 100) / 100) * 100))),
  };

  const supabase = await createClient();
  const combo = { format: params.format, scoring: params.scoring, qb_type: params.qb };

  // Contributors (the admin is one too) get a small Edit button.
  const { data: { user } } = await supabase.auth.getUser();
  const { data: me } = user
    ? await supabase.from("profiles").select("role").eq("id", user.id).single()
    : { data: null };
  const canEdit = me?.role === "contributor";
  const editing = canEdit && params.edit === "1";

  // Everyone with a published list for this combination (for the Expert Sources panel).
  const { data: sets } = await supabase
    .from("ranking_sets")
    .select("id, updated_at, contributors(slug, profiles!contributors_profile_id_fkey(display_name))")
    .match(combo).eq("published", true)
    .returns<SetRow[]>();
  const sources = (sets ?? []).filter((s) => s.contributors);
  const fresh = sources.filter((s) => nowMs() - new Date(s.updated_at).getTime() < 7 * DAY);

  let rows: Row[] = [];
  let showing = "Ball Knowers Consensus";
  let stale = false;
  let loadError = "";

  const chosen = sources.find((s) => s.contributors?.slug === params.ranker);
  if (chosen) {
    showing = chosen.contributors?.profiles?.display_name ?? "Contributor";
    const { data, error } = await supabase
      .from("rankings")
      .select("player_id, rank, tier, note, players(name, position, nfl_team)")
      .eq("set_id", chosen.id).eq("needs_ranking", false)
      .order("rank").limit(1000)
      .returns<ListRow[]>();
    if (error) loadError = error.message;
    rows = fixTiers(data ?? []).map((r, i) => ({
      id: r.player_id, rank: i + 1, name: r.players?.name ?? "Unknown", position: r.players?.position ?? "", posRank: 0,
      team: r.players?.nfl_team ?? "", tier: r.tier, sub: r.note ?? "",
    }));
  } else {
    const { data, error } = await supabase
      .from("consensus_current")
      .select("player_id, consensus_rank, sources, tier, is_stale, position_in_list, players(name, position, nfl_team)")
      .match(combo).order("position_in_list").limit(1000)
      .returns<ConsensusRow[]>();
    if (error) loadError = error.message;
    stale = !!data?.length && data.every((r) => r.is_stale);
    rows = fixTiers(data ?? []).map((r) => ({
      id: r.player_id, rank: r.position_in_list, name: r.players?.name ?? "Unknown", position: r.players?.position ?? "", posRank: 0,
      team: r.players?.nfl_team ?? "", tier: r.tier, sub: `Avg rank ${r.consensus_rank} · ${r.sources} source${r.sources === 1 ? "" : "s"}`,
    }));
  }

  // Position rank across the whole list, then apply filters.
  const counts: Record<string, number> = {};
  rows.forEach((r) => { counts[r.position] = (counts[r.position] ?? 0) + 1; r.posRank = counts[r.position]; });
  const q = params.q.trim().toLowerCase();
  const shown = rows.filter((r) => (params.pos === "All" || r.position === params.pos) && (!q || r.name.toLowerCase().includes(q)));
  const lines = new Map(Object.entries(await seasonLines(params.scoring)).map(([k, v]) => [Number(k), v]));
  const showProj = params.proj !== "0";
  const settings = `${FORMATS.find((f) => f[0] === params.format)?.[1]} · ${SCORING.find((f) => f[0] === params.scoring)?.[1]} · ${QBS.find((f) => f[0] === params.qb)?.[1]}`;

  // Edit mode: your own list for the settings on screen.
  let editor: React.ReactNode = null;
  if (editing && user) {
    const { data: mine } = await supabase.from("ranking_sets").select("id, published").match({ ...combo, contributor_id: user.id }).maybeSingle();
    if (!mine) {
      editor = (
        <div className="gl-panel space-y-3 p-5">
          <p className="font-bold">You don&apos;t have a list for {settings} yet.</p>
          <form action={createList}>
            <input type="hidden" name="format" value={params.format} />
            <input type="hidden" name="scoring" value={params.scoring} />
            <input type="hidden" name="qb_type" value={params.qb} />
            <button className="gl-pill on">Create it</button>
          </form>
        </div>
      );
    } else {
      const { data: own } = await supabase
        .from("rankings").select("player_id, tier, note, needs_ranking, players(name, position, nfl_team)")
        .eq("set_id", mine.id).order("rank").limit(2000)
        .returns<{ player_id: number; tier: string | null; note: string | null; needs_ranking: boolean; players: Player | null }[]>();
      const items: Item[] = (own ?? []).map((r) => ({
        player_id: r.player_id, name: r.players?.name ?? "Unknown", position: r.players?.position ?? "", team: r.players?.nfl_team ?? "",
        tier: r.tier ?? "", note: r.note ?? "", placed: !r.needs_ranking,
      }));
      const lineMap: Record<number, Line> = {};
      lines.forEach((v, k) => { lineMap[k] = { proj: v.proj, played: v.played, snapPct: v.snapPct, posFinish: v.posFinish }; });
      const exit = new URLSearchParams({ format: params.format, scoring: params.scoring, qb: params.qb });
      editor = (
        <InlineEditor
          key={`${mine.id}`} setId={mine.id} initial={items} initialPublished={mine.published} lines={lineMap} settings={settings}
          exitHref={`/rankings?${exit}`} fullEditorHref={`/lists/${mine.id}`}
        />
      );
    }
  }

  // Only the first chunk is drawn, so the page stays light. "Show more" adds another hundred.
  const limit = Number(params.n);
  const visible = shown.slice(0, limit);

  // Consecutive players with the same tier share one box.
  const runs: { tier: string | null; rows: Row[] }[] = [];
  visible.forEach((r) => {
    const last = runs[runs.length - 1];
    if (last && last.tier === r.tier) last.rows.push(r); else runs.push({ tier: r.tier, rows: [r] });
  });

  const season = new Date().getFullYear();
  const num = (v: number | null | undefined, d = 1) => (v === null || v === undefined ? "–" : v.toFixed(d));

  return (
    <div className="space-y-5">
      <div className="gl-hero p-5 sm:p-7">
        <p className="text-[11px] font-semibold tracking-[0.35em] text-zinc-400">FANTASY FOOTBALL</p>
        <h2 id="h-rank" className="gl-title text-5xl sm:text-7xl">Rankings</h2>
        <p className="mt-2 text-base text-zinc-300">{editing ? "Editing your own list. Pick the settings on the right to switch which list you are editing." : "Expert player rankings, projections, and tiers."}</p>
        <div role="group" aria-label="Position filter" className="mt-5 flex flex-wrap gap-2">
          {!editing && POSITIONS.map((p) => <Link key={p} href={href(params, { pos: p })} className={`gl-pill !px-5 ${params.pos === p ? "on" : ""}`}>{p === "All" ? "Overall" : p === "DEF" ? "DST" : p}</Link>)}
          <span className="flex-1" />
          <span className="self-center text-xs text-zinc-400">{rows.length} players · {fresh.length} contributor{fresh.length === 1 ? "" : "s"} · {season}</span>
          {canEdit && !editing && (
            <form action={createList}>
              <input type="hidden" name="format" value={params.format} />
              <input type="hidden" name="scoring" value={params.scoring} />
              <input type="hidden" name="qb_type" value={params.qb} />
              <button className="gl-pill text-xs" title="Edit your own ranking for these settings">✎ Edit</button>
            </form>
          )}
        </div>
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-[1fr_20rem]">
        <div className="min-w-0 space-y-4">
          {editing ? editor : <>
          <p className="text-xs text-zinc-500">Showing {showing} · {settings}{q ? ` · matching "${params.q}"` : ""}</p>
          {stale && (
            <p className="rounded-xl border border-yellow-900 bg-yellow-950 p-3 text-sm text-yellow-300">
              No contributor has updated in over 7 days, so this is the last known consensus.
            </p>
          )}
          {loadError && <p className="rounded-xl border border-red-900 bg-red-950 p-3 text-sm text-red-300">Could not load rankings: {loadError}</p>}
          {!runs.length && !loadError && (
            <p className="text-zinc-400">
              {rows.length ? "No players match your filters." : "No rankings yet for this combination. Once a contributor publishes a list, it shows up here."}
            </p>
          )}
          <div className="space-y-5 overflow-x-auto pb-1">
            {runs.map((run, i) => {
              const c = run.tier ? TIER_COLORS[run.tier] : "#8b8576";
              return (
                <div key={i} className="gl-tierbox min-w-[40rem]">
                  <table className="gl-table dark">
                    <thead>
                      <tr>
                        <th scope="col" colSpan={2} className="!text-left">
                          <span className="flex items-center">
                            <span className="tier-chip" style={{ background: `linear-gradient(180deg, ${c}, ${c}cc)` }}>{run.tier ?? "–"}</span>
                            <span className="text-lg font-bold">{run.tier ? "TIER" : "UNSORTED"}</span>
                          </span>
                        </th>
                        <th scope="col">Pos</th>
                        {showProj && <th scope="col">Proj Pts</th>}
                        <th scope="col">Team</th>
                        <th scope="col">Played</th>
                        <th scope="col">SNAP%</th>
                        <th scope="col">POS Finish</th>
                      </tr>
                    </thead>
                    <tbody>
                      {run.rows.map((r) => {
                        const l = lines.get(r.id);
                        return (
                          <tr key={`${r.rank}-${r.name}`}>
                            <td className="w-10 font-semibold">{r.rank}</td>
                            <td className="!text-left">
                              <span className="flex items-center gap-3">
                                <Avatar id={r.id} name={r.name} size={44} />
                                <span>
                                  <PlayerLink id={r.id} name={r.name} />
                                  <span className="block max-w-[14rem] truncate text-xs text-zinc-400">{r.sub}</span>
                                </span>
                              </span>
                            </td>
                            <td><span className={`bd ${r.position}`}>{r.position} {r.posRank}</span></td>
                            {showProj && <td className="hl font-semibold">{num(l?.proj, 2)}</td>}
                            <td><TeamLogo team={r.team} /></td>
                            <td>{l?.played ?? "–"}</td>
                            <td className="hl font-semibold">{num(l?.snapPct, 2)}</td>
                            <td className="hl font-semibold">{l?.posFinish ?? "–"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              );
            })}
          </div>
          {shown.length > limit && (
            <Link href={href(params, { n: String(limit + 100) })} scroll={false} className="gl-pill block !py-3 text-center">
              Show {Math.min(100, shown.length - limit)} more ({shown.length - limit} left)
            </Link>
          )}
          </>}
        </div>

        <div className="space-y-5 lg:sticky lg:top-4">
          <div className="gl-panel space-y-5 p-5">
            <h3 className="text-2xl">⚙ Ranking Settings</h3>
            <div>
              <p className="mb-2 font-bold">League Type</p>
              <div className="gl-seg">
                {FORMATS.map(([v, label]) => <Link key={v} href={href(params, { format: v })} className={params.format === v ? "on" : ""}>{label}</Link>)}
              </div>
            </div>
            <div>
              <p className="mb-2 font-bold">QB Format</p>
              <div className="gl-seg">
                {QBS.map(([v, label]) => <Link key={v} href={href(params, { qb: v })} className={params.qb === v ? "on" : ""}>{v === "1qb" ? "Standard" : label}</Link>)}
              </div>
            </div>
            <div>
              <p className="mb-2 font-bold">Scoring</p>
              <div className="gl-seg">
                {SCORING.map(([v, label]) => <Link key={v} href={href(params, { scoring: v })} className={params.scoring === v ? "on" : ""}>{label}</Link>)}
              </div>
            </div>
            <Link href={href(params, { proj: showProj ? "0" : "1" })} className="flex items-center justify-between border-t border-zinc-800 pt-4 font-bold" role="switch" aria-checked={showProj}>
              Show Projections <span className={`gl-toggle ${showProj ? "on" : ""}`} aria-hidden="true" />
            </Link>
          </div>

          <div className="gl-panel p-5">
            <h3 className="mb-3 text-2xl">Expert Sources</h3>
            <div className="grid grid-cols-3 gap-2 text-center text-xs">
              <Link href={href(params, { ranker: "consensus" })} className={`rounded-xl p-2 ${!chosen ? "gl-src-on" : ""}`}>
                <span className="mx-auto mb-1 flex h-10 w-10 items-center justify-center rounded-full bg-zinc-700 text-sm font-bold">∑</span>
                Ball Knowers Consensus
              </Link>
              {sources.map((s) => {
                const name = s.contributors?.profiles?.display_name ?? "Contributor";
                const slug = s.contributors!.slug;
                const isStale = nowMs() - new Date(s.updated_at).getTime() >= 7 * DAY;
                return (
                  <Link key={s.id} href={href(params, { ranker: slug })} className={`rounded-xl p-2 ${chosen?.id === s.id ? "gl-src-on" : ""}`}>
                    <span className="mx-auto mb-1 flex h-10 w-10 items-center justify-center rounded-full bg-zinc-700 text-sm font-bold">{name.slice(0, 1).toUpperCase()}</span>
                    {name}
                    <span className={`block text-[10px] ${isStale ? "text-yellow-400" : "text-zinc-500"}`}>{isStale ? "stale" : ago(s.updated_at)}</span>
                  </Link>
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
