"use client";

import { Avatar } from "@/app/avatar";
import { useMemo, useState } from "react";
import { PlayerLink } from "@/app/player-link";
import type { ReactNode } from "react";

export type P = { id: number; name: string; position: string; team: string; rank: number; posRank: number; tier: string | null };

// Value of one player, from his consensus rank: rank 1 = 100, falling about 3.5% per spot.
const value = (rank: number) => 100 * Math.exp(-0.035 * (rank - 1));
// One star is worth more than several role players that add up to the same raw value.
const side = (list: P[]) => list.reduce((sum, p) => sum + Math.pow(value(p.rank), 1.35) / Math.pow(100, 0.35), 0);
const fmt = (n: number) => n.toFixed(1);
const MAX = 6;

function Picker({ players, taken, onPick }: { players: P[]; taken: Set<number>; onPick: (p: P) => void }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const matches = useMemo(() => {
    const s = q.trim().toLowerCase();
    return players.filter((p) => !taken.has(p.id) && (!s || p.name.toLowerCase().includes(s))).slice(0, 8);
  }, [players, taken, q]);

  return (
    <div className="relative">
      <input
        value={q} placeholder="+ Add a player" aria-label="Add a player"
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
        className="w-full rounded-[10px] border border-dashed border-zinc-600 bg-black px-3 py-3 text-sm"
      />
      {open && matches.length > 0 && (
        <ul className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-lg border border-zinc-700 bg-zinc-950 shadow-xl">
          {matches.map((p) => (
            <li key={p.id}>
              <button type="button" className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-zinc-800"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => { onPick(p); setQ(""); setOpen(false); }}>
                <span className="w-7 text-xs text-zinc-500">{p.rank}</span>
                <span className="pn flex-1">{p.name}</span>
                <span className={`bd ${p.position}`}>{p.position}</span>
                <span className="w-9 text-right text-xs text-zinc-400">{p.team}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SideCard({ title, hint, list, total, players, taken, onAdd, onRemove }: {
  title: string; hint: string; list: P[]; total: number; players: P[]; taken: Set<number>; onAdd: (p: P) => void; onRemove: (id: number) => void;
}) {
  return (
    <div className="gl-panel flex flex-col gap-3 p-4">
      <div className="flex items-start justify-between gap-2 border-b border-zinc-800 pb-3">
        <div>
          <h3 className="text-2xl font-bold leading-tight">{title}</h3>
          <p className="text-[11px] font-semibold tracking-[0.2em] text-zinc-400">{hint}</p>
        </div>
        <span className="whitespace-nowrap rounded-full border border-zinc-800 bg-[#FBFAF6] px-3 py-1 text-sm font-semibold">Total Value: <span className="font-extrabold" style={{ color: "var(--accent)" }}>{fmt(total)}</span></span>
      </div>
      <div className="space-y-2">
        {list.map((p) => (
          <div key={p.id} className="flex items-center gap-3">
            <Avatar id={p.id} name={p.name} size={52} />
            <span className="min-w-0 flex-1">
              <PlayerLink id={p.id} name={p.name} className="block truncate text-base font-bold" />
              <span className="mt-0.5 flex items-center gap-1.5 text-xs text-zinc-400">
                <span className={`bd !px-1.5 !text-[10px] ${p.position}`}>{p.position}</span>{p.team || "FA"} · {p.position}{p.posRank}
              </span>
            </span>
            <span className="rounded-xl border border-zinc-800 bg-[#FBFAF6] px-3 py-1 text-center">
              <span className="block text-base font-extrabold leading-tight">{fmt(value(p.rank))}</span>
              <span className="block text-[10px] text-zinc-400">Trade Value</span>
            </span>
            <button className="h-6 w-6 shrink-0 rounded-full text-sm" aria-label={`Remove ${p.name}`} onClick={() => onRemove(p.id)}>✕</button>
          </div>
        ))}
      </div>
      {list.length < MAX && <Picker players={players} taken={taken} onPick={onAdd} />}
    </div>
  );
}

const pos = (p: P) => `${p.position}${p.posRank}`;
const names = (l: P[]) => l.map((p) => p.name).join(", ");

export function TradeCalc({ players, intro, settings }: { players: P[]; intro: ReactNode; settings: ReactNode }) {
  const [give, setGive] = useState<P[]>([]);
  const [get, setGet] = useState<P[]>([]);
  const taken = useMemo(() => new Set([...give, ...get].map((p) => p.id)), [give, get]);

  const yours = side(give);   // what you send
  const theirs = side(get);   // what you receive
  const ready = give.length > 0 && get.length > 0;
  const net = theirs - yours;
  const total = yours + theirs;
  const pct = net / Math.max(theirs, yours, 1);
  const fair = Math.abs(pct) < 0.1;
  const tone = !ready ? "#b9b0a0" : fair ? "#B8860B" : net > 0 ? "var(--accent)" : "#C0392B";
  const verdict = !ready ? "Add Players" : fair ? "Fair Trade" : net > 0 ? "Good Trade" : "Bad Trade";
  const yourShare = total ? Math.round((yours / total) * 100) : 50;

  const best = (l: P[]) => [...l].sort((a, b) => a.rank - b.rank)[0];
  const giveBest = best(give), getBest = best(get);
  const summary: { ok: boolean; text: string }[] = [];
  if (ready) {
    summary.push(fair ? { ok: true, text: "Fair value (within 10%)" } : net > 0 ? { ok: true, text: `Value gain of ${fmt(net)}` } : { ok: false, text: `Value loss of ${fmt(-net)}` });
    if (getBest.rank < giveBest.rank) summary.push({ ok: true, text: `Upgrades to ${pos(getBest)} (${getBest.name})` });
    else if (getBest.rank > giveBest.rank) summary.push({ ok: false, text: `Gives up ${pos(giveBest)} (${giveBest.name})` });
    if (get.length < give.length) summary.push({ ok: true, text: "Consolidates into fewer, better players" });
    else if (get.length > give.length) summary.push({ ok: true, text: `Adds depth (${get.length} players for ${give.length})` });
    const elite = give.filter((p) => p.rank <= 12);
    if (elite.length) summary.push({ ok: false, text: `Gives up top-12 ${elite.map((p) => p.position).join("/")} (${elite[0].name})` });
    const eliteIn = get.filter((p) => p.rank <= 12);
    if (eliteIn.length) summary.push({ ok: true, text: `Adds top-12 ${eliteIn.map((p) => p.position).join("/")} (${eliteIn[0].name})` });
    summary.push(fair ? { ok: false, text: net >= 0 ? "Slight value edge to your side" : "Slight value edge to their side" } : { ok: net > 0, text: net > 0 ? "Value advantage to your side" : "Value advantage to their side" });
  }
  const side$ = (side: boolean) => (side ? "your" : "their");
  const outlook = !ready ? "Add at least one player to each side to see how the trade looks."
    : `${fair ? "A fairly even trade." : net > 0 ? "A trade that favors you." : "A trade that favors them."} You give up ${names(give)} (${give.map(pos).join(", ")}) and get ${names(get)} (${get.map(pos).join(", ")}). `
      + `${fair ? `The trade slightly ${net >= 0 ? "favors your" : "favors their"} side by about ${Math.abs(Math.round(pct * 100))}%` : `The trade favors ${side$(net > 0)} side by about ${Math.abs(Math.round(pct * 100))}%`} based on current consensus value.`;

  const clear = () => { setGive([]); setGet([]); };
  const swap = () => { setGive(get); setGet(give); };
  const btn = "inline-flex items-center gap-2 rounded-full border border-zinc-800 bg-[#FBFAF6] px-5 py-2.5 text-sm font-bold";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        {intro}
        <div className="flex gap-2">
          <button type="button" className={btn} onClick={swap}>⇄ Swap</button>
          <button type="button" className={btn} onClick={clear}>↻ Clear</button>
        </div>
      </div>

      <div className="grid items-start gap-4 md:grid-cols-2 xl:grid-cols-[1fr_1fr_20rem]">
        <SideCard title="Your Side" hint="PLAYERS YOU GIVE" list={give} total={yours} players={players} taken={taken}
          onAdd={(p) => setGive((l) => [...l, p])} onRemove={(id) => setGive((l) => l.filter((p) => p.id !== id))} />
        <SideCard title="Their Side" hint="PLAYERS YOU RECEIVE" list={get} total={theirs} players={players} taken={taken}
          onAdd={(p) => setGet((l) => [...l, p])} onRemove={(id) => setGet((l) => l.filter((p) => p.id !== id))} />
        <div className="md:col-span-2 xl:col-span-1">{settings}</div>

        <div className="gl-panel p-5 md:col-span-2" aria-live="polite">
          <p className="mb-3 text-center text-xs tracking-[0.45em] text-zinc-400">TRADE ANALYSIS</p>
          <div className="grid items-center gap-3 text-center sm:grid-cols-[1fr_auto_1fr]">
            <div><p className="text-lg font-semibold">Your Side</p><p className="text-5xl font-extrabold italic">{fmt(yours)}</p></div>
            <div className="mx-auto rounded-full border-2 px-8 py-3 text-2xl font-extrabold italic" style={{ borderColor: tone, color: tone, background: "#EBF0E5" }}>⚖ {verdict}</div>
            <div><p className="text-lg font-semibold">Their Side</p><p className="text-5xl font-extrabold italic">{fmt(theirs)}</p></div>
          </div>
          <div className="mt-4 flex h-10 overflow-hidden rounded-full text-sm font-bold text-white" role="img" aria-label={`Your side ${yourShare} percent, their side ${100 - yourShare} percent`}>
            <span className="flex items-center justify-center" style={{ width: `${yourShare}%`, background: "#8FA595", minWidth: ready ? "2.5rem" : undefined }}>{ready ? `${yourShare}%` : ""}</span>
            <span className="flex flex-1 items-center justify-center" style={{ background: "#262626" }}>{ready ? `${100 - yourShare}%` : ""}</span>
          </div>
        </div>

        <div className="gl-panel space-y-3 p-4 xl:col-start-3 xl:row-start-2">
          <h3 className="text-lg font-bold"><span style={{ color: "var(--accent)" }} aria-hidden="true">▤</span> Trade Summary</h3>
          {summary.length ? (
            <ul className="space-y-2 text-sm">
              {summary.map((x, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white" style={{ background: x.ok ? "var(--accent)" : "#B9B5A9" }} aria-hidden="true">{x.ok ? "✓" : "–"}</span>
                  <span>{x.text}</span>
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-zinc-400">Add at least one player to each side to see a summary.</p>}
        </div>

        <div className="gl-panel p-4 md:col-span-2">
          <h3 className="mb-2 text-lg font-bold"><span style={{ color: "var(--accent)" }} aria-hidden="true">▮</span> Player Breakdown</h3>
          {give.length || get.length ? (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wider text-zinc-400">
                  <th className="py-1.5 font-semibold">Player</th><th className="font-semibold">Pos</th><th className="font-semibold">Team</th>
                  <th className="font-semibold">Rank</th><th className="text-right font-semibold">Trade Value</th>
                </tr>
              </thead>
              <tbody>
                {[give, get].map((group, gi) => group.map((p, i) => (
                  <tr key={p.id} className={i === 0 && gi === 1 && give.length ? "border-t border-zinc-800" : ""}>
                    <td className="py-1.5"><span className="flex items-center gap-2"><Avatar id={p.id} name={p.name} size={28} /><span className="font-semibold">{p.name}</span></span></td>
                    <td><span className={`bd ${p.position}`}>{p.position}</span></td>
                    <td>{p.team || "FA"}</td>
                    <td className="font-bold">{pos(p)}</td>
                    <td className="text-right font-bold">{fmt(value(p.rank))}</td>
                  </tr>
                )))}
              </tbody>
            </table>
          ) : <p className="text-sm text-zinc-400">Nothing added yet.</p>}
        </div>

        <div className="gl-panel p-4 xl:col-start-3 xl:row-start-3">
          <h3 className="mb-2 text-lg font-bold"><span style={{ color: "var(--accent)" }} aria-hidden="true">↗</span> Outlook</h3>
          <p className="text-sm leading-relaxed text-zinc-200">{outlook}</p>
        </div>
      </div>

      <p className="text-xs text-zinc-500">
        How value works: each player&apos;s value comes from his Ball Knowers Consensus rank (rank 1 is worth 100, dropping about 3.5% per spot).
        Stars are weighted extra, so one star can be worth more than several lesser players. Draft picks are not included yet.
      </p>
    </div>
  );
}
