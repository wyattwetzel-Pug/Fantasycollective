import { Suspense } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { postCall } from "./actions";
import { Picker, type PickerPlayer } from "./picker";

type Row = {
  player_id: number; position_in_list: number; consensus_rank: number; sources: number; tier: string | null;
  players: { name: string; position: string; nfl_team: string | null } | null;
};
type SetRow = { id: number; contributors: { profiles: { display_name: string } | null } | null };
type RankRow = { set_id: number; player_id: number; rank: number };
type CallRow = {
  id: number; week: number; season: number; player_a: number; player_b: number; pick: number; reason: string | null;
  created_at: string; contributors: { profiles: { display_name: string } | null } | null;
};

const FORMATS = [["redraft", "Redraft"], ["dynasty", "Dynasty"]] as const;
const SCORING = [["ppr", "PPR"], ["half", "Half PPR"], ["std", "Standard"]] as const;
const QBS = [["1qb", "1 QB"], ["superflex", "Superflex"]] as const;
const TIER_COLORS: Record<string, string> = {
  S: "#D4AF37", A: "#22A722", B: "#9333EA", C: "#3B82F6", D: "#FACC15", E: "#F97316", F: "#EF4444",
};

type Params = { format: string; scoring: string; qb: string };

function href(current: Params, over: Partial<Params>, p: number[]) {
  const next = { ...current, ...over };
  const qs = new URLSearchParams({ format: next.format, scoring: next.scoring, qb: next.qb });
  if (p.length) qs.set("p", p.join(","));
  return `/startsit?${qs}`;
}

async function StartSitView({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const pick = (k: string, ok: readonly string[], d: string) => { const v = sp[k]; return typeof v === "string" && ok.includes(v) ? v : d; };
  const params: Params = {
    format: pick("format", FORMATS.map((t) => t[0]), "redraft"),
    scoring: pick("scoring", SCORING.map((t) => t[0]), "ppr"),
    qb: pick("qb", QBS.map((t) => t[0]), "1qb"),
  };
  const ids = (typeof sp.p === "string" ? sp.p.split(",") : []).map(Number).filter((n) => Number.isInteger(n) && n > 0).slice(0, 4);

  const supabase = await createClient();
  const combo = { format: params.format, scoring: params.scoring, qb_type: params.qb };

  const { data: { user } } = await supabase.auth.getUser();
  const { data: me } = user ? await supabase.from("profiles").select("role").eq("id", user.id).single() : { data: null };

  const { data: all, error } = await supabase
    .from("consensus_current")
    .select("player_id, position_in_list, consensus_rank, sources, tier, players(name, position, nfl_team)")
    .match(combo).order("position_in_list").limit(1000)
    .returns<Row[]>();

  const rows = all ?? [];
  const posCount: Record<string, number> = {};
  const posRank = new Map<number, number>();
  rows.forEach((r) => { const k = r.players?.position ?? ""; posCount[k] = (posCount[k] ?? 0) + 1; posRank.set(r.player_id, posCount[k]); });
  const list: PickerPlayer[] = rows.map((r) => ({ id: r.player_id, name: r.players?.name ?? "Unknown", position: r.players?.position ?? "", team: r.players?.nfl_team ?? "", rank: r.position_in_list }));
  const chosen = ids.map((id) => rows.find((r) => r.player_id === id)).filter((r): r is Row => !!r);
  const chosenIds = chosen.map((r) => r.player_id);

  // Each contributor's own rank for the chosen players.
  const contribRanks: { name: string; ranks: Map<number, number> }[] = [];
  let calls: CallRow[] = [];
  if (chosenIds.length) {
    const { data: sets } = await supabase
      .from("ranking_sets")
      .select("id, contributors(profiles!contributors_profile_id_fkey(display_name))")
      .match(combo).eq("published", true)
      .returns<SetRow[]>();
    const setIds = (sets ?? []).map((s) => s.id);
    if (setIds.length) {
      const { data: rk } = await supabase
        .from("rankings").select("set_id, player_id, rank")
        .in("set_id", setIds).in("player_id", chosenIds).eq("needs_ranking", false)
        .returns<RankRow[]>();
      (sets ?? []).forEach((s) => {
        const m = new Map<number, number>();
        (rk ?? []).filter((r) => r.set_id === s.id).forEach((r) => m.set(r.player_id, r.rank));
        if (m.size) contribRanks.push({ name: s.contributors?.profiles?.display_name ?? "Contributor", ranks: m });
      });
    }
    const { data: cs } = await supabase
      .from("start_sit_calls")
      .select("id, week, season, player_a, player_b, pick, reason, created_at, contributors(profiles!contributors_profile_id_fkey(display_name))")
      .or(chosenIds.map((id) => `player_a.eq.${id},player_b.eq.${id}`).join(","))
      .order("created_at", { ascending: false }).limit(20)
      .returns<CallRow[]>();
    calls = cs ?? [];
  }

  const nameOf = (id: number) => list.find((p) => p.id === id)?.name ?? "Unknown";
  const best = chosen.length >= 2 ? [...chosen].sort((a, b) => a.position_in_list - b.position_in_list) : [];
  const gap = best.length >= 2 ? best[1].position_in_list - best[0].position_in_list : 0;
  const closeCall = best.length >= 2 && gap <= 3;
  const lowest = (vals: (number | undefined)[]) => Math.min(...vals.filter((v): v is number => v !== undefined));
  const cell = (key: number, v: number | undefined, lo: number, text?: string) => (
    <td key={key} className="px-2 py-2 text-center" style={v !== undefined && v === lo && chosen.length > 1 ? { color: "#7dff6a", fontWeight: 700 } : undefined}>{v === undefined ? "–" : text ?? v}</td>
  );
  const pill = (on: boolean) => `gl-pill !rounded-full text-xs ${on ? "on-o" : ""}`;
  const pair = chosen.length === 2 ? chosen : null;

  const comparison = chosen.length >= 2 ? (
    <div className="overflow-x-auto rounded-xl border border-zinc-800 p-2">
      <table className="w-full text-sm">
        <thead>
          <tr>
            <th className="w-40 px-2 py-2 text-left text-xs text-zinc-400" />
            {chosen.map((r) => (
              <th key={r.player_id} className="px-2 py-2 text-center">
                <span className="pn block">{r.players?.name}</span>
                <span className="text-xs font-normal text-zinc-400">{r.players?.position} - {r.players?.nfl_team}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {[
            ["Consensus rank", chosen.map((r) => r.position_in_list), (v: number) => `#${v}`],
            ["Position rank", chosen.map((r) => posRank.get(r.player_id)), (v: number) => `${v}`],
            ["Avg rank", chosen.map((r) => Number(r.consensus_rank)), (v: number) => `${v}`],
          ].map(([label, vals, f]) => {
            const v = vals as (number | undefined)[]; const lo = lowest(v);
            return (
              <tr key={label as string} className="border-t border-zinc-800">
                <td className="px-2 py-2 text-xs text-zinc-400">{label as string}</td>
                {v.map((x, i) => cell(i, x, lo, x === undefined ? undefined : (f as (n: number) => string)(x)))}
              </tr>
            );
          })}
          <tr className="border-t border-zinc-800">
            <td className="px-2 py-2 text-xs text-zinc-400">Tier</td>
            {chosen.map((r) => (
              <td key={r.player_id} className="px-2 py-2 text-center">
                {r.tier ? <span className="inline-block rounded-full border px-3 text-xs" style={{ color: TIER_COLORS[r.tier], borderColor: TIER_COLORS[r.tier] }}>{r.tier}</span> : "–"}
              </td>
            ))}
          </tr>
          <tr className="border-t border-zinc-800">
            <td className="px-2 py-2 text-xs text-zinc-400">Sources</td>
            {chosen.map((r) => <td key={r.player_id} className="px-2 py-2 text-center">{r.sources}</td>)}
          </tr>
          {contribRanks.map((c) => {
            const v = chosen.map((r) => c.ranks.get(r.player_id)); const lo = lowest(v);
            return (
              <tr key={c.name} className="border-t border-zinc-800">
                <td className="px-2 py-2 text-xs text-zinc-400">{c.name}&apos;s rank</td>
                {v.map((x, i) => cell(i, x, lo, x === undefined ? undefined : `#${x}`))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  ) : (
    <p className="text-sm text-zinc-400">Add at least two players to compare them.</p>
  );

  return (
    <div className="space-y-4">
      <div className="gl-hero grid items-center gap-4 p-6 sm:p-8">
        <div>
          <h2 id="h-ss" className="gl-title text-4xl sm:text-5xl">START <span style={{ color: "#39ff14" }}>/</span> SIT CALCULATOR</h2>
          <p className="mt-3 text-sm italic tracking-[0.3em] text-zinc-300">COMPARE PLAYERS. GET A CLEAR ANSWER.</p>
        </div>
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-[1fr_21rem]">
        <div className="min-w-0 space-y-4">
          <div className="gl-panel space-y-4 p-4">
            <div className="flex items-center gap-3">
              <span className="text-2xl" style={{ color: "#39ff14" }} aria-hidden="true">⇄</span>
              <div>
                <h3 className="text-lg font-bold">Compare Players</h3>
                <p className="text-xs text-zinc-400">Add 2-4 players to see who you should start.</p>
              </div>
            </div>
            {error ? <p className="text-sm text-red-300">Could not load players: {error.message}</p>
              : list.length ? <Picker players={list} selected={chosenIds} base={{ format: params.format, scoring: params.scoring, qb: params.qb }} />
              : <p className="text-sm text-zinc-400">No published rankings yet for these settings, so there is nobody to compare.</p>}
          </div>

          <div className="gl-panel space-y-3 p-4">
            <h3 className="text-lg font-bold"><span style={{ color: "#39ff14" }} aria-hidden="true">▮</span> Comparison</h3>
            {comparison}
          </div>

          <div className="gl-panel space-y-3 p-4">
            <h3 className="text-lg font-bold">Contributor calls</h3>
            {calls.length ? (
              <ul className="space-y-2">
                {calls.map((c) => (
                  <li key={c.id} className="gl-row !items-start">
                    <span className="flex-1 text-sm">
                      <span className="pn">{c.contributors?.profiles?.display_name ?? "Contributor"}</span> starts <span className="pn" style={{ color: "#7dff6a" }}>{nameOf(c.pick)}</span> over {nameOf(c.pick === c.player_a ? c.player_b : c.player_a)}
                      <span className="block text-xs text-zinc-500">Week {c.week}, {c.season}</span>
                      {c.reason && <span className="mt-1 block text-zinc-300">{c.reason}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-zinc-400">No contributor has weighed in on {chosen.length ? "these players" : "a matchup"} yet.</p>}

            {me?.role === "contributor" && pair && (
              <form action={postCall} className="space-y-3 border-t border-zinc-800 pt-3">
                <p className="text-sm font-semibold">Post your call</p>
                <input type="hidden" name="player_a" value={pair[0].player_id} />
                <input type="hidden" name="player_b" value={pair[1].player_id} />
                <input type="hidden" name="season" value={new Date().getFullYear()} />
                <div className="flex flex-wrap gap-4 text-sm">
                  {pair.map((r, i) => (
                    <label key={r.player_id} className="flex items-center gap-2">
                      <input type="radio" name="pick" value={r.player_id} defaultChecked={i === 0} />Start {r.players?.name}
                    </label>
                  ))}
                  <label className="flex items-center gap-2">Week <input name="week" type="number" min={1} max={22} defaultValue={1} className="w-16 rounded border border-zinc-700 bg-black px-2 py-1" /></label>
                </div>
                <textarea name="reason" rows={2} placeholder="Why? (optional)" className="w-full rounded border border-zinc-700 bg-black px-3 py-2 text-sm" />
                <button className="rounded bg-green-500 px-4 py-2 text-sm font-semibold text-black">Post call</button>
              </form>
            )}
            {me?.role === "contributor" && chosen.length >= 3 && <p className="text-xs text-zinc-500">Calls compare exactly two players. Remove down to two to post one.</p>}
          </div>
        </div>

        <div className="space-y-4">
          <div className="gl-panel space-y-2 p-4" style={{ borderColor: "#39ff14" }}>
            <h3 className="font-bold">Recommendation</h3>
            {best.length >= 2 ? (
              <>
                <p className="text-2xl font-extrabold italic" style={{ color: "#7dff6a" }}>START {best[0].players?.name}</p>
                <p className="text-sm text-zinc-300">
                  Ranked #{best[0].position_in_list} overall ({best[0].players?.position} {posRank.get(best[0].player_id)}),
                  {" "}ahead of {best.slice(1).map((r) => `${r.players?.name} (#${r.position_in_list})`).join(", ")}.
                </p>
                {closeCall && <p className="text-xs text-yellow-400">It&apos;s a close call: only {gap} spot{gap === 1 ? "" : "s"} apart. Check the matchup and injury news.</p>}
              </>
            ) : <p className="text-sm text-zinc-400">Pick two or more players for a recommendation.</p>}
            <p className="text-xs text-zinc-500">Based on the Ball Knowers Consensus. It does not know about matchups or injuries yet.</p>
          </div>

          <div className="gl-panel space-y-3 p-4">
            <h3 className="font-bold"><span style={{ color: "#39ff14" }} aria-hidden="true">⚙</span> League Settings</h3>
            <div>
              <p className="mb-1 text-sm">League Type</p>
              <div className="grid grid-cols-2 gap-2">{FORMATS.map(([v, l]) => <Link key={v} href={href(params, { format: v }, chosenIds)} className={`${pill(params.format === v)} text-center`}>{l}</Link>)}</div>
            </div>
            <div>
              <p className="mb-1 text-sm">Scoring Format</p>
              <div className="grid grid-cols-3 gap-2">{SCORING.map(([v, l]) => <Link key={v} href={href(params, { scoring: v }, chosenIds)} className={`${pill(params.scoring === v)} !px-2 text-center`}>{l}</Link>)}</div>
            </div>
            <div>
              <p className="mb-1 text-sm">Starting Lineup</p>
              <div className="grid grid-cols-2 gap-2">{QBS.map(([v, l]) => <Link key={v} href={href(params, { qb: v }, chosenIds)} className={`${pill(params.qb === v)} text-center`}>{l}</Link>)}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function StartSitPage(props: PageProps<"/startsit">) {
  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-5 md:px-10 md:py-8">
      <Suspense fallback={<p className="text-zinc-400">Loading...</p>}>
        <StartSitView searchParams={props.searchParams} />
      </Suspense>
    </main>
  );
}
