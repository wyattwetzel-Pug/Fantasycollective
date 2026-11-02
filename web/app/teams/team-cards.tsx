import { Avatar } from "@/app/avatar";
import { PlayerLink } from "@/app/player-link";

export type TeamPlayer = { id: number; name: string; pos: string; slot: string; rank: { rank: number; tier: string | null } | undefined; value: number };
export type TeamRow = { name: string; mine: boolean; players: TeamPlayer[]; group: Record<string, number>; total: number };

const POS_COLOR: Record<string, string> = { QB: "#b99aff", RB: "#5db4ff", WR: "#ff74b4", TE: "#ffb457", K: "#63d6bc", DEF: "#c9c4b8" };
const TIER_COLORS: Record<string, string> = { S: "#D4A72C", A: "#43B02A", B: "#2F7BEA", C: "#8B5CF6", D: "#E0A800", E: "#F28C28", F: "#E5484D" };
const posName = (p: string) => (p === "DEF" ? "DST" : p);

// Every team in a league, strongest first. Click a team to open its roster by position.
export function TeamCards({ list, present, groupRank }: { list: TeamRow[]; present: readonly string[]; groupRank: Map<string, number> }) {
  return (
        <div className="space-y-4">
      {list.map((t, i) => (
        <details key={t.name} open={t.mine} className="gl-panel group overflow-hidden">
          <summary className="cursor-pointer list-none p-4 sm:p-5">
            <div className="flex flex-wrap items-center gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#2f2e2b] font-bold text-white">{i + 1}</span>
              <span className="min-w-[10rem] flex-1">
                <span className="block text-lg font-bold">{t.name}{t.mine && <span className="ml-2 rounded-full px-2 py-0.5 text-xs font-bold text-white" style={{ background: "var(--accent)" }}>You</span>}</span>
                <span className="block text-xs text-zinc-400">{t.players.length} players · roster value {t.total.toFixed(0)}</span>
              </span>
              <span className="hidden flex-wrap gap-1.5 md:flex">
                {present.map((pos) => (
                  <span key={pos} className="rounded-full border px-2.5 py-0.5 text-xs font-semibold" style={{ borderColor: POS_COLOR[pos], background: `${POS_COLOR[pos]}33` }}>
                    {posName(pos)} {groupRank.get(`${t.name}|${pos}`)}
                  </span>
                ))}
              </span>
              <span className="text-zinc-400 transition-transform group-open:rotate-180" aria-hidden="true">▾</span>
            </div>
            <div className="mt-3 flex h-6 overflow-hidden rounded-md bg-[#e6dfd1]" role="img" aria-label="Share of roster value by position">
              {present.filter((pos) => (t.group[pos] ?? 0) > 0).map((pos) => (
                <span key={pos} className="flex items-center justify-center text-[11px] font-bold" style={{ width: `${((t.group[pos] ?? 0) / Math.max(1, t.total)) * 100}%`, background: POS_COLOR[pos] }}>
                  {groupRank.get(`${t.name}|${pos}`)}
                </span>
              ))}
            </div>
          </summary>

          <div className="grid gap-4 border-t border-zinc-800 p-4 sm:p-5" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(13rem,1fr))" }}>
            {present.map((pos) => {
              const rows = t.players.filter((p) => p.pos === pos)
                .sort((a, b) => (a.rank?.rank ?? 9999) - (b.rank?.rank ?? 9999));
              if (!rows.length) return null;
              return (
                <div key={pos}>
                  <p className="mb-2 inline-block rounded-full border px-3 py-0.5 text-xs font-bold" style={{ borderColor: POS_COLOR[pos], background: `${POS_COLOR[pos]}33` }}>
                    {posName(pos)} Rank: {groupRank.get(`${t.name}|${pos}`)}
                  </p>
                  <ul className="space-y-1.5">
                    {rows.map((p) => {
                      const tc = p.rank?.tier ? TIER_COLORS[p.rank.tier] : undefined;
                      return (
                        <li key={p.id} className="flex items-center gap-2 rounded-xl border border-zinc-800 bg-[#fffdf8] p-1.5">
                          <Avatar id={p.id} name={p.name} size={32} />
                          <span className="min-w-0 flex-1 truncate text-sm"><PlayerLink id={p.id} name={p.name} />{p.slot === "ir" && <span className="ml-1 text-[10px] text-zinc-400">IR</span>}</span>
                          <span className="min-w-[2.2rem] rounded-md px-1.5 py-0.5 text-center text-xs font-bold" style={tc ? { background: `${tc}33`, color: "var(--ink)", border: `1px solid ${tc}` } : { background: "#efe9dc" }}>
                            {p.rank ? p.rank.rank : "–"}
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
