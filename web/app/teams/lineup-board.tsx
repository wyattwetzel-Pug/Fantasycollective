import Link from "next/link";
import { Avatar } from "@/app/avatar";
import { PlayerLink } from "@/app/player-link";
import { slotLabel } from "@/lib/lineup";
import { matchupGrade, ordinal, type Allowed, type GameRow } from "@/lib/matchup";

export type P = {
  id: number; name: string; pos: string; team: string | null; slot: string;
  rank: number | null; posRank: number | null; proj: number | null; ppg: number | null;
  next: GameRow | null; opp: string | null; unavailable?: boolean; allowed: Allowed | undefined;
};
type Filled = { slot: string; player: P | null };

const short = (n: string) => { const w = n.split(" "); return w.length > 1 ? `${w[0][0]}. ${w.slice(1).join(" ")}` : n; };
const PLATFORM_NOTE: Record<string, string> = {
  fleaflicker: "Fleaflicker doesn't share who's starting.",
  mfl: "MyFantasyLeague doesn't share who's starting.",
};

export function LineupBoard({
  platform, leagueId, source, starters, recommended, benchBest, startIds, swapFor, changes, curProj, recProj, recPpg,
}: {
  platform: string; leagueId: number; source: "mine" | "consensus" | "proj";
  starters: P[]; recommended: Filled[]; benchBest: P[]; startIds: Set<number>; swapFor: Map<number, P>;
  changes: number; curProj: number; recProj: number; recPpg: number;
}) {
  const row = (p: P, label: string, key: string, isNew: boolean, swap: React.ReactNode) => {
    const a = p.allowed;
    const g = matchupGrade(a);
    return (
      <tr key={key} style={isNew ? { background: "#E3EAD9" } : undefined}>
        <td className="font-bold">{label}</td>
        <td className="!text-left">
          <span className="flex items-center gap-3">
            <Avatar id={p.id} name={p.name} size={40} />
            <span>
              <PlayerLink id={p.id} name={p.name} />
              <span className="mt-0.5 flex items-center gap-1.5"><span className={`bd ${p.pos}`}>{p.pos} {p.posRank ?? "–"}</span>{isNew && <span className="rounded-full px-2 text-[11px] font-bold text-[#fff]" style={{ background: "var(--accent)" }}>Start</span>}</span>
            </span>
          </span>
        </td>
        <td className="!text-left">{swap}</td>
        <td className="font-semibold">{p.next && p.team ? `${p.next.home === p.team ? "vs" : "@"} ${p.opp}` : p.team ? "Bye / none" : "–"}</td>
        <td className="hl font-semibold">{p.proj === null ? "–" : p.proj.toFixed(1)}</td>
        <td className="font-semibold">{p.ppg === null ? "–" : p.ppg.toFixed(1)}</td>
        <td><span className="rounded-md px-2 py-1 text-xs font-bold" style={a ? { background: `${g.color}22`, color: g.color } : undefined}>{a ? ordinal(a.rank) : "–"}</span></td>
      </tr>
    );
  };

  return (
    <div className="space-y-5">

      <div className="gl-panel space-y-4 p-5">
        <div className="flex flex-wrap items-center gap-3">
          <h3 className="mr-2 text-2xl">Best Lineup</h3>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-bold">Based on</span>
            <Link href={`/teams?league=${leagueId}&tab=lineup&src=consensus`} title="Ball Knowers Consensus" aria-label="Ball Knowers Consensus" aria-current={source === "consensus" ? "true" : undefined}
              className="rounded-full" style={{ boxShadow: source === "consensus" ? "0 0 0 3px var(--accent)" : "none" }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/consensus-logo.png" alt="Ball Knowers Consensus" width={40} height={40} className="h-10 w-10 rounded-full" />
            </Link>
          </div>
        </div>
        <p className="text-sm text-zinc-300">
          {starters.length
            ? changes ? <><b>{changes} change{changes === 1 ? "" : "s"}</b> from your current lineup. Projected {recProj.toFixed(1)} points vs {curProj.toFixed(1)} now.</> : <>Your lineup already matches the best one. Projected {curProj.toFixed(1)} points.</>
            : <>{PLATFORM_NOTE[platform] ?? "This league didn't tell us who is starting."} Projected {recProj.toFixed(1)} points from your whole roster.</>}
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
                return row(p, slotLabel(slot), `s${i}`, isNew, isNew ? (
                  swapFor.get(p.id) ? <span className="flex items-center gap-2 text-zinc-400"><span className="rounded-full bg-[#fde4e1] px-2 text-[11px] font-bold text-[#b42318]">Sit</span><Avatar id={swapFor.get(p.id)!.id} name={swapFor.get(p.id)!.name} size={28} /><span className="text-xs">{short(swapFor.get(p.id)!.name)}</span></span> : <span className="text-zinc-500">–</span>
                ) : <span className="text-zinc-500">–</span>);
              })}
              <tr className="font-bold" style={{ background: "var(--paper)" }}>
                <td colSpan={4} className="!text-right text-xs tracking-wider text-zinc-500">TOTALS</td>
                <td>{recProj.toFixed(1)}</td><td>{recPpg.toFixed(1)}</td><td />
              </tr>
              {benchBest.length > 0 && (
                <>
                  <tr><td colSpan={7} className="!text-left text-xs font-bold tracking-wider text-zinc-500" style={{ background: "var(--paper)" }}>BENCH</td></tr>
                  {benchBest.map((p) => row(p, p.slot === "ir" ? "IR" : "BN", `b${p.id}`, false, startIds.has(p.id) && starters.length > 0 ? <span className="rounded-full bg-[#fde4e1] px-2 text-[11px] font-bold text-[#b42318]">Sit</span> : <span className="text-zinc-500">–</span>))}
                </>
              )}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-zinc-500">Opp rank is how much the defense gives up to that position (1st is the friendliest). Picks use {source === "proj" ? "this week's projections" : source === "mine" ? "your rankings" : "the consensus"}. Injuries and bye weeks aren&apos;t checked.</p>
      </div>
    </div>
  );
}
