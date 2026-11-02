import { Suspense } from "react";
import { PlayerLink } from "@/app/player-link";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { playerValue } from "@/lib/value";
import { removeLeague, syncSleeper } from "./actions";

type League = {
  id: number; name: string | null; scoring: string; qb_type: string; format: string; synced_at: string | null;
  roster_settings: { total_rosters?: number } | null;
};
type RosterRow = { team_name: string; is_mine: boolean; player_id: number; slot: string };
type PlayerRow = { id: number; name: string; position: string; nfl_team: string | null };
type ConsensusRow = { player_id: number; position_in_list: number; tier: string | null };

const LABEL: Record<string, string> = { redraft: "Redraft", dynasty: "Dynasty", ppr: "PPR", half: "Half PPR", std: "Standard", "1qb": "1 QB", superflex: "Superflex" };
const TABS = [["overview", "League Overview"], ["team", "My Team"], ["rankings", "League Rankings"]] as const;
const TIER_COLORS: Record<string, string> = {
  S: "#D4AF37", A: "#22A722", B: "#9333EA", C: "#3B82F6", D: "#FACC15", E: "#F97316", F: "#EF4444",
};
const SLOT_ORDER = ["starter", "bench", "ir"];
const SLOT_LABEL: Record<string, string> = { starter: "Starters", bench: "Bench", ir: "Reserve / IR" };

async function TeamsView({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const str = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const hero = (
    <div className="gl-hero grid items-center gap-4 p-6 sm:p-8">
      <div>
        <h2 id="h-teams" className="gl-title text-4xl sm:text-6xl">MY <span style={{ color: "#39ff14" }}>TEAMS</span></h2>
        <p className="mt-2 text-sm text-zinc-200">Sync your leagues, see your roster, and see how your team stacks up.</p>
      </div>
    </div>
  );

  if (!user) {
    return (
      <div className="space-y-4">
        {hero}
        <div className="gl-panel p-4 text-sm text-zinc-300">
          <Link href="/login" className="underline" style={{ color: "#7dff6a" }}>Log in</Link> to sync your Sleeper leagues.
        </div>
      </div>
    );
  }

  const { data: leagueRows } = await supabase
    .from("leagues").select("id, name, scoring, qb_type, format, synced_at, roster_settings").order("name").returns<League[]>();
  const leagues = leagueRows ?? [];
  const chosen = leagues.find((l) => String(l.id) === str("league")) ?? null;
  const tab = TABS.find((t) => t[0] === str("tab"))?.[0] ?? "overview";

  let detail: React.ReactNode = null;
  if (chosen) {
    const [{ data: rosterRows }, { data: playerRows }, { data: cons }] = await Promise.all([
      supabase.from("league_rosters").select("team_name, is_mine, player_id, slot").eq("league_id", chosen.id).limit(1000).returns<RosterRow[]>(),
      supabase.from("players").select("id, name, position, nfl_team").limit(1000).returns<PlayerRow[]>(),
      supabase.from("consensus_current").select("player_id, position_in_list, tier")
        .match({ format: chosen.format, scoring: chosen.scoring, qb_type: chosen.qb_type }).limit(1000).returns<ConsensusRow[]>(),
    ]);
    const info = new Map((playerRows ?? []).map((p) => [p.id, p]));
    const rank = new Map((cons ?? []).map((c) => [c.player_id, c]));

    const teams = new Map<string, { name: string; mine: boolean; rows: RosterRow[] }>();
    (rosterRows ?? []).forEach((r) => {
      const t = teams.get(r.team_name) ?? { name: r.team_name, mine: false, rows: [] };
      t.mine = t.mine || r.is_mine; t.rows.push(r); teams.set(r.team_name, t);
    });
    const scored = [...teams.values()].map((t) => ({
      ...t,
      value: t.rows.reduce((s, r) => s + (rank.has(r.player_id) ? playerValue(rank.get(r.player_id)!.position_in_list) : 0), 0),
      unranked: t.rows.filter((r) => !rank.has(r.player_id)).length,
    })).sort((a, b) => b.value - a.value);
    const mine = scored.find((t) => t.mine);
    const myPlace = mine ? scored.indexOf(mine) + 1 : 0;
    const top = Math.max(1, ...scored.map((t) => t.value));

    const base = `/teams?league=${chosen.id}`;
    detail = (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="mr-2 text-2xl font-bold">{chosen.name}</h3>
          <span className="text-xs text-zinc-400">{LABEL[chosen.format]} · {LABEL[chosen.scoring]} · {LABEL[chosen.qb_type]} · {scored.length} teams</span>
        </div>
        <div role="tablist" className="flex gap-6 border-b border-zinc-800 text-sm">
          {TABS.map(([v, l]) => (
            <Link key={v} role="tab" aria-selected={tab === v} href={`${base}&tab=${v}`} className={`px-1 pb-2 ${tab === v ? "border-b-2 text-white" : "text-zinc-400"}`} style={tab === v ? { borderColor: "#39ff14" } : undefined}>{l}</Link>
          ))}
        </div>

        {!scored.length && <p className="text-sm text-zinc-400">No rosters stored for this league. Try syncing again.</p>}

        {tab === "overview" && mine && (
          <div className="grid gap-4 md:grid-cols-3">
            <div className="gl-stat"><span className="text-3xl font-extrabold italic">#{myPlace}</span><span className="text-sm">Roster value rank of {scored.length}</span></div>
            <div className="gl-stat"><span className="text-3xl font-extrabold italic">{mine.value.toFixed(0)}</span><span className="text-sm">Your roster value</span></div>
            <div className="gl-stat"><span className="text-3xl font-extrabold italic">{mine.rows.length}</span><span className="text-sm">Players on your team{mine.unranked ? `, ${mine.unranked} unranked` : ""}</span></div>
          </div>
        )}
        {tab === "overview" && !mine && scored.length > 0 && <p className="text-sm text-zinc-400">We couldn&apos;t tell which team is yours in this league.</p>}

        {tab === "team" && mine && (
          <div className="space-y-4">
            {SLOT_ORDER.map((slot) => {
              const list = mine.rows.filter((r) => r.slot === slot)
                .sort((a, b) => (rank.get(a.player_id)?.position_in_list ?? 9999) - (rank.get(b.player_id)?.position_in_list ?? 9999));
              if (!list.length) return null;
              return (
                <div key={slot} className="gl-panel p-4">
                  <h4 className="mb-2 text-lg font-bold">{SLOT_LABEL[slot]}</h4>
                  <table className="gl-table">
                    <thead><tr><th scope="col" className="!text-left">PLAYER</th><th scope="col">POS</th><th scope="col">TEAM</th><th scope="col">TIER</th><th scope="col">RANK</th></tr></thead>
                    <tbody>
                      {list.map((r) => {
                        const p = info.get(r.player_id); const c = rank.get(r.player_id);
                        return (
                          <tr key={r.player_id}>
                            <td className="!text-left"><span className="flex items-center gap-2"><span className="h-8 w-8 shrink-0 rounded-full bg-zinc-700" aria-hidden="true" /><PlayerLink id={r.player_id} name={p?.name} /></span></td>
                            <td><span className={`bd ${p?.position}`}>{p?.position}</span></td>
                            <td>{p?.nfl_team}</td>
                            <td>{c?.tier ? <span className="inline-block rounded-full border px-3 text-xs" style={{ color: TIER_COLORS[c.tier], borderColor: TIER_COLORS[c.tier] }}>{c.tier}</span> : ""}</td>
                            <td>{c ? `#${c.position_in_list}` : <span className="text-zinc-500">unranked</span>}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              );
            })}
          </div>
        )}

        {tab === "rankings" && scored.length > 0 && (
          <div className="gl-panel p-4">
            <h4 className="mb-1 text-lg font-bold">League Rankings</h4>
            <p className="mb-3 text-xs text-zinc-500">Teams ordered by total roster value, from the Ball Knowers Consensus. Unranked players count as zero.</p>
            <ul className="space-y-2">
              {scored.map((t, i) => (
                <li key={t.name} className="gl-row" style={t.mine ? { borderColor: "#39ff14" } : undefined}>
                  <span className="w-6 text-center font-bold">{i + 1}</span>
                  <span className="pn w-48 truncate">{t.name}{t.mine && <span className="ml-2 text-xs" style={{ color: "#39ff14" }}>You</span>}</span>
                  <span className="h-3 flex-1 rounded bg-zinc-800"><span className="block h-3 rounded" style={{ width: `${(t.value / top) * 100}%`, background: t.mine ? "#3dea1f" : "#71717a" }} /></span>
                  <span className="w-14 text-right">{t.value.toFixed(0)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {hero}
      {str("error") && <p className="rounded border border-red-900 bg-red-950/30 p-3 text-sm text-red-300">{str("error")}</p>}
      {str("msg") && <p className="rounded border border-green-900 bg-green-950/30 p-3 text-sm text-green-300">{str("msg")}</p>}

      <div className="gl-panel space-y-3 p-4">
        <h3 className="text-lg font-bold">⟳ Sync League</h3>
        <form action={syncSleeper} className="flex flex-wrap gap-2">
          <label htmlFor="sleeper-user" className="sr-only">Sleeper username</label>
          <input id="sleeper-user" name="username" required placeholder="Your Sleeper username" className="gl-search max-w-xs" />
          <button className="gl-pill on-o !px-5 !py-2.5">Sync from Sleeper</button>
        </form>
        <p className="text-xs text-zinc-500">Uses Sleeper&apos;s public data. We only read your leagues and rosters and never need your password. ESPN and Yahoo aren&apos;t supported yet.</p>
      </div>

      {leagues.length > 0 ? (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {leagues.map((l) => (
              <Link key={l.id} href={`/teams?league=${l.id}`} className={`gl-pill !px-5 ${chosen?.id === l.id ? "on-o" : ""}`}>{l.name}</Link>
            ))}
          </div>
          {chosen && (
            <form action={removeLeague} className="text-right">
              <input type="hidden" name="id" value={chosen.id} />
              <button className="text-xs text-red-400">Remove this league</button>
            </form>
          )}
          {detail ?? <p className="text-sm text-zinc-400">Pick a league above.</p>}
        </div>
      ) : (
        <p className="text-sm text-zinc-400">No leagues synced yet.</p>
      )}
    </div>
  );
}

export default function TeamsPage(props: PageProps<"/teams">) {
  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-5 md:px-10 md:py-8">
      <Suspense fallback={<p className="text-zinc-400">Loading...</p>}>
        <TeamsView searchParams={props.searchParams} />
      </Suspense>
    </main>
  );
}
