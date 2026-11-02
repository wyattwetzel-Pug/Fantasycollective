import { TIER_ORDER } from "@/lib/tier-config";

const ORDER = TIER_ORDER;

// Consensus tiers are averages, so down the list they can bounce (a B, then an A). This fits the
// closest non-decreasing run of tiers to them (pool adjacent violators), so one odd player doesn't
// drag the rest of the list with them. Players with no tier take the value of their neighbour.
// Rows must already be in rank order.
export function fixTiers<T extends { tier: string | null }>(rows: T[]): T[] {
  const raw = rows.map((r) => (r.tier ? ORDER.indexOf(r.tier) : -1));
  const firstKnown = raw.find((v) => v >= 0);
  if (firstKnown === undefined) return rows;

  let prev = firstKnown;
  const vals = raw.map((v) => (v >= 0 ? (prev = v) : prev));

  const blocks: { sum: number; n: number }[] = [];
  for (const v of vals) {
    blocks.push({ sum: v, n: 1 });
    while (blocks.length > 1) {
      const b = blocks[blocks.length - 1], a = blocks[blocks.length - 2];
      if (a.sum / a.n <= b.sum / b.n) break;
      blocks.splice(blocks.length - 2, 2, { sum: a.sum + b.sum, n: a.n + b.n });
    }
  }
  const fitted = blocks.flatMap((b) => Array<number>(b.n).fill(Math.round(b.sum / b.n)));
  return rows.map((r, i) => ({ ...r, tier: ORDER[fitted[i]] }));
}
