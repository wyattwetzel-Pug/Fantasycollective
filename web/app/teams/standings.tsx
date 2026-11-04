type Rec = { w: number; l: number; t: number };
type T = { name: string; mine: boolean; strength: number };
export type SeasonData = { games: number; records: Record<string, Rec>; remaining: Record<string, string[]> };

// Predicted standings. Each team keeps its record so far and plays the rest of its schedule: the stronger
// starting lineup (from the Ball Knowers Consensus) is favored in every game, and the chances add up to
// an expected final record. With no schedule on file, every team is played against every other team.
export function Standings({ teams, games, season }: { teams: T[]; games: number; season: SeasonData | null }) {
  if (!teams.length) return <p className="text-sm text-zinc-400">No rosters stored for this league. Try refreshing.</p>;
  const mean = teams.reduce((s, t) => s + t.strength, 0) / teams.length;
  const sd = Math.sqrt(teams.reduce((s, t) => s + (t.strength - mean) ** 2, 0) / teams.length) || 1;
  const byName = new Map(teams.map((t) => [t.name, t]));
  const winProb = (a: T, b: T) => 1 / (1 + Math.exp(-0.7 * ((a.strength - b.strength) / sd)));
  const live = !!season && teams.every((t) => season.records[t.name]);
  const total = season?.games ?? games;

  const rows = teams.map((t) => {
    const cur = live ? season!.records[t.name] : { w: 0, l: 0, t: 0 };
    const opps = live ? (season!.remaining[t.name] ?? []).map((n) => byName.get(n)).filter((o): o is T => !!o) : teams.filter((o) => o !== t);
    const left = live ? opps.length : games;
    const pLeft = opps.length ? opps.reduce((s, o) => s + winProb(t, o), 0) / opps.length : 0.5;
    const expWins = cur.w + cur.t / 2 + pLeft * left;
    const w = Math.round(expWins - cur.t / 2);
    const played = cur.w + cur.l + cur.t;
    const oppAvg = opps.length ? opps.reduce((x, o) => x + o.strength, 0) / opps.length : mean;
    return { ...t, oppAvg, cur, expWins, left, w, l: Math.max(0, (live ? Math.max(total, played + left) : games) - w - cur.t), pct: expWins / Math.max(1, live ? Math.max(total, played + left) : games) };
  }).sort((a, b) => b.expWins - a.expWins || b.cur.w - a.cur.w);
  // Fuller bar = easier remaining schedule (weaker opponents on the consensus rankings).
  const lo = Math.min(...rows.map((r) => r.oppAvg)), hi = Math.max(...rows.map((r) => r.oppAvg));
  const easy = (r: { oppAvg: number }) => (hi === lo ? 100 : 100 - 90 * ((r.oppAvg - lo) / (hi - lo)));

  return (
    <div className="space-y-3">
      <p className="text-sm">
        <span className="font-bold">Predicted by</span> Ball Knowers Consensus · best starting lineup ·{" "}
        {live ? "current records + the rest of the schedule" : `${games}-game season (no records on file; refresh the league to add them)`}
      </p>
      <div className="gl-panel overflow-hidden !rounded-xl">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-800 text-left text-[11px] uppercase tracking-wider text-zinc-400">
              <th className="w-10 px-3 py-2 text-center">#</th>
              <th className="px-2 py-2">Team</th>
              {live && <th className="px-2 py-2 text-center">Now</th>}
              <th className="px-2 py-2 text-center">{live ? "Projected" : "Record"}</th>
              <th className="hidden px-2 py-2 text-center sm:table-cell">Win %</th>
              <th className="hidden w-1/4 px-2 py-2 md:table-cell">Strength of schedule</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t, i) => (
              <tr key={t.name} className="border-b border-zinc-800 last:border-0">
                <td className="px-3 py-2 text-center font-bold">{i + 1}</td>
                <td className="px-2 py-2 font-bold">
                  {t.name}{t.mine && <span className="ml-2 rounded-full px-1.5 text-[10px] font-bold text-[#fff]" style={{ background: "var(--accent)" }}>You</span>}
                </td>
                {live && <td className="px-2 py-2 text-center">{t.cur.w}-{t.cur.l}{t.cur.t ? `-${t.cur.t}` : ""}</td>}
                <td className="px-2 py-2 text-center font-bold">{t.w}-{t.l}{t.cur.t ? `-${t.cur.t}` : ""}</td>
                <td className="hidden px-2 py-2 text-center sm:table-cell">{(t.pct * 100).toFixed(0)}%</td>
                <td className="hidden px-2 py-2 md:table-cell">
                  <div className="h-2 overflow-hidden rounded bg-[#DEDAD0]"><div className="h-full rounded bg-[var(--bar)]" style={{ width: `${easy(t)}%` }} /></div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
