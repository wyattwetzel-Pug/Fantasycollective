import { Avatar } from "@/app/avatar";
import { Suspense } from "react";
import { PlayerLink } from "@/app/player-link";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { nowMs } from "@/lib/time";

type Top = {
  player_id: number; position_in_list: number; consensus_rank: number;
  players: { name: string; position: string; nfl_team: string | null } | null;
};
type NewsRow = { id: number; headline: string; body: string | null; published_at: string };

const DAY = 24 * 60 * 60 * 1000;
const COMBO = { format: "redraft", scoring: "ppr", qb_type: "1qb" };

async function HomeView() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: top } = await supabase
    .from("consensus_current")
    .select("player_id, position_in_list, consensus_rank, players(name, position, nfl_team)")
    .match(COMBO).order("position_in_list").limit(5)
    .returns<Top[]>();

  const { count: total } = await supabase
    .from("consensus_current").select("player_id", { count: "exact", head: true }).match(COMBO);

  const { data: sets } = await supabase
    .from("ranking_sets").select("updated_at").eq("published", true);
  const contributors = (sets ?? []).filter((s) => nowMs() - new Date(s.updated_at).getTime() < 7 * DAY).length;

  const { data: news } = await supabase
    .from("news").select("id, headline, body, published_at").order("published_at", { ascending: false }).limit(1)
    .returns<NewsRow[]>();

  const season = new Date().getFullYear();
  const story = news?.[0];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex-1" />
        <Link href="/teams" className="gl-pill on-o !px-5 !py-2.5">⟳ Sync League</Link>
      </div>

      <div className="gl-hero grid min-h-[15rem] items-center gap-4 p-6 sm:p-8">
        <div>
          <h2 id="h-home" className="gl-title text-5xl sm:text-6xl">Fantasy Football</h2>
          <p className="mt-4 text-sm italic tracking-[0.3em] text-zinc-300">RESEARCH. RANKINGS. ADVANTAGE.</p>
          <div className="mt-3 h-1 w-56 rounded" style={{ background: "linear-gradient(90deg,#55745D,transparent)" }} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Link href="/rankings" className="gl-quick on"><span aria-hidden="true">▮</span><span className="flex-1 text-left">Player Rankings</span><span aria-hidden="true">›</span></Link>
        <Link href="/startsit" className="gl-quick"><span aria-hidden="true">▷</span><span className="flex-1 text-left">Start / Sit</span><span aria-hidden="true">›</span></Link>
        <Link href="/trade" className="gl-quick"><span aria-hidden="true">⇄</span><span className="flex-1 text-left">Trade Calculator</span><span aria-hidden="true">›</span></Link>
        <Link href="/teams" className="gl-quick"><span aria-hidden="true">⟳</span><span className="flex-1 text-left">Sync League</span><span aria-hidden="true">›</span></Link>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="gl-panel p-4">
          <div className="mb-3 flex items-start justify-between">
            <div>
              <h3 className="font-bold">🏆 Top Ranked Players</h3>
              <p className="text-xs text-zinc-500">{season} Season · Redraft · PPR · 1 QB</p>
            </div>
            <Link href="/rankings" className="text-xs" style={{ color: "var(--accent)" }}>View All →</Link>
          </div>
          {top?.length ? (
            <ol className="space-y-2">
              {top.map((r) => (
                <li key={r.position_in_list} className="flex items-center gap-3 text-sm">
                  <span className="h-7 w-7 rounded bg-zinc-800 text-center text-xs leading-7">{r.position_in_list}</span>
                  <Avatar id={r.player_id} name={r.players?.name} size={32} />
                  <span className="flex-1"><PlayerLink id={r.player_id} name={r.players?.name} /></span>
                  <span className={`bd ${r.players?.position}`}>{r.players?.position}</span>
                </li>
              ))}
            </ol>
          ) : <p className="text-sm text-zinc-400">No published rankings yet.</p>}
        </div>

        <div className="gl-panel p-4">
          <div className="mb-3">
            <h3 className="font-bold">↗ Biggest Movers</h3>
            <p className="text-xs text-zinc-500">Since last week</p>
          </div>
          <p className="text-sm text-zinc-400">Movers show up once rankings have a week of history to compare.</p>
        </div>

        <div className="gl-panel p-4">
          <div className="mb-3"><h3 className="font-bold">▤ Latest News</h3></div>
          {story ? (
            <div>
              <p className="font-semibold leading-snug">{story.headline}</p>
              {story.body && <p className="mt-2 text-xs text-zinc-400">{story.body}</p>}
            </div>
          ) : <p className="text-sm text-zinc-400">No news yet.</p>}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <div className="gl-stat"><span className="text-2xl font-extrabold italic">{total ?? 0}</span><span className="text-sm">Player Rankings</span></div>
        <div className="gl-stat"><span className="text-2xl font-extrabold italic">{contributors}</span><span className="text-sm">Contributors</span></div>
        <div className="gl-stat"><span className="text-2xl font-extrabold italic">{season}</span><span className="text-sm">Season</span></div>
      </div>

      {!user && (
        <p className="text-center text-xs text-zinc-500">
          Already have an account? <Link href="/login" className="underline">Log in</Link>
        </p>
      )}
    </div>
  );
}

export default function Home() {
  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-5 md:px-10 md:py-8">
      <Suspense fallback={<p className="text-zinc-400">Loading...</p>}>
        <HomeView />
      </Suspense>
    </main>
  );
}
