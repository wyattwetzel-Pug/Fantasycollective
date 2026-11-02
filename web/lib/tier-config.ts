// Every tier, best to worst, and its color. Tiers after E are all red.
export const TIER_ORDER = ["S", "A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N"];

const RED = "#E5484D";
export const TIER_COLORS: Record<string, string> = {
  S: "#D4A72C", A: "#43B02A", B: "#2F7BEA", C: "#8B5CF6", D: "#E0A800", E: "#F28C28",
  ...Object.fromEntries(TIER_ORDER.slice(6).map((t) => [t, RED])),
};
