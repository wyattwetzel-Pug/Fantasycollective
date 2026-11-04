export type Slot = "starter" | "bench" | "ir";
export type Scoring = "ppr" | "half" | "std";
export type QbType = "1qb" | "superflex";
export type Format = "redraft" | "dynasty";

// How a provider points at a player: Sleeper's own id, or a name/position/team we match on.
export type PlayerRef = { sleeperId: string } | { name: string; position: string; team: string | null };

export type ImportedTeam = {
  name: string;
  mine: boolean;
  players: { ref: PlayerRef; slot: Slot }[];
};

export type ImportedLeague = {
  externalId: string;
  name: string;
  scoring: Scoring | null; // null = provider could not tell
  qbType: QbType | null;
  format: Format | null;
  settings: Record<string, unknown>;
  teams: ImportedTeam[];
};

// Records so far and who each team still plays, saved with the league so standings can be projected.
export type Season = { games: number; records: Record<string, { w: number; l: number; t: number }>; remaining: Record<string, string[]> };

export type LeagueOptions = { scoring: Scoring | null; qbType: QbType | null; format: Format; myTeam: string };

// Provider errors carry a message that is safe to show the user.
export class ImportError extends Error {}

export const currentSeason = () => {
  const now = new Date();
  return now.getMonth() < 2 ? now.getFullYear() - 1 : now.getFullYear();
};

export async function fetchJson<T>(url: string, init?: RequestInit): Promise<{ status: number; data: T | null }> {
  try {
    const res = await fetch(url, { cache: "no-store", ...init });
    const text = await res.text();
    try {
      return { status: res.status, data: JSON.parse(text) as T };
    } catch {
      return { status: res.status, data: null };
    }
  } catch {
    return { status: 0, data: null };
  }
}

// Does a team name match what the user typed as "my team"? Matches the whole name, a number, or part of the name.
export const isMyTeam = (teamName: string, teamKey: string | number, typed: string) => {
  const t = typed.trim().toLowerCase();
  if (!t) return false;
  return String(teamKey) === t || teamName.toLowerCase() === t || teamName.toLowerCase().includes(t);
};
