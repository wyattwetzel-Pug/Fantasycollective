// Value of one player from his consensus rank: rank 1 is worth 100, falling about 3.5% per spot.
// Same formula as the Trade Calculator.
export const playerValue = (rank: number) => 100 * Math.exp(-0.035 * (rank - 1));
