import { fetchAll } from "@/lib/fetch-all";
import { sessionUser, profileOf } from "@/lib/session";
import { positionRankMap } from "@/lib/position-consensus";
import { Suspense } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { fixTiers } from "@/lib/tiers";
import { unrankedAfter } from "@/lib/fallback-rank";
import { seasonLines } from "@/lib/season";
import { nowMs } from "@/lib/time";
import { playerValue } from "@/lib/value";
import { refreshLeague, removeLeague } from "./actions";
import { SyncForm } from "./sync-form";
import { TeamCards } from "./team-cards";
import { LineupSection } from "./lineup-section";
import { Standings, type SeasonData } from "./standings";
import { defaultLineup, fillLineup } from "@/lib/lineup";

type League = {
  id: number; name: string | null; platform: string; scoring: string; qb_type: string; format: string; synced_at: string | null;
  roster_settings: { lineup?: string[]; total_rosters?: number; season?: SeasonData | null } | null;
};
type RosterRow = { team_name: string; is_mine: boolean; player_id: number; slot: string };
type PlayerRow = { id: number; name: string; position: string; nfl_team: string | null };
type ConsensusRow = { player_id: number; position_in_list: number; tier: string | null };
type Rank = { rank: number; tier: string | null };

const LABEL: Record<string, string> = { redraft: "Redraft", dynasty: "Dynasty", ppr: "PPR", half: "Half PPR", std: "Standard", "1qb": "1 QB", superflex: "Superflex" };
const PLATFORM: Record<string, string> = { sleeper: "Sleeper", espn: "ESPN", fleaflicker: "Fleaflicker", mfl: "MyFantasyLeague" };
const POS = ["QB", "RB", "WR", "TE", "K", "DEF"] as const;

function ago(iso: string | null) {
  if (!iso) return "never";
  const mins = Math.max(0, Math.round((nowMs() - new Date(iso).getTime()) / 60000));
  if (mins < 2) return "just now";
  if (mins < 60) return `${mins}m ago`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / 1440)}d ago`;
}

async function TeamsView({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const str = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const supabase = await createClient();
  const user = await sessionUser();

  const hero = (
    <div className="gl-hero p-5 sm:p-7">
      <p className="text-[11px] font-semibold tracking-[0.35em] text-zinc-400">FANTASY FOOTBALL</p>
      <h2 id="h-teams" className="gl-title text-5xl sm:text-7xl">My Teams</h2>
      <p className="mt-2 text-base text-zinc-300">Review all your leagues, and see how every team stacks up on your rankings.</p>
    </div>
  );

  if (!user) {
    return (
      <div className="space-y-5">
        {hero}
        <div className="gl-panel p-5 text-sm text-zinc-300">
          <Link href="/login" className="underline" style={{ color: "var(--accent)" }}>Log in</Link> to sync your leagues.
        </div>
      </div>
    );
  }

  const [me, { data: leagueRows }] = await Promise.all([
    profileOf(user.id),
    supabase.from("leagues").select("id, name, platform, scoring, qb_type, format, synced_at, roster_settings").order("name").returns<League[]>(),
  ]);
  const leagues = leagueRows ?? [];
  const chosen = leagues.find((l) => String(l.id) === str("league")) ?? leagues[0] ?? null;
  const isContributor = me?.role === "contributor";
  const wanted = str("src");
  const tab = str("tab") === "rankings" ? "rankings" : str("tab") === "standings" ? "standings" : "lineup";
  // The lineup can also be built from projections. League rankings only use your list or the consensus.
  const lineupSource: "mine" | "consensus" | "proj" = wanted === "proj" ? "proj" : "consensus";

  let content: React.ReactNode = null;
  if (chosen && tab === "lineup") {
    content = <LineupSection supabase={supabase} userId={user.id} chosen={chosen} isContributor={isContributor} source={lineupSource} />;
  }
  if (chosen && (tab === "rankings" || tab === "standings")) {
    const combo = { format: chosen.format, scoring: chosen.scoring, qb_type: chosen.qb_type };
    const [{ data: rosterRows }, { data: playerRows }, { data: cons }] = await Promise.all([
      supabase.from("league_rosters").select("team_name, is_mine, player_id, slot").eq("league_id", chosen.id).limit(1000).returns<RosterRow[]>(),
      fetchAll<PlayerRow>((a, b) => supabase.from("players").select("id, name, position, nfl_team").order("id").range(a, b).returns<PlayerRow[]>()).then((data) => ({ data })),
      supabase.from("consensus_current").select("player_id, position_in_list, tier").match(combo).order("position_in_list").limit(1000).returns<ConsensusRow[]>(),
    ]);
    const info = new Map((playerRows ?? []).map((p) => [p.id, p]));

    const consensus = new Map<number, Rank>(fixTiers(cons ?? []).map((c) => [c.player_id, { rank: c.position_in_list, tier: c.tier }]));
    const lines = await seasonLines(chosen.scoring);
    const ppgOf = (id: number) => { const l = lines[id]; return l && l.played ? l.points / l.played : -1; };
    unrankedAfter(new Map([...consensus].map(([id, r]) => [id, r.rank])), [...info.keys()], ppgOf).forEach((r, id) => consensus.set(id, { rank: r, tier: null }));
    const rankOf = (id: number): Rank | undefined => consensus.get(id);

    // Position rank: where a player sits among all players at his position on this ranking.
    const posRankOf = new Map<number, number>();
    const seen: Record<string, number> = {};
    [...info.values()].map((p) => ({ p, r: rankOf(p.id) })).filter((x) => x.r)
      .sort((a, b) => a.r!.rank - b.r!.rank)
      .forEach(({ p }) => { seen[p.position] = (seen[p.position] ?? 0) + 1; posRankOf.set(p.id, seen[p.position]); });
    // The position consensus (your position lists, averaged with other contributors') wins over the Overall order.
    Object.entries(await positionRankMap(combo)).forEach(([id, rank]) => posRankOf.set(Number(id), rank));

    type TeamPlayer = { id: number; name: string; pos: string; slot: string; rank: Rank | undefined; posRank: number | null; value: number };
    const teams = new Map<string, { name: string; mine: boolean; players: TeamPlayer[] }>();
    for (const r of rosterRows ?? []) {
      const p = info.get(r.player_id);
      if (!p) continue;
      const t = teams.get(r.team_name) ?? { name: r.team_name, mine: false, players: [] };
      const rk = rankOf(r.player_id);
      t.mine = t.mine || r.is_mine;
      t.players.push({ id: p.id, name: p.name, pos: p.position, slot: r.slot, rank: rk, posRank: posRankOf.get(p.id) ?? null, value: rk ? playerValue(rk.rank) : 0 });
      teams.set(r.team_name, t);
    }
    // A team's strength at a position comes from the position ranks of its players. Teams are
    // then ordered by their average position-group rank (QB, RB, WR and TE).
    const base = [...teams.values()].map((t) => {
      const group: Record<string, number> = {};
      const posValue: Record<string, number> = {};
      t.players.forEach((p) => {
        group[p.pos] = (group[p.pos] ?? 0) + p.value;
        if (p.posRank) posValue[p.pos] = (posValue[p.pos] ?? 0) + playerValue(p.posRank);
      });
      return { ...t, group, posValue, total: t.players.reduce((s, p) => s + p.value, 0) };
    });
    const present = POS.filter((p) => base.some((t) => t.players.some((x) => x.pos === p)));
    const groupRank = new Map<string, number>();
    present.forEach((pos) => {
      [...base].sort((a, b) => (b.posValue[pos] ?? 0) - (a.posValue[pos] ?? 0)).forEach((t, i) => groupRank.set(`${t.name}|${pos}`, i + 1));
    });
    const CORE = ["QB", "RB", "WR", "TE"].filter((p) => (present as readonly string[]).includes(p));
    const list = base.map((t) => ({
      ...t,
      avg: CORE.length ? CORE.reduce((sum, pos) => sum + (groupRank.get(`${t.name}|${pos}`) ?? 0), 0) / CORE.length : null,
    })).sort((a, b) => (a.avg ?? 99) - (b.avg ?? 99) || b.total - a.total);

    if (tab === "standings") {
      // Overall slots are handed out by position rank, so a QB and a WR can be compared for a FLEX spot.
      const adjusted = new Map<number, number>();
      const byPos = new Map<string, { id: number; pr: number; r: number }[]>();
      info.forEach((p) => {
        const r = rankOf(p.id)?.rank, pr = posRankOf.get(p.id);
        if (!r || !pr) return;
        byPos.set(p.position, [...(byPos.get(p.position) ?? []), { id: p.id, pr, r }]);
      });
      byPos.forEach((l) => {
        const slots = l.map((x) => x.r).sort((a, b) => a - b);
        [...l].sort((a, b) => a.pr - b.pr).forEach((x, i) => adjusted.set(x.id, slots[i]));
      });
      const has = (pos: string) => list.some((t) => t.players.some((p) => p.pos === pos));
      const lineup = chosen.roster_settings?.lineup?.length ? chosen.roster_settings.lineup : defaultLineup(chosen.qb_type === "superflex", { K: has("K"), DEF: has("DEF") });
      const strengths = list.map((t) => {
        const usable = t.players.filter((p) => p.slot !== "ir");
        const val = (p: TeamPlayer) => (adjusted.has(p.id) ? playerValue(adjusted.get(p.id)!) : 0);
        const picked = fillLineup(lineup, usable, val);
        return { name: t.name, mine: t.mine, strength: picked.reduce((s, x) => s + (x.player ? val(x.player) : 0), 0) };
      });
      content = <Standings teams={strengths} games={14} season={chosen.roster_settings?.season ?? null} />;
    } else content = (
      <div className="space-y-4">
        <p className="text-sm"><span className="font-bold">Ranked by</span> Ball Knowers Consensus</p>

        {!list.length && <p className="text-sm text-zinc-400">No rosters stored for this league. Try refreshing.</p>}

        <TeamCards list={list} present={present} groupRank={groupRank} />
      </div>
    );
  }

  const teamCount = chosen?.roster_settings?.total_rosters;
  const detail = chosen ? (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-[14rem] flex-1">
          <h3 className="text-3xl">{chosen.name}</h3>
          <p className="text-xs text-zinc-400">
            {PLATFORM[chosen.platform] ?? chosen.platform} · {LABEL[chosen.format]} · {LABEL[chosen.scoring]} · {LABEL[chosen.qb_type]}{teamCount ? ` · ${teamCount} teams` : ""} · synced {ago(chosen.synced_at)}
          </p>
        </div>
        <form action={refreshLeague}><input type="hidden" name="id" value={chosen.id} /><button className="gl-pill">⟳ Refresh</button></form>
        <form action={removeLeague}><input type="hidden" name="id" value={chosen.id} /><button className="px-2 text-sm text-red-400">Remove</button></form>
      </div>
      <div role="tablist" aria-label="League sections" className="flex gap-2 border-b border-zinc-800 pb-3">
        <Link role="tab" aria-selected={tab === "lineup"} href={`/teams?league=${chosen.id}&tab=lineup`} className={`gl-pill !px-5 ${tab === "lineup" ? "on" : ""}`}>Lineup</Link>
        <Link role="tab" aria-selected={tab === "rankings"} href={`/teams?league=${chosen.id}&tab=rankings`} className={`gl-pill !px-5 ${tab === "rankings" ? "on" : ""}`}>Power Rankings</Link>
        <Link role="tab" aria-selected={tab === "standings"} href={`/teams?league=${chosen.id}&tab=standings`} className={`gl-pill !px-5 ${tab === "standings" ? "on" : ""}`}>Top To Bottom</Link>
      </div>
      {content}
    </div>
  ) : null;

  return (
    <div className="space-y-5">
      {hero}
      {str("error") && <p className="rounded-xl border border-red-900 bg-red-950 p-3 text-sm text-red-300">{str("error")}</p>}
      {str("msg") && <p className="rounded-xl border border-green-900 bg-green-950 p-3 text-sm text-green-300">{str("msg")}</p>}

      <div className="grid items-start gap-5 lg:grid-cols-[19rem_1fr]">
        <div className="space-y-4 lg:sticky lg:top-4">
          <div className="gl-panel space-y-3 p-4">
            <div className="flex items-center justify-between">
              <h3 className="text-2xl">Leagues <span className="ml-1 rounded-full bg-[#EDE9DF] px-2 py-0.5 text-sm not-italic">{leagues.length}</span></h3>
            </div>
            {leagues.map((l) => (
              <Link key={l.id} href={`/teams?league=${l.id}`} className={`block rounded-xl border p-3 ${chosen?.id === l.id ? "gl-src-on" : "border-zinc-800 bg-[#FBFAF6]"}`}>
                <span className="block font-bold">{l.name}</span>
                <span className="block text-xs text-zinc-400">{PLATFORM[l.platform] ?? l.platform} · {LABEL[l.format]} · {LABEL[l.scoring]} · {LABEL[l.qb_type]}</span>
              </Link>
            ))}
            {!leagues.length && <p className="text-sm text-zinc-400">No leagues synced yet.</p>}
            <details open={!leagues.length} className="rounded-xl border border-zinc-800 bg-[#FBFAF6] p-3">
              <summary className="cursor-pointer text-sm font-bold">+ Sync a league</summary>
              <div className="mt-3"><SyncForm /></div>
            </details>
          </div>
        </div>

        <div className="min-w-0">{detail ?? <p className="text-sm text-zinc-400">Sync a league to see every team in it.</p>}</div>
      </div>
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
