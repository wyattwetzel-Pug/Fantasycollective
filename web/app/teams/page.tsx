import { Suspense } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { fixTiers } from "@/lib/tiers";
import { nowMs } from "@/lib/time";
import { playerValue } from "@/lib/value";
import { refreshLeague, removeLeague } from "./actions";
import { SyncForm } from "./sync-form";
import { TeamCards } from "./team-cards";

type League = {
  id: number; name: string | null; platform: string; scoring: string; qb_type: string; format: string; synced_at: string | null;
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
  const { data: { user } } = await supabase.auth.getUser();

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

  const [{ data: me }, { data: leagueRows }] = await Promise.all([
    supabase.from("profiles").select("role").eq("id", user.id).single(),
    supabase.from("leagues").select("id, name, platform, scoring, qb_type, format, synced_at").order("name").returns<League[]>(),
  ]);
  const leagues = leagueRows ?? [];
  const chosen = leagues.find((l) => String(l.id) === str("league")) ?? leagues[0] ?? null;
  const isContributor = me?.role === "contributor";
  const source = isContributor && str("src") !== "consensus" ? "mine" : "consensus";

  let detail: React.ReactNode = null;
  if (chosen) {
    const combo = { format: chosen.format, scoring: chosen.scoring, qb_type: chosen.qb_type };
    const [{ data: rosterRows }, { data: playerRows }, { data: cons }, { data: mySet }] = await Promise.all([
      supabase.from("league_rosters").select("team_name, is_mine, player_id, slot").eq("league_id", chosen.id).limit(1000).returns<RosterRow[]>(),
      supabase.from("players").select("id, name, position, nfl_team").limit(1000).returns<PlayerRow[]>(),
      supabase.from("consensus_current").select("player_id, position_in_list, tier").match(combo).order("position_in_list").limit(1000).returns<ConsensusRow[]>(),
      isContributor ? supabase.from("ranking_sets").select("id").match({ ...combo, contributor_id: user.id }).maybeSingle() : Promise.resolve({ data: null }),
    ]);
    const info = new Map((playerRows ?? []).map((p) => [p.id, p]));

    const consensus = new Map<number, Rank>(fixTiers(cons ?? []).map((c) => [c.player_id, { rank: c.position_in_list, tier: c.tier }]));
    // Your own list, in the order you ranked it. Players you haven't placed fall back to the consensus.
    const mine = new Map<number, Rank>();
    if (source === "mine" && mySet) {
      const { data: own } = await supabase.from("rankings").select("player_id, tier")
        .eq("set_id", mySet.id).eq("needs_ranking", false).order("rank").limit(2000).returns<{ player_id: number; tier: string | null }[]>();
      (own ?? []).forEach((r, i) => mine.set(r.player_id, { rank: i + 1, tier: r.tier }));
    }
    const rankOf = (id: number): Rank | undefined => (source === "mine" ? mine.get(id) ?? consensus.get(id) : consensus.get(id));
    const usingFallback = source === "mine" && (rosterRows ?? []).some((r) => !mine.has(r.player_id) && consensus.has(r.player_id));

    type TeamPlayer = { id: number; name: string; pos: string; slot: string; rank: Rank | undefined; value: number };
    const teams = new Map<string, { name: string; mine: boolean; players: TeamPlayer[] }>();
    for (const r of rosterRows ?? []) {
      const p = info.get(r.player_id);
      if (!p) continue;
      const t = teams.get(r.team_name) ?? { name: r.team_name, mine: false, players: [] };
      const rk = rankOf(r.player_id);
      t.mine = t.mine || r.is_mine;
      t.players.push({ id: p.id, name: p.name, pos: p.position, slot: r.slot, rank: rk, value: rk ? playerValue(rk.rank) : 0 });
      teams.set(r.team_name, t);
    }
    const list = [...teams.values()].map((t) => {
      const group: Record<string, number> = {};
      t.players.forEach((p) => { group[p.pos] = (group[p.pos] ?? 0) + p.value; });
      return { ...t, group, total: t.players.reduce((s, p) => s + p.value, 0) };
    }).sort((a, b) => b.total - a.total);

    // Each position group ranked against the rest of the league (1 = strongest).
    const present = POS.filter((p) => list.some((t) => t.players.some((x) => x.pos === p)));
    const groupRank = new Map<string, number>();
    present.forEach((pos) => {
      [...list].sort((a, b) => (b.group[pos] ?? 0) - (a.group[pos] ?? 0)).forEach((t, i) => groupRank.set(`${t.name}|${pos}`, i + 1));
    });

    detail = (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-[14rem] flex-1">
            <h3 className="text-3xl">{chosen.name}</h3>
            <p className="text-xs text-zinc-400">
              {PLATFORM[chosen.platform] ?? chosen.platform} · {LABEL[chosen.format]} · {LABEL[chosen.scoring]} · {LABEL[chosen.qb_type]} · {list.length} teams · synced {ago(chosen.synced_at)}
            </p>
          </div>
          <form action={refreshLeague}><input type="hidden" name="id" value={chosen.id} /><button className="gl-pill">⟳ Refresh</button></form>
          <form action={removeLeague}><input type="hidden" name="id" value={chosen.id} /><button className="px-2 text-sm text-red-400">Remove</button></form>
        </div>

        {isContributor && (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-bold">Ranked by</span>
            <Link href={`/teams?league=${chosen.id}`} className={`gl-pill ${source === "mine" ? "on" : ""}`}>My rankings</Link>
            <Link href={`/teams?league=${chosen.id}&src=consensus`} className={`gl-pill ${source === "consensus" ? "on" : ""}`}>Ball Knowers Consensus</Link>
          </div>
        )}
        {source === "mine" && !mySet && <p className="text-xs text-zinc-500">You don&apos;t have a list for {LABEL[chosen.format]} · {LABEL[chosen.scoring]} · {LABEL[chosen.qb_type]} yet, so this uses the consensus.</p>}
        {usingFallback && mySet && <p className="text-xs text-zinc-500">Players you haven&apos;t placed in your list yet use their consensus rank.</p>}

        {!list.length && <p className="text-sm text-zinc-400">No rosters stored for this league. Try refreshing.</p>}

        <TeamCards list={list} present={present} groupRank={groupRank} />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {hero}
      {str("error") && <p className="rounded-xl border border-red-900 bg-red-950 p-3 text-sm text-red-300">{str("error")}</p>}
      {str("msg") && <p className="rounded-xl border border-green-900 bg-green-950 p-3 text-sm text-green-300">{str("msg")}</p>}

      <div className="grid items-start gap-5 lg:grid-cols-[19rem_1fr]">
        <div className="space-y-4 lg:sticky lg:top-4">
          <div className="gl-panel space-y-3 p-4">
            <div className="flex items-center justify-between">
              <h3 className="text-2xl">Leagues <span className="ml-1 rounded-full bg-[#efe9dc] px-2 py-0.5 text-sm not-italic">{leagues.length}</span></h3>
            </div>
            {leagues.map((l) => (
              <Link key={l.id} href={`/teams?league=${l.id}`} className={`block rounded-xl border p-3 ${chosen?.id === l.id ? "gl-src-on" : "border-zinc-800 bg-[#fffdf8]"}`}>
                <span className="block font-bold">{l.name}</span>
                <span className="block text-xs text-zinc-400">{PLATFORM[l.platform] ?? l.platform} · {LABEL[l.format]} · {LABEL[l.scoring]} · {LABEL[l.qb_type]}</span>
              </Link>
            ))}
            {!leagues.length && <p className="text-sm text-zinc-400">No leagues synced yet.</p>}
            <details open={!leagues.length} className="rounded-xl border border-zinc-800 bg-[#fffdf8] p-3">
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
