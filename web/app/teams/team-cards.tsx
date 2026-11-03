import { TIER_COLORS } from "@/lib/tier-config";
import { Avatar } from "@/app/avatar";
import { PlayerLink } from "@/app/player-link";

export type TeamPlayer = { id: number; name: string; pos: string; slot: string; rank: { rank: number; tier: string | null } | undefined; posRank: number | null; value: number };
export type TeamRow = { name: string; mine: boolean; players: TeamPlayer[]; group: Record<string, number>; total: number; avg: number | null };

const POS_COLOR: Record<string, string> = { QB: "#4F7FD1", RB: "#4F7F5C", WR: "#8A63C7", TE: "#C95757", K: "#8B6B4A", DEF: "#8D8A80" };
const posName = (p: string) => (p === "DEF" ? "DST" : p);

// Every team in a league, strongest first. Click a team to open its roster by position.
export function TeamCards({ list, present, groupRank }: { list: TeamRow[]; present: readonly string[]; groupRank: Map<string, number> }) {
  return (
        <div className="space-y-2">
      {list.map((t, i) => (
        <details key={t.name} open={t.mine} className="gl-panel group overflow-hidden !rounded-xl">
          <summary className="cursor-pointer list-none px-3 py-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--bar)] text-xs font-bold text-[var(--bar-ink)]">{i + 1}</span>
              <span className="min-w-[8rem] flex-1">
                <span className="block text-sm font-bold">{t.name}{t.mine && <span className="ml-2 rounded-full px-1.5 text-[10px] font-bold text-[#fff]" style={{ background: "var(--accent)" }}>You</span>}</span>
                <span className="block text-[11px] leading-tight text-zinc-400">{t.avg === null ? "No ranked players" : `Avg position rank ${t.avg.toFixed(1)}`}</span>
              </span>
              <span className="hidden flex-wrap gap-1 md:flex">
                {present.map((pos) => (
                  <span key={pos} className="rounded-full border px-2 text-[11px] font-semibold leading-5" style={{ borderColor: POS_COLOR[pos], background: `${POS_COLOR[pos]}33` }}>
                    {posName(pos)} {groupRank.get(`${t.name}|${pos}`)}
                  </span>
                ))}
              </span>
              <span className="text-zinc-400 transition-transform group-open:rotate-180" aria-hidden="true">▾</span>
            </div>
            <div className="mt-1.5 flex h-3 overflow-hidden rounded bg-[#DEDAD0]" role="img" aria-label="Share of roster value by position">
              {present.filter((pos) => (t.group[pos] ?? 0) > 0).map((pos) => (
                <span key={pos} className="flex items-center justify-center text-[9px] font-bold leading-none" style={{ width: `${((t.group[pos] ?? 0) / Math.max(1, t.total)) * 100}%`, background: POS_COLOR[pos] }}>
                  {groupRank.get(`${t.name}|${pos}`)}
                </span>
              ))}
            </div>
          </summary>

          <div className="grid gap-3 border-t border-zinc-800 p-3" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(11rem,1fr))" }}>
            {present.map((pos) => {
              const rows = t.players.filter((p) => p.pos === pos)
                .sort((a, b) => (a.posRank ?? 9999) - (b.posRank ?? 9999));
              if (!rows.length) return null;
              return (
                <div key={pos}>
                  <p className="mb-1.5 inline-block rounded-full border px-2.5 text-[11px] font-bold leading-5" style={{ borderColor: POS_COLOR[pos], background: `${POS_COLOR[pos]}33` }}>
                    {posName(pos)} Rank: {groupRank.get(`${t.name}|${pos}`)}
                  </p>
                  <ul className="space-y-1">
                    {rows.map((p) => {
                      const tc = p.rank?.tier ? TIER_COLORS[p.rank.tier] : undefined;
                      return (
                        <li key={p.id} className="flex items-center gap-1.5 rounded-lg border border-zinc-800 bg-[#FBFAF6] p-1">
                          <Avatar id={p.id} name={p.name} size={24} />
                          <span className="min-w-0 flex-1 truncate text-xs"><PlayerLink id={p.id} name={p.name} />{p.slot === "ir" && <span className="ml-1 text-[10px] text-zinc-400">IR</span>}</span>
                          <span className="min-w-[2rem] rounded px-1 text-center text-[11px] font-bold leading-5" style={tc ? { background: `${tc}33`, color: "var(--ink)", border: `1px solid ${tc}` } : { background: "#EDE9DF" }}>
                            {p.posRank ?? "–"}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })}
          </div>
        </details>
      ))}
    </div>
  );
}
