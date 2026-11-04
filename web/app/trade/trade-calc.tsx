"use client";

import { Avatar } from "@/app/avatar";
import { useEffect, useMemo, useState } from "react";
import { PlayerLink } from "@/app/player-link";
import type { ReactNode } from "react";

export type P = { id: number; name: string; position: string; team: string; rank: number; posRank: number; tier: string | null; owner: string | null; mine: boolean };

// Value of one player, from his consensus rank: rank 1 = 100, falling about 3.5% per spot.
const value = (rank: number) => 100 * Math.exp(-0.035 * (rank - 1));
// One star is worth more than several role players that add up to the same raw value.
const side = (list: P[]) => list.reduce((sum, p) => sum + Math.pow(value(p.rank), 1.35) / Math.pow(100, 0.35), 0);
const fmt = (n: number) => n.toFixed(1);
const MAX = 4;
const short = (name: string) => { const w = name.split(/\s+/); return w.length > 1 ? `${w[0][0]}. ${w.slice(1).join(" ")}` : name; };

function Picker({ pool, taken, onPick, label }: { pool: P[]; taken: Set<number>; onPick: (p: P) => void; label: string }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const matches = useMemo(() => {
    const s = q.trim().toLowerCase();
    return pool.filter((p) => !taken.has(p.id) && (!s || p.name.toLowerCase().includes(s))).sort((a, b) => a.rank - b.rank).slice(0, 12);
  }, [pool, taken, q]);

  return (
    <div className="relative min-w-[11rem] flex-1">
      <input
        value={q} placeholder={label} aria-label={label}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
        className="w-full rounded-full border border-dashed border-zinc-600 bg-black px-4 py-2.5 text-sm"
      />
      {open && matches.length > 0 && (
        <ul className="absolute z-20 mt-1 max-h-72 w-full min-w-[17rem] overflow-y-auto rounded-lg border border-zinc-700 bg-zinc-950 shadow-xl">
          {matches.map((p) => (
            <li key={p.id}>
              <button type="button" className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-zinc-800"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => { onPick(p); setQ(""); setOpen(false); }}>
                <Avatar id={p.id} name={p.name} size={26} />
                <span className="pn flex-1 truncate">{p.name}</span>
                <span className={`bd ${p.position}`}>{p.position}</span>
                <span className="w-24 truncate text-right text-xs text-zinc-400">{p.owner ?? (p.team || "FA")}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SideCard({ title, total, list, pool, taken, onAdd, onRemove, extra, label }: {
  title: string; total: number; list: P[]; pool: P[]; taken: Set<number>; onAdd: (p: P) => void; onRemove: (id: number) => void; extra?: ReactNode; label: string;
}) {
  return (
    <div className="gl-panel min-w-0 space-y-3 !rounded-3xl p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-xl font-extrabold">{title} <span className="text-zinc-300">({fmt(total)})</span></h3>
        {extra}
      </div>
      <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
        {list.map((p) => (
          <div key={p.id} className="group relative flex items-center gap-3">
            <Avatar id={p.id} name={p.name} size={56} />
            <span className="min-w-0">
              <PlayerLink id={p.id} name={p.name} className="block truncate text-sm font-extrabold" />
              <span className="mt-1 flex items-center gap-2 text-xs text-zinc-400">
                <span className={`bd ${p.position}`}>{p.position}</span>{p.team || "FA"}
              </span>
            </span>
            <button className="absolute -right-3 -top-1 h-5 w-5 rounded-full bg-[#EDE9DF] text-[10px] opacity-60 hover:opacity-100" aria-label={`Remove ${p.name}`} onClick={() => onRemove(p.id)}>✕</button>
          </div>
        ))}
        {list.length < MAX && <Picker pool={pool} taken={taken} onPick={onAdd} label={label} />}
      </div>
    </div>
  );
}

// How a roster group changes: bar = strength after the trade, label = change from before.
function Impact({ label, before, after, cap, dark }: { label: string; before: number; after: number; cap: number; dark?: boolean }) {
  const d = (after - before) / Math.max(before, 1);
  const text = Math.abs(d) < 0.01 ? "No Change" : d > 0 ? (d > 0.1 ? "Upgrade" : "Slight ↑") : d < -0.1 ? "Downgrade" : "Slight ↓";
  const color = Math.abs(d) < 0.01 ? "inherit" : d > 0 ? "var(--accent)" : "#C0392B";
  const w = Math.max(6, Math.min(100, (after / cap) * 100));
  return (
    <div className="grid grid-cols-[5.5rem_1fr_5rem] items-center gap-3 text-sm">
      <span>{label}</span>
      <span className="h-3 overflow-hidden rounded-full bg-[#DEDAD0]"><span className="block h-full rounded-full" style={{ width: `${w}%`, background: dark ? "var(--accent)" : "#A9BDAF" }} /></span>
      <span className="text-right font-semibold" style={{ color }}>{text}</span>
    </div>
  );
}

type Saved = { id: number; give: number[]; get: number[] };
const KEY = "trade-saves";

export function TradeCalc({ players, intro, settings, synced, teams, lineup, weeks, sched }: {
  players: P[]; intro: ReactNode; settings: ReactNode; synced: boolean; teams: string[]; lineup: string[]; weeks: number[]; sched: Record<string, string[]>;
}) {
  const [give, setGive] = useState<P[]>([]);
  const [get, setGet] = useState<P[]>([]);
  const [partner, setPartner] = useState("");
  const [saved, setSaved] = useState<Saved[]>([]);
  const taken = useMemo(() => new Set([...give, ...get].map((p) => p.id)), [give, get]);

  useEffect(() => {
    try { setSaved(JSON.parse(localStorage.getItem(KEY) ?? "[]")); } catch { /* storage unavailable */ }
  }, []);
  const store = (next: Saved[]) => { setSaved(next); try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* storage unavailable */ } };

  // In a league you give your own players and get another team's.
  const givePool = useMemo(() => (synced ? players.filter((p) => p.mine) : players), [players, synced]);
  const getPool = useMemo(() => (synced ? players.filter((p) => p.owner && !p.mine && (!partner || p.owner === partner)) : players), [players, synced, partner]);

  const yours = side(give);   // what you send
  const theirs = side(get);   // what you receive
  const ready = give.length > 0 && get.length > 0;
  const net = theirs - yours;
  const pct = net / Math.max(theirs, yours, 1);
  const fair = Math.abs(pct) < 0.1;
  const verdict = !ready ? "Add Players" : fair ? "Fair Trade" : net > 0 ? "Good Trade" : "Bad Trade";
  const tone = !ready ? "#b9b0a0" : net < 0 && !fair ? "#C0392B" : "var(--accent)";
  const edge = !ready ? "Add at least one player to each side" : Math.abs(pct) < 0.005 ? "Dead even" : `${fair ? "Slight edge" : "Clear edge"} to ${net > 0 ? "your side" : "their side"}`;
  const diff = `${net > 0 ? "+" : net < 0 ? "−" : ""}${Math.abs(Math.round(pct * 100))}% difference`;

  // Roster impact, from your own synced roster before and after the trade.
  const rows = useMemo(() => {
    if (!synced) return [];
    const mine = players.filter((p) => p.mine);
    const after = [...mine.filter((p) => !give.some((g) => g.id === p.id)), ...get];
    const need = (pos: string) => lineup.filter((s) => s === pos).length + (["RB", "WR", "TE"].includes(pos) ? 1 : 0) + (pos === "QB" && lineup.includes("SUPERFLEX") ? 1 : 0);
    const depth = (list: P[], pos: string) => list.filter((p) => p.position === pos).map((p) => value(p.rank)).sort((a, b) => b - a).slice(0, Math.max(1, need(pos))).reduce((s, v) => s + v, 0);
    const star = (list: P[]) => list.map((p) => value(p.rank)).sort((a, b) => b - a).slice(0, 3).reduce((s, v) => s + v, 0);
    const involved = new Set([...give, ...get].map((p) => p.position));
    const out = ["QB", "RB", "WR", "TE"].filter((pos) => ["RB", "WR"].includes(pos) || involved.has(pos))
      .map((pos) => ({ label: `${pos} Depth`, before: depth(mine, pos), after: depth(after, pos), cap: Math.max(1, need(pos)) * 85, dark: false }));
    out.push({ label: "Star Power", before: star(mine), after: star(after), cap: 3 * 95, dark: true });
    return out;
  }, [synced, players, give, get, lineup]);

  const clear = () => { setGive([]); setGet([]); };
  const swap = () => { if (synced) return; setGive(get); setGet(give); };
  const save = () => { if (ready) store([{ id: Date.now(), give: give.map((p) => p.id), get: get.map((p) => p.id) }, ...saved].slice(0, 10)); };
  const load = (s: Saved) => {
    const by = new Map(players.map((p) => [p.id, p]));
    setGive(s.give.map((id) => by.get(id)).filter((p): p is P => !!p));
    setGet(s.get.map((id) => by.get(id)).filter((p): p is P => !!p));
  };
  const btn = "inline-flex items-center gap-2 rounded-full border border-zinc-800 bg-[#FBFAF6] px-5 py-2.5 text-sm font-bold";
  const trade = [...give, ...get];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        {intro}
        <div className="flex flex-wrap gap-2">
          {!synced && <button type="button" className={btn} onClick={swap}>⇄ Swap</button>}
          <button type="button" className={btn} onClick={clear}>↻ Clear</button>
          <button type="button" className={`${btn} !border-[#1f1f1f] !bg-[#1f1f1f] disabled:opacity-70`} style={{ color: "#fff" }} onClick={save} disabled={!ready}>🔖 Save Trade</button>
        </div>
      </div>

      {settings}

      <div className="grid items-center gap-3 lg:grid-cols-[1fr_auto_1fr]">
        <SideCard title="Your Side" total={yours} list={give} pool={givePool} taken={taken} label={synced ? "+ Add from your roster" : "+ Add a player"}
          onAdd={(p) => setGive((l) => [...l, p])} onRemove={(id) => setGive((l) => l.filter((p) => p.id !== id))} />
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-[#A9BDAF] text-2xl text-white" aria-hidden="true">→</span>
        <SideCard title="Their Side" total={theirs} list={get} pool={getPool} taken={taken} label={synced ? "+ Add their player" : "+ Add a player"}
          onAdd={(p) => setGet((l) => [...l, p])} onRemove={(id) => setGet((l) => l.filter((p) => p.id !== id))}
          extra={synced && teams.length > 0 ? (
            <select value={partner} onChange={(e) => setPartner(e.target.value)} aria-label="Trade partner" className="max-w-[10rem] rounded-full border border-zinc-800 bg-[#FBFAF6] px-3 py-1 text-xs">
              <option value="">Any team</option>
              {teams.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          ) : undefined} />
      </div>

      <div className="grid items-stretch gap-3 lg:grid-cols-[1fr_1.3fr_0.9fr]">
        <div className="gl-panel space-y-4 !rounded-3xl p-5">
          <h3 className="text-lg font-extrabold">Roster Impact</h3>
          {!synced ? <p className="text-sm text-zinc-400">Sync a league on My Teams to see how a trade changes your own roster.</p>
            : !ready ? <p className="text-sm text-zinc-400">Add players to both sides to see the change to your roster.</p>
            : rows.map((r) => <Impact key={r.label} {...r} />)}
        </div>

        <div className="gl-panel !rounded-3xl p-5">
          <h3 className="mb-3 text-lg font-extrabold">Upcoming Matchups <span className="text-sm font-semibold text-zinc-400">(Next {weeks.length || 3} Weeks)</span></h3>
          {trade.length ? (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-zinc-400">
                  <th className="pb-2 font-medium">Player</th>
                  {weeks.map((w) => <th key={w} className="pb-2 font-medium">Wk {w}</th>)}
                </tr>
              </thead>
              <tbody>
                {trade.map((p) => (
                  <tr key={p.id} className="border-t border-zinc-800">
                    <td className="py-2 font-bold">{short(p.name)}</td>
                    {weeks.map((w, i) => <td key={w} className="py-2">{sched[p.team]?.[i] ?? "–"}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p className="text-sm text-zinc-400">Add players to see their next games.</p>}
        </div>

        <div className="gl-panel flex flex-col items-center justify-center gap-2 !rounded-3xl p-5 text-center" aria-live="polite">
          <h3 className="self-start text-lg font-extrabold"><span aria-hidden="true">⚖</span> Verdict</h3>
          <p className={`gl-title font-extrabold ${ready ? "text-4xl sm:text-5xl" : "text-3xl"}`} style={{ color: tone }}>{verdict}</p>
          <p className="text-sm text-zinc-300">{edge}</p>
          {ready && <span className="mt-1 rounded-full bg-[#E6EBDF] px-6 py-2 text-lg font-extrabold">{diff}</span>}
        </div>
      </div>

      {saved.length > 0 && (
        <div className="gl-panel !rounded-3xl p-5">
          <h3 className="mb-2 text-lg font-extrabold">Saved Trades</h3>
          <ul className="space-y-1.5 text-sm">
            {saved.map((s) => {
              const by = new Map(players.map((p) => [p.id, p]));
              const nm = (ids: number[]) => ids.map((id) => by.get(id)?.name).filter(Boolean).join(", ");
              return (
                <li key={s.id} className="flex items-center gap-2">
                  <button type="button" className="min-w-0 flex-1 truncate text-left hover:underline" onClick={() => load(s)}>{nm(s.give)} <span className="text-zinc-400">for</span> {nm(s.get)}</button>
                  <button type="button" className="text-xs text-zinc-400" aria-label="Delete saved trade" onClick={() => store(saved.filter((x) => x.id !== s.id))}>✕</button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <p className="text-xs text-zinc-500">
        Each player&apos;s value comes from his Ball Knowers Consensus rank (rank 1 is worth 100, dropping about 3.5% per spot). Stars are weighted extra.
        Roster Impact compares your best players at each position before and after. Draft picks are not included yet.
      </p>
    </div>
  );
}
