import { Suspense } from "react";
import { redirect } from "next/navigation";
import { serviceClient } from "@/lib/supabase/service";
import { sessionUser, profileOf } from "@/lib/session";
import { fetchAll } from "@/lib/fetch-all";
import { nowMs } from "@/lib/time";

export const metadata = { title: "Site Stats | FantasyForecast" };

type Ev = { created_at: string; kind: "view" | "login" | "signup"; path: string | null; user_id: string | null; visitor_id: string | null };
type Prof = { id: string; display_name: string; role: string; is_admin: boolean };
type League = { user_id: string; platform: string; synced_at: string | null };
type Rost = { player_id: number };

const DAY = 86_400_000;
const TZ = "America/New_York";
const dayKey = (d: Date | string) => new Date(d).toLocaleDateString("en-CA", { timeZone: TZ });
const ago = (iso: string | null) => {
  if (!iso) return "never";
  const s = (nowMs() - new Date(iso).getTime()) / 1000;
  if (s < 90) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} hr ago`;
  return `${Math.round(s / 86400)} d ago`;
};

function Tile({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="gl-panel p-4">
      <p className="text-xs font-bold uppercase tracking-wider text-zinc-400">{label}</p>
      <p className="mt-1 text-3xl font-bold">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-zinc-400">{sub}</p>}
    </div>
  );
}

async function Stats() {
  const user = await sessionUser();
  if (!user) redirect("/login");
  const me = await profileOf(user.id);
  if (!me?.is_admin) redirect("/rankings");

  const db = serviceClient();
  if (!db) return <p className="gl-panel p-4 text-sm text-zinc-300">SUPABASE_SERVICE_ROLE_KEY isn&apos;t set here, so the stats can&apos;t be read. They work on the live site.</p>;

  const since = new Date(nowMs() - 30 * DAY).toISOString();
  const [events, auth, profiles, leagues, rosterRows, sets] = await Promise.all([
    fetchAll<Ev>((a, b) => db.from("site_events").select("created_at, kind, path, user_id, visitor_id").gte("created_at", since).order("created_at", { ascending: false }).range(a, b).returns<Ev[]>()),
    (async () => {
      const out: { id: string; email?: string; created_at: string; last_sign_in_at?: string }[] = [];
      for (let page = 1; page <= 20; page++) {
        const { data } = await db.auth.admin.listUsers({ page, perPage: 1000 });
        out.push(...(data?.users ?? []));
        if ((data?.users.length ?? 0) < 1000) break;
      }
      return out;
    })(),
    fetchAll<Prof>((a, b) => db.from("profiles").select("id, display_name, role, is_admin").range(a, b).returns<Prof[]>()),
    fetchAll<League>((a, b) => db.from("leagues").select("user_id, platform, synced_at").range(a, b).returns<League[]>()),
    fetchAll<Rost>((a, b) => db.from("league_rosters").select("player_id").eq("is_mine", true).range(a, b).returns<Rost[]>()),
    db.from("ranking_sets").select("id", { count: "exact", head: true }).eq("published", true),
  ]);

  const profOf = new Map(profiles.map((p) => [p.id, p]));
  const nameOf = (id: string | null) => (id ? profOf.get(id)?.display_name ?? "Someone" : "Visitor");
  const now = nowMs();
  const within = (iso: string, days: number) => now - new Date(iso).getTime() < days * DAY;
  const today = dayKey(new Date());

  const views = events.filter((e) => e.kind === "view");
  const logins = events.filter((e) => e.kind === "login");
  const uniq = (xs: Ev[]) => new Set(xs.map((e) => e.visitor_id ?? e.user_id ?? "").filter(Boolean)).size;

  // Per-day series for the last 14 days.
  const days = Array.from({ length: 14 }, (_, i) => dayKey(new Date(now - (13 - i) * DAY)));
  const perDay = days.map((d) => {
    const v = views.filter((e) => dayKey(e.created_at) === d);
    return { d, views: v.length, visitors: uniq(v), logins: logins.filter((e) => dayKey(e.created_at) === d).length };
  });
  const maxViews = Math.max(1, ...perDay.map((x) => x.views));

  // Top pages this week.
  const pageCount = new Map<string, number>();
  views.filter((e) => within(e.created_at, 7)).forEach((e) => pageCount.set(e.path ?? "/", (pageCount.get(e.path ?? "/") ?? 0) + 1));
  const topPages = [...pageCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);

  // Busiest hour of the day (Eastern).
  const byHour = Array.from({ length: 24 }, () => 0);
  views.forEach((e) => { byHour[Number(new Date(e.created_at).toLocaleString("en-US", { timeZone: TZ, hour: "numeric", hour12: false })) % 24]++; });
  const peak = byHour.indexOf(Math.max(...byHour));
  const hourLabel = (h: number) => `${h % 12 || 12}${h < 12 ? "am" : "pm"}`;

  // Accounts.
  const loginsBy = new Map<string, number>(), viewsBy = new Map<string, number>(), leaguesBy = new Map<string, number>();
  logins.forEach((e) => e.user_id && loginsBy.set(e.user_id, (loginsBy.get(e.user_id) ?? 0) + 1));
  views.forEach((e) => e.user_id && viewsBy.set(e.user_id, (viewsBy.get(e.user_id) ?? 0) + 1));
  leagues.forEach((l) => leaguesBy.set(l.user_id, (leaguesBy.get(l.user_id) ?? 0) + 1));
  const accounts = [...auth].sort((a, b) => (b.last_sign_in_at ?? "").localeCompare(a.last_sign_in_at ?? ""));
  const newWeek = auth.filter((u) => within(u.created_at, 7)).length;
  const activeWeek = auth.filter((u) => u.last_sign_in_at && within(u.last_sign_in_at, 7)).length;
  const contributors = profiles.filter((p) => p.role === "contributor").length;

  // Synced leagues and the players people actually roster.
  const platforms = new Map<string, number>();
  leagues.forEach((l) => platforms.set(l.platform, (platforms.get(l.platform) ?? 0) + 1));
  const rostered = new Map<number, number>();
  rosterRows.forEach((r) => rostered.set(r.player_id, (rostered.get(r.player_id) ?? 0) + 1));
  const topIds = [...rostered.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  const { data: topPlayers } = topIds.length ? await db.from("players").select("id, name, position, nfl_team").in("id", topIds.map(([id]) => id)) : { data: [] };
  const pinfo = new Map((topPlayers ?? []).map((p) => [p.id as number, p]));

  const feed = events.filter((e) => e.kind !== "view").slice(0, 15);
  const recentViews = events.filter((e) => e.kind === "view").slice(0, 10);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile label="Accounts" value={auth.length} sub={`${newWeek} new this week · ${contributors} contributors`} />
        <Tile label="Active this week" value={activeWeek} sub="signed in within 7 days" />
        <Tile label="Visitors today" value={uniq(views.filter((e) => dayKey(e.created_at) === today))} sub={`${views.filter((e) => dayKey(e.created_at) === today).length} page views`} />
        <Tile label="Logins this week" value={logins.filter((e) => within(e.created_at, 7)).length} sub={`${logins.length} in 30 days`} />
        <Tile label="Visitors (7 days)" value={uniq(views.filter((e) => within(e.created_at, 7)))} sub={`${views.filter((e) => within(e.created_at, 7)).length} page views`} />
        <Tile label="Synced leagues" value={leagues.length} sub={[...platforms.entries()].map(([p, n]) => `${n} ${p}`).join(" · ") || "none yet"} />
        <Tile label="Published lists" value={sets.count ?? 0} sub="contributor rankings" />
        <Tile label="Busiest hour" value={views.length ? hourLabel(peak) : "–"} sub="Eastern time, last 30 days" />
      </div>

      <section className="gl-panel p-4">
        <h2 className="mb-3 text-xl font-bold">Last 14 days</h2>
        <div className="flex h-40 items-end gap-1.5">
          {perDay.map((x) => (
            <div key={x.d} className="flex h-full flex-1 flex-col items-center justify-end gap-1" title={`${x.d}: ${x.views} views, ${x.visitors} visitors, ${x.logins} logins`}>
              <span className="text-[10px] text-zinc-400">{x.views || ""}</span>
              <div className="w-full rounded-t" style={{ height: `${(x.views / maxViews) * 100}%`, minHeight: x.views ? 3 : 1, background: x.d === today ? "var(--accent)" : "#55745D" }} />
              <span className="text-[10px] text-zinc-400">{x.d.slice(5)}</span>
            </div>
          ))}
        </div>
        <p className="mt-2 text-xs text-zinc-400">Page views per day (your own browsing isn&apos;t counted). Hover a bar for visitors and logins.</p>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="gl-panel p-4">
          <h2 className="mb-3 text-xl font-bold">Top pages this week</h2>
          {topPages.length ? (
            <ul className="space-y-1.5 text-sm">
              {topPages.map(([p, n]) => <li key={p} className="flex justify-between gap-3"><span className="truncate">{p}</span><span className="font-semibold">{n}</span></li>)}
            </ul>
          ) : <p className="text-sm text-zinc-400">No page views recorded yet. They start counting once this update is live.</p>}
        </section>

        <section className="gl-panel p-4">
          <h2 className="mb-3 text-xl font-bold">Most rostered players</h2>
          {topIds.length ? (
            <ul className="space-y-1.5 text-sm">
              {topIds.map(([id, n]) => { const p = pinfo.get(id); return <li key={id} className="flex justify-between gap-3"><span className="truncate">{p?.name ?? `#${id}`} <span className="text-zinc-400">{p?.position} {p?.nfl_team}</span></span><span className="font-semibold">{n} {n === 1 ? "team" : "teams"}</span></li>; })}
            </ul>
          ) : <p className="text-sm text-zinc-400">Nobody has synced a league yet.</p>}
        </section>
      </div>

      <section className="gl-panel p-4">
        <h2 className="mb-3 text-xl font-bold">Accounts</h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="text-xs uppercase tracking-wider text-zinc-400">
              <tr><th className="py-1 pr-3">Name</th><th className="pr-3">Email</th><th className="pr-3">Role</th><th className="pr-3">Joined</th><th className="pr-3">Last login</th><th className="pr-3 text-right">Logins (30d)</th><th className="pr-3 text-right">Page views (30d)</th><th className="text-right">Leagues</th></tr>
            </thead>
            <tbody>
              {accounts.map((u) => {
                const p = profOf.get(u.id);
                return (
                  <tr key={u.id} className="border-t border-[#DEDAD0]">
                    <td className="py-1.5 pr-3 font-semibold">{p?.display_name ?? "–"}</td>
                    <td className="pr-3">{u.email ?? "–"}</td>
                    <td className="pr-3">{p?.is_admin ? "admin" : p?.role === "contributor" ? "contributor" : "viewer"}</td>
                    <td className="pr-3">{new Date(u.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: TZ })}</td>
                    <td className="pr-3">{ago(u.last_sign_in_at ?? null)}</td>
                    <td className="pr-3 text-right">{loginsBy.get(u.id) ?? 0}</td>
                    <td className="pr-3 text-right">{viewsBy.get(u.id) ?? 0}</td>
                    <td className="text-right">{leaguesBy.get(u.id) ?? 0}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-zinc-400">Login and page-view counts begin when this update goes live. &quot;Last login&quot; comes from the login system and goes back further.</p>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="gl-panel p-4">
          <h2 className="mb-3 text-xl font-bold">Recent logins and sign-ups</h2>
          {feed.length ? (
            <ul className="space-y-1.5 text-sm">
              {feed.map((e, i) => <li key={i} className="flex justify-between gap-3"><span><b>{nameOf(e.user_id)}</b> {e.kind === "signup" ? "signed up" : "logged in"}</span><span className="text-zinc-400">{ago(e.created_at)}</span></li>)}
            </ul>
          ) : <p className="text-sm text-zinc-400">Nothing yet.</p>}
        </section>
        <section className="gl-panel p-4">
          <h2 className="mb-3 text-xl font-bold">Live page views</h2>
          {recentViews.length ? (
            <ul className="space-y-1.5 text-sm">
              {recentViews.map((e, i) => <li key={i} className="flex justify-between gap-3"><span className="truncate"><b>{nameOf(e.user_id)}</b> opened {e.path}</span><span className="shrink-0 text-zinc-400">{ago(e.created_at)}</span></li>)}
            </ul>
          ) : <p className="text-sm text-zinc-400">Nothing yet.</p>}
        </section>
      </div>
    </div>
  );
}

export default function StatsPage() {
  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-5 md:px-10 md:py-8">
      <p className="mb-1 text-xs tracking-[0.4em] text-zinc-400">ADMIN ONLY</p>
      <h1 className="gl-title mb-5 text-4xl sm:text-5xl">Site <span style={{ color: "var(--accent)" }}>Stats</span></h1>
      <Suspense fallback={<p className="text-zinc-400">Loading...</p>}>
        <Stats />
      </Suspense>
    </main>
  );
}
