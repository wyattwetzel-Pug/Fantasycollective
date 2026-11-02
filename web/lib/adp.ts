// 3.8 in a 12-team draft is pick 4 of round 1, written 1.04.
export function pickLabel(adp: number, teams: number) {
  const round = Math.max(1, Math.ceil(adp / teams));
  const pick = Math.min(teams, Math.max(1, Math.round(adp - (round - 1) * teams)));
  return `${round}.${String(pick).padStart(2, "0")}`;
}
