// Every tier, best to worst, and its color. Tiers after E are all red.
export const TIER_ORDER = ["S", "A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N"];

const RED = "#C94545";
export const TIER_COLORS: Record<string, string> = {
  S: "#C9A227", A: "#4E9A5B", B: "#4F7FD1", C: "#D9B120", D: "#E8872B", E: "#DD6B2B",
  ...Object.fromEntries(TIER_ORDER.slice(6).map((t) => [t, RED])),
};
// Yellow needs dark text to stay readable; every other tier chip takes white.
export const tierInk = (tier: string | null | undefined) => (tier === "C" ? "#242522" : "#FBFAF6");
