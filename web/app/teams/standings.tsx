type T = { name: string; mine: boolean; strength: number };

// Predicted standings. Every team is played against every other team: the stronger starting lineup
// (from the Ball Knowers Consensus) is favored, and the chances add up to an expected record.
export function Standings({ teams, games }: { teams: T[]; games: number }) {
  if (!teams.length) return <p className="text-sm text-zinc-400">No rosters stored for this league. Try refreshing.</p>;
  const mean = teams.reduce((s, t) => s + t.strength, 0) / teams.length;
  const sd = Math.sqrt(teams.reduce((s, t) => s + (t.strength - mean) ** 2, 0) / teams.length) || 1;
  const winProb = (a: T, b: T) => 1 / (1 + Math.exp(-0.7 * ((a.strength - b.strength) / sd)));
  const rows = teams.map((t) => {
    const others = teams.filter((o) => o !== t);
    const p = others.length ? others.reduce((s, o) => s + winProb(t, o), 0) / others.length : 0.5;
    const wins = Math.round(p * games);
    return { ...t, wins, losses: games - wins, pct: p };
  }).sort((a, b) => b.pct - a.pct);
  const top = rows[0].strength;

  return (
    <div className="space-y-3">
      <p className="text-sm"><span className="font-bold">Predicted by</span> Ball Knowers Consensus · best starting lineup · {games}-game season</p>
      <div className="gl-panel overflow-hidden !rounded-xl">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-800 text-left text-[11px] uppercase tracking-wider text-zinc-400">
              <th className="w-10 px-3 py-2 text-center">#</th>
              <th className="px-2 py-2">Team</th>
              <th className="px-2 py-2 text-center">Record</th>
              <th className="hidden px-2 py-2 text-center sm:table-cell">Win %</th>
              <th className="hidden w-1/3 px-2 py-2 md:table-cell">Lineup strength</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t, i) => (
              <tr key={t.name} className="border-b border-zinc-800 last:border-0">
                <td className="px-3 py-2 text-center font-bold">{i + 1}</td>
                <td className="px-2 py-2 font-bold">
                  {t.name}{t.mine && <span className="ml-2 rounded-full px-1.5 text-[10px] font-bold text-[#fff]" style={{ background: "var(--accent)" }}>You</span>}
                </td>
                <td className="px-2 py-2 text-center font-bold">{t.wins}-{t.losses}</td>
                <td className="hidden px-2 py-2 text-center sm:table-cell">{(t.pct * 100).toFixed(0)}%</td>
                <td className="hidden px-2 py-2 md:table-cell">
                  <div className="h-2 overflow-hidden rounded bg-[#DEDAD0]"><div className="h-full rounded bg-[var(--bar)]" style={{ width: `${(t.strength / top) * 100}%` }} /></div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
