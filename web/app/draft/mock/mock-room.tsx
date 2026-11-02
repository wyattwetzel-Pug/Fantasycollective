"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

export type P = { id: number; name: string; position: string; team: string; rank: number };
export type Slots = { QB: number; RB: number; WR: number; TE: number; FLEX: number; SUPERFLEX: number; K: number; DEF: number };

const POSITIONS = ["All", "QB", "RB", "WR", "TE", "K", "DEF"];

export function MockRoom({
  players, teams, rounds, slot, slots, bench, backHref,
}: { players: P[]; teams: number; rounds: number; slot: number; slots: Slots; bench: number; backHref: string }) {
  const [picks, setPicks] = useState<{ playerId: number; team: number }[]>([]);
  const [pos, setPos] = useState("All");
  const [query, setQuery] = useState("");

  const total = teams * rounds;
  const overall = picks.length;
  const done = overall >= total;
  const teamAt = (o: number) => (Math.floor(o / teams) % 2 === 0 ? (o % teams) + 1 : teams - (o % teams));
  const onClock = done ? 0 : teamAt(overall);
  const myTurn = !done && onClock === slot;

  const byId = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);
  const taken = useMemo(() => new Set(picks.map((p) => p.playerId)), [picks]);
  const available = useMemo(() => players.filter((p) => !taken.has(p.id)), [players, taken]);

  function countsFor(team: number) {
    const c: Record<string, number> = {};
    picks.forEach((k) => { if (k.team === team) { const pl = byId.get(k.playerId); if (pl) c[pl.position] = (c[pl.position] ?? 0) + 1; } });
    return c;
  }

  // How many of a position a computer team is willing to take.
  function cap(position: string) {
    const flexOk = position === "RB" || position === "WR" || position === "TE";
    const base = slots[position as keyof Slots] ?? 0;
    return base + (flexOk ? slots.FLEX + 2 : 0) + (position === "QB" ? slots.SUPERFLEX + 1 : 0) + (position === "TE" ? -1 : 0);
  }

  function cpuChoice(): P | undefined {
    const c = countsFor(onClock);
    const round = Math.floor(overall / teams);
    const late = round >= rounds - Math.max(2, slots.K + slots.DEF);
    const eligible = available.filter((p) => {
      if ((p.position === "K" || p.position === "DEF") && !late) return false;
      return (c[p.position] ?? 0) < Math.max(cap(p.position), 1);
    });
    const pool = (eligible.length ? eligible : available).slice(0, 4);
    const weights = [0.55, 0.25, 0.12, 0.08];
    let roll = Math.random();
    for (let i = 0; i < pool.length; i++) { roll -= weights[i]; if (roll <= 0) return pool[i]; }
    return pool[0];
  }

  useEffect(() => {
    if (done || myTurn) return;
    const t = setTimeout(() => {
      const choice = cpuChoice();
      if (choice) setPicks((prev) => [...prev, { playerId: choice.id, team: onClock }]);
    }, 350);
    return () => clearTimeout(t);
    // cpuChoice reads current state; re-running per pick is intended.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overall, done, myTurn]);

  function draft(p: P) {
    if (!myTurn) return;
    setPicks((prev) => [...prev, { playerId: p.id, team: slot }]);
  }

  const mine = picks.filter((k) => k.team === slot).map((k) => byId.get(k.playerId)!).filter(Boolean);
  const q = query.trim().toLowerCase();
  const list = available.filter((p) => (pos === "All" || p.position === pos) && (!q || p.name.toLowerCase().includes(q)));
  const pill = (on: boolean) => `gl-pill text-xs ${on ? "on-o" : ""}`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link href={backHref} className="text-sm" style={{ color: "#7dff6a" }}>← Back to Draft setup</Link>
        <p className="text-sm text-zinc-300">
          {done ? "Draft complete" : <>Pick {overall + 1} of {total} · Round {Math.floor(overall / teams) + 1} · {myTurn ? <strong style={{ color: "#39ff14" }}>You&apos;re on the clock</strong> : `Team ${onClock} is picking...`}</>}
        </p>
        <button onClick={() => setPicks([])} className="gl-pill text-xs">⟳ Restart</button>
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-[1fr_22rem]">
        <div className="gl-panel overflow-x-auto p-3">
          <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${teams}, minmax(5.5rem, 1fr))`, minWidth: `${teams * 5.7}rem` }}>
            {Array.from({ length: teams }, (_, i) => (
              <div key={i} className={`pb-1 text-center text-xs ${i + 1 === slot ? "font-bold text-green-400" : "text-zinc-400"}`}>{i + 1 === slot ? "You" : `Team ${i + 1}`}</div>
            ))}
            {Array.from({ length: rounds }, (_, r) =>
              Array.from({ length: teams }, (_, t) => {
                const idx = r * teams + (r % 2 === 0 ? t : teams - 1 - t);
                const pk = picks[idx];
                const pl = pk ? byId.get(pk.playerId) : undefined;
                const current = idx === overall && !done;
                return (
                  <div key={`${r}-${t}`} className="min-h-[3.2rem] rounded p-1 text-[11px]"
                       style={{ border: `1px solid ${current ? "#39ff14" : t + 1 === slot ? "#2a8a1a" : "#1a2a1a"}`, background: current ? "#0f2a0f" : "#0a100a" }}>
                    <span className="block text-[9px] text-zinc-500">{r + 1}.{String((r % 2 === 0 ? t : teams - 1 - t) + 1).padStart(2, "0")}</span>
                    {pl && <><span className="pn block truncate">{pl.name}</span><span className={`bd !px-1 !text-[9px] ${pl.position}`}>{pl.position}</span></>}
                  </div>
                );
              }),
            )}
          </div>
        </div>

        <div className="space-y-4">
          <div className="gl-panel p-3">
            <h3 className="mb-2 font-bold">{done ? "Your team" : "Best available"}</h3>
            {!done && (
              <>
                <div className="mb-2 flex flex-wrap gap-1">
                  {POSITIONS.map((p) => <button key={p} onClick={() => setPos(p)} className={pill(pos === p)}>{p}</button>)}
                </div>
                <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search players" className="gl-search mb-2 !py-1.5 !text-xs" />
                <ul className="max-h-[26rem] space-y-1 overflow-y-auto">
                  {list.slice(0, 60).map((p) => (
                    <li key={p.id} className="flex items-center gap-2 rounded border border-zinc-800 p-1.5 text-sm">
                      <span className="w-7 text-center text-xs text-zinc-500">{p.rank}</span>
                      <span className="pn min-w-0 flex-1 truncate">{p.name}</span>
                      <span className={`bd ${p.position}`}>{p.position}</span>
                      <button disabled={!myTurn} onClick={() => draft(p)} className="rounded bg-green-500 px-2 py-0.5 text-xs font-semibold text-black disabled:opacity-30">Draft</button>
                    </li>
                  ))}
                </ul>
              </>
            )}
            {done && <p className="text-sm text-zinc-400">All {total} picks are in. Restart to run it again.</p>}
          </div>

          <div className="gl-panel p-3">
            <h3 className="mb-2 font-bold">Your roster ({mine.length}/{rounds})</h3>
            {mine.length ? (
              <ul className="space-y-1 text-sm">
                {mine.map((p) => (
                  <li key={p.id} className="flex items-center gap-2"><span className={`bd ${p.position}`}>{p.position}</span><span className="pn">{p.name}</span><span className="ml-auto text-xs text-zinc-500">{p.team}</span></li>
                ))}
              </ul>
            ) : <p className="text-sm text-zinc-400">No picks yet.</p>}
            <p className="mt-2 text-xs text-zinc-500">Starters: QB {slots.QB}, RB {slots.RB}, WR {slots.WR}, TE {slots.TE}, FLEX {slots.FLEX}, SF {slots.SUPERFLEX}, K {slots.K}, DEF {slots.DEF}, bench {bench}.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
