"use client";

import { Avatar } from "@/app/avatar";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { TIER_COLORS } from "@/lib/tier-config";

export type PickerPlayer = { id: number; name: string; position: string; team: string; rank: number; posRank: number | null; tier: string | null };
type Base = Record<string, string>;

// The choice lives in the URL (?p=1,2,3) so the server can load the comparison.
// Quick clicks before the page has reloaded build on each other instead of on the old choice.
let pending: number[] | null = null;
const current = (selected: number[]) => pending ?? selected;

function useGo(base: Base, selected: number[]) {
  const router = useRouter();
  useEffect(() => { pending = null; }, [selected.join(",")]);
  return (ids: number[]) => {
    pending = ids;
    setTimeout(() => { pending = null; }, 2500);
    const qs = new URLSearchParams(base);
    if (ids.length) qs.set("p", ids.join(","));
    router.replace(`/startsit${qs.size ? `?${qs}` : ""}`, { scroll: false });
  };
}

const POSITIONS = ["All", "QB", "RB", "WR", "TE"];
const MAX = 4;

// Ranked players down the left side with a search box. Click a player to add or remove them.
export function PlayerList({ players, selected, base }: { players: PickerPlayer[]; selected: number[]; base: Base }) {
  const go = useGo(base, selected);
  const [q, setQ] = useState("");
  const [pos, setPos] = useState("All");
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return players.filter((p) => (pos === "All" || p.position === pos) && (!s || p.name.toLowerCase().includes(s))).slice(0, 120);
  }, [players, q, pos]);

  return (
    <div className="gl-panel flex max-h-[34rem] flex-col gap-3 p-3 lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)]">
      <div>
        <h3 className="text-lg font-bold">Players</h3>
        <p className="text-xs text-zinc-400">Pick 2-4 to compare.</p>
      </div>
      <input value={q} onChange={(e) => setQ(e.target.value)} type="search" placeholder="Search players..." aria-label="Search players" className="gl-search" />
      <div className="flex gap-1.5" role="group" aria-label="Position">
        {POSITIONS.map((p) => (
          <button key={p} type="button" onClick={() => setPos(p)} className={`gl-pill !rounded-full !px-3 !py-1 text-xs ${pos === p ? "on" : ""}`}>{p}</button>
        ))}
      </div>
      <ul className="-mx-1 min-h-0 flex-1 space-y-1 overflow-y-auto px-1">
        {shown.map((p) => {
          const on = selected.includes(p.id);
          const full = !on && selected.length >= MAX;
          return (
            <li key={p.id}>
              <button
                type="button" disabled={full}
                onClick={() => { const now = current(selected); go(now.includes(p.id) ? now.filter((x) => x !== p.id) : now.length >= MAX ? now : [...now, p.id]); }}
                className="flex w-full items-center gap-2 rounded-xl border p-1.5 text-left disabled:opacity-40"
                style={on ? { borderColor: "var(--accent)", background: "#EBF0E5" } : { borderColor: "#DEDAD0", background: "#FBFAF6" }}
              >
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-xs leading-none" style={{ borderColor: on ? "var(--accent)" : "#B9B5A9" }} aria-hidden="true">{on ? "✓" : "+"}</span>
                <Avatar id={p.id} name={p.name} size={36} />
                <span className="min-w-0 flex-1">
                  <span className="pn block truncate text-xs leading-tight">{p.rank ? `${p.rank}. ` : ""}{p.name}</span>
                  <span className="mt-0.5 flex items-center gap-1">
                    <span className={`bd !px-1.5 !text-[10px] ${p.position}`}>{p.position}{p.posRank ? ` ${p.posRank}` : ""}</span>
                    <span className="rounded bg-[#EDE9DF] px-1.5 text-[10px] font-semibold leading-4">{p.team || "FA"}</span>
                  </span>
                </span>
              </button>
            </li>
          );
        })}
        {!shown.length && <li className="p-2 text-xs text-zinc-400">Nobody matches that search.</li>}
      </ul>
    </div>
  );
}

// The chosen players as compact cards. The one the calculator says to start gets a START tab.
export function SelectedCards({ players, selected, base, startId }: { players: PickerPlayer[]; selected: number[]; base: Base; startId: number | null }) {
  const go = useGo(base, selected);
  const byId = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);
  if (!selected.length) {
    return <p className="rounded-xl border border-dashed border-zinc-600 p-6 text-center text-sm text-zinc-400">Pick players from the list to compare them.</p>;
  }
  return (
    <div className="grid grid-cols-2 items-stretch gap-3 sm:grid-cols-4">
      {selected.map((id) => {
        const p = byId.get(id);
        if (!p) return null;
        const start = startId === id;
        const tc = p.tier ? TIER_COLORS[p.tier] : undefined;
        return (
          <div key={id} className="relative flex flex-col pt-4">
            {start && <span className="absolute left-3 top-0 rounded-t-lg px-3 text-xs font-extrabold leading-4 tracking-wider" style={{ background: "var(--accent)", color: "#fff", paddingTop: 2 }}>START</span>}
            <div className="relative flex flex-1 flex-col items-center gap-1.5 rounded-xl border-2 p-3 text-center" style={{ borderColor: start ? "var(--accent)" : "#DEDAD0", background: start ? "#EBF0E5" : "#FBFAF6" }}>
              <button type="button" className="absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full bg-zinc-700 text-[10px]" aria-label={`Remove ${p.name}`} onClick={() => go(current(selected).filter((x) => x !== id))}>✕</button>
              <Avatar id={id} name={p.name} size={60} />
              <span className="pn block min-h-[2.4rem] text-sm leading-tight">{p.name}</span>
              <span className="flex flex-wrap items-center justify-center gap-1">
                <span className={`bd !px-1.5 !text-[10px] ${p.position}`}>{p.position}{p.posRank ? ` ${p.posRank}` : ""}</span>
                <span className="text-[11px] text-zinc-400">{p.team || "FA"}</span>
                {tc && <span className="rounded-full border px-1.5 text-[10px] font-bold" style={{ borderColor: tc, color: tc }}>{p.tier}</span>}
              </span>
              <span className="mt-auto text-[11px] text-zinc-400">{p.rank ? `Overall #${p.rank}` : "Not ranked"}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
