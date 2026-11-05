import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { fetchAll } from "@/lib/fetch-all";

// Rotoworld (NBC Sports) player news from their public RSS feed: short fantasy notes like
// "Kyle Monangai (thumb/toe) still not practicing". Saved to the same news table as the ESPN stories,
// against the players the note names, so they show on the Home page and on those players' News tabs.
const FEED = "https://www.nbcsports.com/fantasy/football/player-news.rss";

export type RotoItem = { guid: string; title: string; description: string; url: string; published: string };

const decode = (s: string) => {
  // The feed escapes its text twice (&amp;apos;), so decode until nothing changes.
  let cur = s;
  for (let i = 0; i < 3; i++) {
    const next = cur.replace(/&apos;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
    if (next === cur) break;
    cur = next;
  }
  return cur.trim();
};

export function parseRotoworld(xml: string): RotoItem[] {
  const tag = (block: string, name: string) => {
    const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`));
    return m ? decode(m[1].replace(/^\s*<!\[CDATA\[|\]\]>\s*$/g, "")) : "";
  };
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].flatMap((m) => {
    const b = m[1];
    const date = new Date(tag(b, "pubDate"));
    const item = { guid: tag(b, "guid"), title: tag(b, "title"), description: tag(b, "description"), url: tag(b, "link"), published: date.toISOString() };
    return item.guid && item.title && item.url && !Number.isNaN(date.getTime()) ? [item] : [];
  });
}

const plain = (n: string) => n.toLowerCase().replace(/\b(jr|sr|ii|iii|iv|v)\b\.?/g, "").replace(/[^a-z]/g, "");

export async function syncRotoworld(db: SupabaseClient, log: string[]) {
  try {
    const res = await fetch(FEED, { cache: "no-store", headers: { "user-agent": "Mozilla/5.0" } });
    if (!res.ok) { log.push(`Rotoworld skipped: HTTP ${res.status}`); return; }
    const items = parseRotoworld(await res.text());
    if (!items.length) return;

    const ids = items.map((i) => `rw:${i.guid}`);
    const { data: have } = await db.from("news").select("external_id").in("external_id", ids);
    const known = new Set((have ?? []).map((r) => r.external_id as string));
    const fresh = items.filter((i) => !known.has(`rw:${i.guid}`));
    if (!fresh.length) return;

    const ours = await fetchAll<{ id: number; name: string; nfl_team: string | null }>((a, b) => db.from("players").select("id, name, nfl_team").order("id").range(a, b));
    const index = ours.map((p) => ({ id: p.id as number, key: plain(p.name as string), team: p.nfl_team as string | null })).filter((p) => p.key.length >= 7);

    const rows: Record<string, unknown>[] = [];
    for (const i of fresh) {
      const text = plain(`${i.title} ${i.description}`);
      // The players the note names, in the order they appear (a headline's first name is the subject).
      const matched = index.map((p) => ({ p, at: text.indexOf(p.key) })).filter((x) => x.at >= 0).sort((a, b) => a.at - b.at).slice(0, 2).map((x) => x.p);
      const base = {
        headline: i.title, body: i.description || null, url: i.url, source: "Rotoworld", external_id: `rw:${i.guid}`,
        published_at: i.published, teams: [...new Set(matched.map((m) => m.team).filter((t): t is string => !!t))],
      };
      if (matched.length) matched.forEach((m) => rows.push({ ...base, player_id: m.id })); else rows.push({ ...base, player_id: null });
    }
    const { error } = await db.from("news").insert(rows);
    if (error) { log.push(`Rotoworld skipped: ${error.message}`); return; }
    log.push(`Rotoworld: ${fresh.length} new notes.`);
  } catch (e) {
    log.push(`Rotoworld skipped: ${e instanceof Error ? e.message : String(e)}`);
  }
}

// Called as people open the Home page, so new notes appear within minutes without a scheduled job
// (the hosting plan only runs those once a day). At most one refresh per server instance every 10 minutes.
let lastRun = 0;
export async function refreshRotoworld() {
  const now = Date.now();
  if (now - lastRun < 10 * 60 * 1000) return;
  lastRun = now;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return;
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  await syncRotoworld(db, []);
}
