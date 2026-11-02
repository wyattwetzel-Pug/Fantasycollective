// Which positions can fill each starting slot.
export const ELIGIBLE: Record<string, string[]> = {
  QB: ["QB"], RB: ["RB"], WR: ["WR"], TE: ["TE"], K: ["K"], DEF: ["DEF"],
  RBWR: ["RB", "WR"], WRTE: ["WR", "TE"], FLEX: ["RB", "WR", "TE"], SUPERFLEX: ["QB", "RB", "WR", "TE"],
};

export const slotLabel = (slot: string) =>
  ({ DEF: "DST", FLEX: "FLEX", SUPERFLEX: "SFLEX", RBWR: "R/W", WRTE: "W/T" } as Record<string, string>)[slot] ?? slot;

// A standard lineup, for leagues that were synced before we saved their real one.
export function defaultLineup(superflex: boolean, has: { K: boolean; DEF: boolean }): string[] {
  return ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", ...(superflex ? ["SUPERFLEX"] : []), ...(has.K ? ["K"] : []), ...(has.DEF ? ["DEF"] : [])];
}

// Fills each slot with the best eligible player. Slots that accept one position are filled first, then
// the flex slots from the widest pool of what's left. Higher score is better. Order of `slots` is kept.
export function fillLineup<T extends { pos: string }>(slots: string[], players: T[], score: (p: T) => number): { slot: string; player: T | null }[] {
  const order = slots.map((slot, i) => ({ slot, i })).sort((a, b) => (ELIGIBLE[a.slot]?.length ?? 9) - (ELIGIBLE[b.slot]?.length ?? 9) || a.i - b.i);
  const taken = new Set<T>();
  const out: { slot: string; player: T | null }[] = slots.map((slot) => ({ slot, player: null }));
  for (const { slot, i } of order) {
    const ok = ELIGIBLE[slot] ?? [];
    const best = players.filter((p) => !taken.has(p) && ok.includes(p.pos)).sort((a, b) => score(b) - score(a))[0];
    if (best) { taken.add(best); out[i].player = best; }
  }
  return out;
}
