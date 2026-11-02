import Link from "next/link";
import { Avatar } from "@/app/avatar";
import { PlayerLink } from "@/app/player-link";
import { slotLabel } from "@/lib/lineup";
import { matchupGrade, ordinal, type Allowed, type GameRow } from "@/lib/matchup";

export type P = {
  id: number; name: string; pos: string; team: string | null; slot: string;
  rank: number | null; posRank: number | null; proj: number | null; ppg: number | null;
  next: GameRow | null; opp: string | null; allowed: Allowed | undefined;
};
type Filled = { slot: string; player: P | null };

const short = (n: string) => { const w = n.split(" "); return w.length > 1 ? `${w[0][0]}. ${w.slice(1).join(" ")}` : n; };
const PLATFORM_NOTE: Record<string, string> = {
  fleaflicker: "Fleaflicker doesn't share who's starting.",
  mfl: "MyFantasyLeague doesn't share who's starting.",
};

export function LineupBoard({
  platform, leagueId, source, isContributor, starters, current, extras, bench, recommended, startIds, swapFor, changes, curProj, recProj,
}: {
  platform: string; leagueId: number; source: "mine" | "consensus" | "proj"; isContributor: boolean;
  starters: P[]; current: Filled[]; extras: P[]; bench: P[]; recommended: Filled[]; startIds: Set<number>; swapFor: Map<number, P>;
  changes: number; curProj: number; recProj: number;
}) {
  const card = (p: P | null, slot: string, tag?: string) => (
    <div className="min-w-0 text-center">
      <p className="mb-1 rounded-t-lg bg-[#2f2e2b] py-0.5 text-xs font-bold tracking-wider text-[#fff]">{slotLabel(slot)}</p>
      <div className="gl-panel flex flex-col items-center gap-1 !rounded-t-none p-2">
        {p ? (
          <>
            <Avatar id={p.id} name={p.name} size={60} />
            <span className={`bd ${p.pos}`}>{p.pos} {p.posRank ?? "–"}</span>
            <PlayerLink id={p.id} name={short(p.name)} className="block w-full truncate text-xs" />
            {tag && <span className="text-[10px] text-zinc-400">{tag}</span>}
          </>
        ) : <span className="py-6 text-xs text-zinc-400">Empty</span>}
      </div>
    </div>
  );

  const srcLink = (v: string, label: string) => (
    <Link href={`/teams?league=${leagueId}&tab=lineup&src=${v}`} className={`gl-pill ${source === v ? "on" : ""}`}>{label}</Link>
  );

  return (
    <div className="space-y-5">

      <div className="gl-panel space-y-3 p-5">
        <h3 className="text-2xl">Current Lineup</h3>
        {starters.length ? (
          <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fill,minmax(6.4rem,1fr))" }}>
            {current.map((c, i) => <div key={i}>{card(c.player, c.slot)}</div>)}
            {extras.map((p) => <div key={p.id}>{card(p, "EXTRA")}</div>)}
          </div>
        ) : <p className="text-sm text-zinc-400">{PLATFORM_NOTE[platform] ?? "This league didn't tell us who is starting."} The best lineup below still works from your whole roster.</p>}
        {bench.length > 0 && (
          <>
            <p className="pt-2 text-sm font-bold">Bench</p>
            <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fill,minmax(6.4rem,1fr))" }}>{bench.map((p) => <div key={p.id}>{card(p, "BN")}</div>)}</div>
          </>
        )}
      </div>

      <div className="gl-panel space-y-4 p-5">
        <div className="flex flex-wrap items-center gap-3">
          <h3 className="mr-2 text-2xl">Best Lineup</h3>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-bold">Based on</span>
            {isContributor && srcLink("mine", "My rankings")}
            {srcLink("consensus", "Consensus")}
            {srcLink("proj", "Projections")}
          </div>
        </div>
        <p className="text-sm text-zinc-300">
          {starters.length
            ? changes ? <><b>{changes} change{changes === 1 ? "" : "s"}</b> from your current lineup. Projected {recProj.toFixed(1)} points vs {curProj.toFixed(1)} now.</> : <>Your lineup already matches the best one. Projected {curProj.toFixed(1)} points.</>
            : <>Projected {recProj.toFixed(1)} points.</>}
        </p>
        <div className="overflow-x-auto">
          <table className="gl-table min-w-[46rem]">
            <thead>
              <tr className="[&>th]:!text-zinc-400">
                <th scope="col" className="w-16">Slot</th><th scope="col" className="!text-left">Player</th><th scope="col" className="!text-left">Swap</th>
                <th scope="col">Matchup</th><th scope="col">Proj</th><th scope="col">PPG</th><th scope="col">Opp rank</th>
              </tr>
            </thead>
            <tbody>
              {recommended.map(({ slot, player: p }, i) => {
                if (!p) return <tr key={i}><td className="font-bold">{slotLabel(slot)}</td><td colSpan={6} className="!text-left text-zinc-400">No eligible player on your roster.</td></tr>;
                const isNew = starters.length > 0 && !startIds.has(p.id);
                const out = swapFor.get(p.id);
                const a = p.allowed;
                const g = matchupGrade(a);
                return (
                  <tr key={i} style={isNew ? { background: "#eaf5df" } : undefined}>
                    <td className="font-bold">{slotLabel(slot)}</td>
                    <td className="!text-left">
                      <span className="flex items-center gap-3">
                        <Avatar id={p.id} name={p.name} size={40} />
                        <span>
                          <PlayerLink id={p.id} name={p.name} />
                          <span className="mt-0.5 flex items-center gap-1.5"><span className={`bd ${p.pos}`}>{p.pos} {p.posRank ?? "–"}</span>{isNew && <span className="rounded-full px-2 text-[11px] font-bold text-[#fff]" style={{ background: "var(--accent)" }}>Start</span>}</span>
                        </span>
                      </span>
                    </td>
                    <td className="!text-left">
                      {out ? <span className="flex items-center gap-2 text-zinc-400"><span className="rounded-full bg-[#fde4e1] px-2 text-[11px] font-bold text-[#b42318]">Sit</span><Avatar id={out.id} name={out.name} size={28} /><span className="text-xs">{short(out.name)}</span></span> : <span className="text-zinc-500">–</span>}
                    </td>
                    <td className="font-semibold">{p.next && p.team ? `${p.next.home === p.team ? "vs" : "@"} ${p.opp}` : "–"}</td>
                    <td className="hl font-semibold">{p.proj === null ? "–" : p.proj.toFixed(1)}</td>
                    <td className="font-semibold">{p.ppg === null ? "–" : p.ppg.toFixed(1)}</td>
                    <td><span className="rounded-md px-2 py-1 text-xs font-bold" style={a ? { background: `${g.color}22`, color: g.color } : undefined}>{a ? ordinal(a.rank) : "–"}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-zinc-500">Opp rank is how much the defense gives up to that position (1st is the friendliest). Picks use {source === "proj" ? "this week's projections" : source === "mine" ? "your rankings" : "the consensus"}. Injuries and bye weeks aren&apos;t checked.</p>
      </div>
    </div>
  );
}
