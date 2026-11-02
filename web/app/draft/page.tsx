import { fixTiers } from "@/lib/tiers";
import { Avatar } from "@/app/avatar";
import { Suspense } from "react";
import { PlayerLink } from "@/app/player-link";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

type Row = {
  player_id: number; position_in_list: number; consensus_rank: number; sources: number; tier: string | null; is_stale: boolean;
  players: { name: string; position: string; nfl_team: string | null } | null;
};

const TIER_COLORS: Record<string, string> = {
  S: "#D4AF37", A: "#22A722", B: "#9333EA", C: "#3B82F6", D: "#FACC15", E: "#F97316", F: "#EF4444",
};
const SOURCE_LINKS: Record<string, string> = {
  MyFantasyLeague: "https://www.myfantasyleague.com",
  "Fantasy Football Calculator": "https://fantasyfootballcalculator.com",
};
const TABS = [["rankings", "Rankings"], ["adp", "ADP"], ["mock", "Mock Draft"]] as const;
const FORMATS = [["redraft", "Standard"], ["dynasty", "Dynasty"]] as const;
const SCORING = [["ppr", "PPR"], ["half", "Half PPR"], ["std", "Standard"]] as const;
const QBS = [["1qb", "1 QB"], ["superflex", "Superflex"]] as const;
const SLOT_FIELDS = ["QB", "RB", "WR", "TE", "FLEX", "SUPERFLEX", "K", "DEF"] as const;
const SLOT_DEFAULTS: Record<string, number> = { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, SUPERFLEX: 0, K: 1, DEF: 1 };

type AdpRow = {
  player_id: number; adp: number; high: number | null; low: number | null; times_drafted: number | null;
  season: number; source: string; as_of: string | null; teams: number;
  players: { name: string; position: string; nfl_team: string | null } | null;
};

type Params = { tab: string; format: string; scoring: string; qb: string };

// 3.8 in a 12-team draft is pick 4 of round 1, written 1.04.
function pickLabel(adp: number, teams: number) {
  const round = Math.max(1, Math.ceil(adp / teams));
  const pick = Math.min(teams, Math.max(1, Math.round(adp - (round - 1) * teams)));
  return `${round}.${String(pick).padStart(2, "0")}`;
}

function href(current: Params, over: Partial<Params>) {
  const next = { ...current, ...over };
  const defaults: Params = { tab: "rankings", format: "redraft", scoring: "ppr", qb: "1qb" };
  const qs = new URLSearchParams();
  (Object.keys(next) as (keyof Params)[]).forEach((k) => { if (next[k] !== defaults[k]) qs.set(k, next[k]); });
  const s = qs.toString();
  return s ? `/draft?${s}` : "/draft";
}

const field = "w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm";

async function DraftView({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const pick = (k: string, ok: readonly string[], d: string) => { const v = sp[k]; return typeof v === "string" && ok.includes(v) ? v : d; };
  const params: Params = {
    tab: pick("tab", TABS.map((t) => t[0]), "rankings"),
    format: pick("format", FORMATS.map((t) => t[0]), "redraft"),
    scoring: pick("scoring", SCORING.map((t) => t[0]), "ppr"),
    qb: pick("qb", QBS.map((t) => t[0]), "1qb"),
  };

  let rows: Row[] = [];
  let error = "";
  if (params.tab === "rankings") {
    const supabase = await createClient();
    const res = await supabase
      .from("consensus_current")
      .select("player_id, position_in_list, consensus_rank, sources, tier, is_stale, players(name, position, nfl_team)")
      .match({ format: params.format, scoring: params.scoring, qb_type: params.qb })
      .order("position_in_list").limit(30)
      .returns<Row[]>();
    rows = fixTiers(res.data ?? []);
    error = res.error?.message ?? "";
  }
  let adpRows: AdpRow[] = [];
  const consensusRank = new Map<number, number>();
  let adpError = "";
  if (params.tab === "adp") {
    const supabase = await createClient();
    const combo = { format: params.format, scoring: params.scoring, qb_type: params.qb };
    const { data: latest } = await supabase.from("adp").select("season, source").match(combo).order("season", { ascending: false }).limit(1);
    if (latest?.length) {
      const res = await supabase
        .from("adp")
        .select("player_id, adp, high, low, times_drafted, season, source, as_of, teams, players(name, position, nfl_team)")
        .match(combo).eq("season", latest[0].season).eq("source", latest[0].source).order("adp").limit(150)
        .returns<AdpRow[]>();
      adpRows = res.data ?? [];
      adpError = res.error?.message ?? "";
    }
    const { data: cons } = await supabase
      .from("consensus_current").select("player_id, position_in_list").match(combo).limit(1000)
      .returns<{ player_id: number; position_in_list: number }[]>();
    (cons ?? []).forEach((c) => consensusRank.set(c.player_id, c.position_in_list));
  }
  const stale = rows.length > 0 && rows.every((r) => r.is_stale);
  const pill = (on: boolean) => `gl-pill !rounded-full text-xs ${on ? "on-o" : ""}`;

  return (
    <div className="space-y-4">
      <div className="gl-hero flex min-h-[8rem] items-center gap-4 p-5 sm:p-6">
        <span className="hidden h-20 w-16 items-center justify-center rounded-lg text-4xl sm:flex" style={{ border: "3px solid #1b8a35", color: "var(--accent)" }} aria-hidden="true">☑</span>
        <div>
          <h2 id="h-draft" className="gl-title text-4xl sm:text-6xl">Draft <span style={{ color: "var(--accent)" }}>Guide</span></h2>
          <p className="mt-2 text-sm text-zinc-200">Rankings, ADP, and draft tools to help you build a championship roster.</p>
        </div>
      </div>

      <div role="tablist" aria-label="Draft sections" className="flex flex-wrap gap-3">
        {TABS.map(([v, label]) => (
          <Link key={v} role="tab" aria-selected={params.tab === v} href={href(params, { tab: v })} className={`gl-pill !rounded-xl !px-8 !py-2.5 ${params.tab === v ? "on-o" : ""}`}>{label}</Link>
        ))}
      </div>

      {params.tab === "rankings" && (
        <div className="grid items-start gap-4 lg:grid-cols-[1fr_0.8fr]">
          <div className="gl-panel min-w-0 p-4">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-xl font-bold"><span style={{ color: "var(--accent)" }} aria-hidden="true">▮</span> Draft Rankings</h3>
              <span className="text-xs text-zinc-400">Ball Knowers Consensus</span>
            </div>
            {error && <p className="rounded border border-red-900 bg-red-950/30 p-3 text-sm text-red-300">Could not load rankings: {error}</p>}
            {stale && <p className="mb-2 rounded border border-yellow-900 bg-yellow-950/30 p-2 text-xs text-yellow-300">No contributor has updated in over 7 days. Showing the last known consensus.</p>}
            {rows.length ? (
              <table className="gl-table !text-xs">
                <thead><tr><th scope="col" className="w-8">#</th><th scope="col" className="!text-left">PLAYER</th><th scope="col">POS</th><th scope="col">TEAM</th><th scope="col">TIER</th><th scope="col">AVG RANK</th></tr></thead>
                <tbody>
                  {rows.map((r) => {
                    const c = r.tier ? TIER_COLORS[r.tier] : undefined;
                    return (
                      <tr key={r.position_in_list}>
                        <td className="text-sm font-bold">{r.position_in_list}</td>
                        <td className="!text-left"><span className="flex items-center gap-1.5"><Avatar id={r.player_id} name={r.players?.name} size={24} /><PlayerLink id={r.player_id} name={r.players?.name} className="text-xs" /></span></td>
                        <td><span className={`bd ${r.players?.position}`}>{r.players?.position}</span></td>
                        <td>{r.players?.nfl_team}</td>
                        <td>{r.tier ? <span className="inline-block rounded-full border px-2 text-[11px]" style={{ color: c, borderColor: c }}>{r.tier}</span> : ""}</td>
                        <td>{r.consensus_rank}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : !error && <p className="text-sm text-zinc-400">No published rankings yet for these settings.</p>}
            {rows.length > 0 && <p className="mt-2 text-xs text-zinc-500">Top 30. <Link href="/rankings" className="underline">See the full rankings</Link></p>}
          </div>

          <div className="gl-panel space-y-4 p-4">
            <h3 className="text-xl font-bold"><span style={{ color: "var(--accent)" }} aria-hidden="true">⚙</span> Draft Settings</h3>
            <div>
              <p className="mb-1 text-sm">League Format</p>
              <div className="flex flex-wrap gap-2">{FORMATS.map(([v, l]) => <Link key={v} href={href(params, { format: v })} className={pill(params.format === v)}>{l}</Link>)}</div>
            </div>
            <div>
              <p className="mb-1 text-sm">Scoring Format</p>
              <div className="flex flex-wrap gap-2">{SCORING.map(([v, l]) => <Link key={v} href={href(params, { scoring: v })} className={pill(params.scoring === v)}>{l}</Link>)}</div>
            </div>
            <div>
              <p className="mb-1 text-sm">Quarterback Format</p>
              <div className="flex flex-wrap gap-2">{QBS.map(([v, l]) => <Link key={v} href={href(params, { qb: v })} className={pill(params.qb === v)}>{l}</Link>)}</div>
            </div>
            <p className="text-xs text-zinc-500">Roster, league size and draft position are set on the Mock Draft tab.</p>
          </div>
        </div>
      )}

      {params.tab === "adp" && (
        <div className="grid items-start gap-4 lg:grid-cols-[1fr_0.5fr]">
          <div className="gl-panel min-w-0 p-4">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-xl font-bold"><span style={{ color: "var(--accent)" }} aria-hidden="true">▮</span> Average Draft Position (ADP)</h3>
              {adpRows.length > 0 && (
                <p className="text-xs text-zinc-300">
                  {adpRows[0].season} preseason · {adpRows[0].teams}-team drafts · Source:{" "}
                  <a href={SOURCE_LINKS[adpRows[0].source] ?? "#"} className="underline" target="_blank" rel="noreferrer">{adpRows[0].source}</a>
                </p>
              )}
            </div>
            {adpError && <p className="rounded border border-red-900 bg-red-950/30 p-3 text-sm text-red-300">Could not load ADP: {adpError}</p>}
            {adpRows.length ? (
              <div className="overflow-x-auto">
                <table className="gl-table min-w-[34rem]">
                  <thead>
                    <tr>
                      <th scope="col" className="w-8">#</th><th scope="col" className="!text-left">PLAYER</th><th scope="col">POS</th><th scope="col">TEAM</th>
                      <th scope="col">ADP</th><th scope="col">HIGH-LOW</th><th scope="col">DRAFTED</th><th scope="col">OUR RANK</th><th scope="col">VALUE</th>
                    </tr>
                  </thead>
                  <tbody>
                    {adpRows.map((r, i) => {
                      const ours = consensusRank.get(r.player_id);
                      const diff = ours === undefined ? null : i + 1 - ours; // positive: we rank him higher than the market
                      return (
                        <tr key={r.player_id}>
                          <td className="text-sm font-bold">{i + 1}</td>
                          <td className="!text-left"><span className="flex items-center gap-2"><Avatar id={r.player_id} name={r.players?.name} size={32} /><PlayerLink id={r.player_id} name={r.players?.name} /></span></td>
                          <td><span className={`bd ${r.players?.position}`}>{r.players?.position}</span></td>
                          <td>{r.players?.nfl_team}</td>
                          <td><span className="inline-block rounded-full border px-3 py-0.5 text-xs font-semibold" style={{ background: "#e4f0d8", color: "#1b6e2c", borderColor: "#1b8a35" }}>{pickLabel(r.adp, r.teams)}</span></td>
                          <td>{r.high ?? "–"}-{r.low ?? "–"}</td>
                          <td>{r.times_drafted ?? "–"}</td>
                          <td>{ours === undefined ? <span className="text-zinc-500">–</span> : `#${ours}`}</td>
                          <td className="font-semibold" style={{ color: diff === null || diff === 0 ? undefined : diff > 0 ? "var(--accent)" : "#ef4444" }}>
                            {diff === null ? "–" : diff === 0 ? "even" : `${diff > 0 ? "▲" : "▼"} ${Math.abs(diff)}`}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : !adpError && (
              <p className="text-sm text-zinc-400">
                No ADP is loaded for these settings. ADP exists for Standard, PPR and Half PPR 1 QB redraft, PPR Superflex redraft, and PPR 1 QB Dynasty.
              </p>
            )}
            {adpRows.length > 0 && (
              <p className="mt-3 text-xs text-zinc-500">
                Top 150 by ADP. <strong>Value</strong> compares ADP order with the Ball Knowers Consensus: green means our contributors rank him higher than the market does,
                red means lower. ADP comes from public draft data and is refreshed by loading a new season.
              </p>
            )}
          </div>

          <div className="gl-panel space-y-4 p-4">
            <h3 className="text-xl font-bold"><span style={{ color: "var(--accent)" }} aria-hidden="true">⚙</span> Settings</h3>
            <div>
              <p className="mb-1 text-sm">League Format</p>
              <div className="flex flex-wrap gap-2">{FORMATS.map(([v, l]) => <Link key={v} href={href(params, { format: v })} className={pill(params.format === v)}>{l}</Link>)}</div>
            </div>
            <div>
              <p className="mb-1 text-sm">Scoring Format</p>
              <div className="flex flex-wrap gap-2">{SCORING.map(([v, l]) => <Link key={v} href={href(params, { scoring: v })} className={pill(params.scoring === v)}>{l}</Link>)}</div>
            </div>
            <div>
              <p className="mb-1 text-sm">Quarterback Format</p>
              <div className="flex flex-wrap gap-2">{QBS.map(([v, l]) => <Link key={v} href={href(params, { qb: v })} className={pill(params.qb === v)}>{l}</Link>)}</div>
            </div>
          </div>
        </div>
      )}

      {params.tab === "mock" && (
        <form action="/draft/mock" className="grid items-start gap-4 lg:grid-cols-[1fr_0.8fr]">
          <div className="gl-panel space-y-4 p-4">
            <h3 className="text-xl font-bold"><span style={{ color: "var(--accent)" }} aria-hidden="true">⚙</span> League Settings</h3>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="text-sm">League Format
                <select name="format" defaultValue={params.format} className={field}>{FORMATS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
              </label>
              <label className="text-sm">Scoring Format
                <select name="scoring" defaultValue={params.scoring} className={field}>{SCORING.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
              </label>
              <label className="text-sm">Quarterback Format
                <select name="qb" defaultValue={params.qb} className={field}>{QBS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
              </label>
              <label className="text-sm">League Size
                <select name="size" defaultValue="12" className={field}>{[8, 10, 12, 14, 16].map((n) => <option key={n} value={n}>{n} Teams</option>)}</select>
              </label>
              <label className="text-sm">Your Draft Position
                <select name="slot" defaultValue="5" className={field}>{Array.from({ length: 16 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>Pick {n}</option>)}</select>
              </label>
              <label className="text-sm">Bench Spots
                <input name="bench" type="number" min={0} max={15} defaultValue={6} className={field} />
              </label>
            </div>
            <div className="rounded-xl border border-zinc-700 p-3">
              <p className="mb-2 text-sm">Position Settings</p>
              <div className="grid grid-cols-4 gap-2 sm:grid-cols-8">
                {SLOT_FIELDS.map((k) => (
                  <label key={k} className="text-center text-[11px] font-semibold">{k}
                    <input name={k} type="number" min={0} max={9} defaultValue={k === "SUPERFLEX" && params.qb === "superflex" ? 1 : SLOT_DEFAULTS[k]} className="mt-1 w-full rounded-lg border border-zinc-700 bg-black py-2 text-center text-base font-bold" />
                  </label>
                ))}
              </div>
            </div>
            <p className="text-xs text-zinc-500">A draft needs enough ranked players: teams × rounds. Rounds equal starters plus bench.</p>
          </div>
          <div className="gl-panel space-y-3 p-4" style={{ borderColor: "#7fbf8a" }}>
            <h3 className="text-lg font-bold"><span style={{ color: "var(--accent)" }} aria-hidden="true">▷</span> Mock Draft</h3>
            <p className="text-sm text-zinc-300">Draft against computer teams that pick from the Ball Knowers Consensus. It&apos;s a snake draft, and nothing is saved.</p>
            <button className="rounded-full px-5 py-2 text-sm font-bold" style={{ background: "#2f2e2b", color: "#fff" }}>Start Mock Draft →</button>
          </div>
        </form>
      )}
    </div>
  );
}

export default function DraftPage(props: PageProps<"/draft">) {
  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-5 md:px-10 md:py-8">
      <Suspense fallback={<p className="text-zinc-400">Loading...</p>}>
        <DraftView searchParams={props.searchParams} />
      </Suspense>
    </main>
  );
}
