// Players a contributor hasn't put in a tier are left out of the published rankings. My Teams still has to
// compare them (a kicker, a deep bench bat), so they go after every ranked player, best points per game first.
export function unrankedAfter(ranked: Map<number, number>, ids: number[], ppg: (id: number) => number): Map<number, number> {
  const last = Math.max(0, ...ranked.values());
  const extra = ids.filter((id) => !ranked.has(id)).sort((a, b) => ppg(b) - ppg(a));
  return new Map(extra.map((id, i) => [id, last + 1 + i]));
}
