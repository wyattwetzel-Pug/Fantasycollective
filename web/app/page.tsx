import { sessionUser } from "@/lib/session";
import { Avatar } from "@/app/avatar";
import { Suspense } from "react";
import { PlayerLink } from "@/app/player-link";
import Link from "next/link";
import { nowMs } from "@/lib/time";
import { homeData } from "@/lib/cached";
import { TopScorers } from "./top-scorers";

async function HomeView() {
  const user = await sessionUser();
  const { top, risers, fallers, scorers, hasHistory, total, contributors, stories } = await homeData();
  const season = new Date().getFullYear();
  const timeAgo = (iso: string) => {
    const mins = Math.max(1, Math.round((nowMs() - new Date(iso).getTime()) / 60000));
    return mins < 60 ? `${mins}m ago` : mins < 1440 ? `${Math.round(mins / 60)}h ago` : `${Math.round(mins / 1440)}d ago`;
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex-1" />
        <Link href="/teams" className="gl-pill on-o !px-5 !py-2.5">⟳ Sync League</Link>
      </div>

      <div className="gl-hero grid min-h-[15rem] items-center gap-4 p-6 sm:p-8 md:grid-cols-[1fr_auto]">
        <div>
          <h2 id="h-home" className="gl-title text-5xl sm:text-6xl">Fantasy Football</h2>
          <p className="mt-4 text-sm italic tracking-[0.3em] text-zinc-300">RESEARCH. RANKINGS. ADVANTAGE.</p>
          <div className="mt-3 h-1 w-56 rounded" style={{ background: "linear-gradient(90deg,#55745D,transparent)" }} />
        </div>
        <TopScorers items={scorers} />
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Link href="/rankings" className="gl-quick on"><span aria-hidden="true">▮</span><span className="flex-1 text-left">Player Rankings</span><span aria-hidden="true">›</span></Link>
        <Link href="/startsit" className="gl-quick"><span aria-hidden="true">▷</span><span className="flex-1 text-left">Start / Sit</span><span aria-hidden="true">›</span></Link>
        <Link href="/trade" className="gl-quick"><span aria-hidden="true">⇄</span><span className="flex-1 text-left">Trade Calculator</span><span aria-hidden="true">›</span></Link>
        <Link href="/teams" className="gl-quick"><span aria-hidden="true">⟳</span><span className="flex-1 text-left">Sync League</span><span aria-hidden="true">›</span></Link>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="gl-panel flex flex-col p-4">
          <div className="mb-3 flex items-start justify-between">
            <div>
              <h3 className="font-bold">🏆 Top Ranked Players</h3>
              <p className="text-xs text-zinc-500">{season} Season · Redraft · PPR · 1 QB</p>
            </div>
            <Link href="/rankings" className="text-xs" style={{ color: "var(--accent)" }}>View All →</Link>
          </div>
          {top?.length ? (
            <div className="lg:relative lg:min-h-[18rem] lg:flex-1">
            <ol className="space-y-2 max-lg:[&>li:nth-child(n+11)]:hidden lg:absolute lg:inset-0 lg:overflow-hidden lg:[mask-image:linear-gradient(to_bottom,#000_88%,transparent)]">
              {top.map((r, i) => (
                <li key={r.position_in_list} className="flex items-center gap-3 text-sm">
                  <span className="h-7 w-7 rounded bg-zinc-800 text-center text-xs leading-7">{i + 1}</span>
                  <Avatar id={r.player_id} name={r.name} size={32} />
                  <span className="flex-1"><PlayerLink id={r.player_id} name={r.name} /></span>
                  <span className={`bd ${r.position}`}>{r.position}</span>
                </li>
              ))}
            </ol>
            </div>
          ) : <p className="text-sm text-zinc-400">No published rankings yet.</p>}
        </div>

        <div className="gl-panel p-4">
          <div className="mb-3">
            <h3 className="font-bold">↗ Biggest Movers</h3>
            <p className="text-xs text-zinc-500">Since last week</p>
          </div>
          {risers.length || fallers.length ? (
            <ul className="space-y-2">
              {[...risers, ...fallers].map((m) => (
                <li key={m.id} className="flex items-center gap-3 text-sm">
                  <Avatar id={m.id} name={m.name} size={32} />
                  <span className="flex-1"><PlayerLink id={m.id} name={m.name} /><span className="block text-xs text-zinc-500">Now #{m.now}</span></span>
                  <span className={`bd ${m.pos}`}>{m.pos}</span>
                  <span className="w-12 text-right text-sm font-bold" style={{ color: m.change > 0 ? "#4a9d2f" : "#d92d20" }}>{m.change > 0 ? "▲" : "▼"} {Math.abs(m.change)}</span>
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-zinc-400">{hasHistory ? "No changes in the rankings since last week." : "Movers show up once rankings have a week of history to compare."}</p>}
        </div>

        <div className="gl-panel p-4">
          <div className="mb-3"><h3 className="font-bold">▤ Latest News</h3></div>
          {stories.length ? (
            <ul className="space-y-3">
              {stories.map((n) => (
                <li key={n.external_id ?? n.id}>
                  {n.url
                    ? <a href={n.url} target="_blank" rel="noopener noreferrer" className="font-semibold leading-snug hover:underline">{n.headline}</a>
                    : <p className="font-semibold leading-snug">{n.headline}</p>}
                  {n.body && <p className="mt-0.5 line-clamp-2 text-xs text-zinc-400">{n.body}</p>}
                  <p className="mt-0.5 text-[11px] text-zinc-500">{n.source ? `${n.source} · ` : ""}{timeAgo(n.published_at)}</p>
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-zinc-400">No news yet.</p>}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <div className="gl-stat"><span className="text-2xl font-extrabold italic">{total}</span><span className="text-sm">Player Rankings</span></div>
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
