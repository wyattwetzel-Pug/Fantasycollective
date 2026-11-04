import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAll } from "@/lib/fetch-all";

// Average draft position from two free public feeds, refreshed with the daily sync. For each league setup the
// first source with enough players wins:
//   MyFantasyLeague: PPR and Standard redraft, 12 teams.
//   Fantasy Football Calculator (fantasyfootballcalculator.com): Half PPR, Superflex and Dynasty. Credit them.
// Players are matched to ours by name and position. The same job replaces scripts/build_adp.py.

type Setup = { format: string; scoring: string; qb: string };
type Loader = { source: string; load: (season: number) => Promise<Adp[]> };
type Adp = { name: string; pos: string; team: string | null; adp: number; high: number | null; low: number | null; stdev: number | null; n: number | null; asOf: string | null };

const MIN_PLAYERS = 60;
const UA = { "User-Agent": "Mozilla/5.0 fantasy-collective" };
const POS: Record<string, string> = { PK: "K", DST: "DEF", Def: "DEF", DEF: "DEF" };
const norm = (name: string) => name.toLowerCase().replace(/-/g, " ").replace(/\./g, "").replace(/[^a-z ]/g, "").replace(/\b(jr|sr|ii|iii|iv|v)\b/g, "").replace(/\s+/g, " ").trim();

async function get<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: UA, cache: "no-store" });
  if (!res.ok) throw new Error(`${url} returned ${res.status}`);
  return (await res.json()) as T;
}

const ffc = (kind: string): Loader => ({
  source: "Fantasy Football Calculator",
  load: async (season) => {
    const d = await get<{ meta?: { end_date?: string }; players?: { name: string; position: string; team: string; adp: number; high?: number; low?: number; stdev?: number; times_drafted?: number }[] }>(
      `https://fantasyfootballcalculator.com/api/v1/adp/${kind}?teams=12&year=${season}`);
    return (d.players ?? []).map((p) => ({ name: p.name, pos: POS[p.position] ?? p.position, team: p.team, adp: p.adp, high: p.high ?? null, low: p.low ?? null, stdev: p.stdev ?? null, n: p.times_drafted ?? null, asOf: d.meta?.end_date ?? null }));
  },
});

let mflPlayers: Map<string, { name: string; position: string; team?: string }> | null = null;
const mfl = (ppr: number): Loader => ({
  source: "MyFantasyLeague",
  load: async (season) => {
    if (!mflPlayers) {
      const d = await get<{ players: { player: { id: string; name: string; position: string; team?: string }[] } }>(`https://api.myfantasyleague.com/${season}/export?TYPE=players&DETAILS=1&JSON=1`);
      mflPlayers = new Map(d.players.player.map((p) => [p.id, p]));
    }
    const d = await get<{ adp: { timestamp?: string; player?: { id: string; averagePick: string; minPick: string; maxPick: string; draftsSelectedIn: string }[] } }>(
      `https://api.myfantasyleague.com/${season}/export?TYPE=adp&PERIOD=ALL&FCOUNT=12&IS_PPR=${ppr}&IS_KEEPER=N&IS_MOCK=0&JSON=1`);
    const when = d.adp.timestamp ? new Date(Number(d.adp.timestamp) * 1000).toISOString().slice(0, 10) : null;
    return (d.adp.player ?? []).flatMap((p) => {
      const m = mflPlayers!.get(p.id);
      if (!m || !m.name.includes(",")) return [];
      const [last, first] = m.name.split(",").map((x) => x.trim());
      return [{ name: `${first} ${last}`, pos: POS[m.position] ?? m.position, team: m.team ?? null, adp: Number(p.averagePick), high: Number(p.minPick), low: Number(p.maxPick), stdev: null, n: Number(p.draftsSelectedIn), asOf: when }];
    });
  },
});

const PLAN: [Setup, Loader[]][] = [
  [{ format: "redraft", scoring: "ppr", qb: "1qb" }, [mfl(1), ffc("ppr")]],
  [{ format: "redraft", scoring: "std", qb: "1qb" }, [mfl(0), ffc("standard")]],
  [{ format: "redraft", scoring: "half", qb: "1qb" }, [ffc("half-ppr")]],
  [{ format: "redraft", scoring: "ppr", qb: "superflex" }, [ffc("2qb")]],
  [{ format: "dynasty", scoring: "ppr", qb: "1qb" }, [ffc("dynasty")]],
];

export async function syncAdp(db: SupabaseClient, season: number, log: string[]) {
  try {
    mflPlayers = null;
    const ours = await fetchAll<{ id: number; name: string; position: string; nfl_team: string | null }>((a, b) => db.from("players").select("id, name, position, nfl_team").order("id").range(a, b));
    const byName = new Map<string, typeof ours>();
    ours.forEach((p) => { const k = `${norm(p.name)}|${p.position}`; byName.set(k, [...(byName.get(k) ?? []), p]); });
    const defByTeam = new Map(ours.filter((p) => p.position === "DEF").map((p) => [p.nfl_team, p.id]));

    const rows = new Map<string, Record<string, unknown>>();
    for (const [setup, loaders] of PLAN) {
      for (const { source, load } of loaders) {
        let data: Adp[];
        try { data = await load(season); } catch { continue; }
        if (data.length < MIN_PLAYERS) continue;
        for (const p of data) {
          let id: number | undefined;
          if (p.pos === "DEF" && source !== "MyFantasyLeague" && defByTeam.has(p.team)) id = defByTeam.get(p.team);
          else {
            const c = byName.get(`${norm(p.name)}|${p.pos}`) ?? [];
            id = c.length === 1 ? c[0].id : c.find((x) => x.nfl_team === p.team)?.id;
          }
          if (id === undefined || !Number.isFinite(p.adp)) continue;
          rows.set(`${id}|${source}|${setup.format}|${setup.scoring}|${setup.qb}`, {
            player_id: id, source, season, format: setup.format, scoring: setup.scoring, qb_type: setup.qb,
            adp: Math.round(p.adp * 10) / 10, high: p.high, low: p.low, stdev: p.stdev, times_drafted: p.n, teams: 12, as_of: p.asOf,
          });
        }
        break; // the first good source wins for this setup
      }
    }
    const list = [...rows.values()];
    for (let i = 0; i < list.length; i += 400) {
      const { error } = await db.from("adp").upsert(list.slice(i, i + 400), { onConflict: "player_id,source,season,format,scoring,qb_type" });
      if (error) throw new Error(error.message);
    }
    log.push(`ADP ${season}: ${list.length} rows.`);
  } catch (e) {
    log.push(`ADP skipped: ${e instanceof Error ? e.message : String(e)}`);
  }
}

// Runs the ADP refresh on its own (its own daily cron), so it never competes with the main sync for time.
export async function runAdpSync(): Promise<{ ok: boolean; log: string[] }> {
  const { createClient } = await import("@supabase/supabase-js");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return { ok: false, log: ["SUPABASE_SERVICE_ROLE_KEY is not set."] };
  const db = createClient(url, key, { auth: { persistSession: false } });
  const state = await get<{ season: string }>("https://api.sleeper.app/v1/state/nfl");
  const log: string[] = [];
  await syncAdp(db, Number(state.season), log);
  return { ok: !log.some((l) => l.includes("skipped")), log };
}
