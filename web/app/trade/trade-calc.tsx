"use client";

import { useMemo, useState } from "react";

export type P = { id: number; name: string; position: string; team: string; rank: number; tier: string | null };

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

function SideList({ title, hint, list, players, taken, onAdd, onRemove }: {
  title: string; hint: string; list: P[]; players: P[]; taken: Set<number>; onAdd: (p: P) => void; onRemove: (id: number) => void;
}) {
  return (
    <div className="space-y-2">
      <div><p className="font-semibold">{title}</p><p className="text-xs text-zinc-400">{hint}</p></div>
      {list.map((p) => (
        <div key={p.id} className="gl-row">
          <span className="h-11 w-11 shrink-0 rounded-full bg-zinc-700" aria-hidden="true" />
          <span className="flex-1">
            <span className="pn block text-sm">{p.name}</span>
            <span className="block text-xs text-zinc-400">{p.position} - {p.team} · rank {p.rank}</span>
          </span>
          <span className="font-bold" style={{ color: "#7dff6a" }}>{fmt(value(p.rank))}</span>
          <button className="h-6 w-6 rounded-full bg-zinc-800 text-xs" aria-label={`Remove ${p.name}`} onClick={() => onRemove(p.id)}>✕</button>
        </div>
      ))}
      {list.length < MAX && <Picker players={players} taken={taken} onPick={onAdd} />}
    </div>
  );
}

export function TradeCalc({ players }: { players: P[] }) {
  const [give, setGive] = useState<P[]>([]);
  const [get, setGet] = useState<P[]>([]);
  const taken = useMemo(() => new Set([...give, ...get].map((p) => p.id)), [give, get]);

  const youGive = side(give);
  const youGet = side(get);
  const ready = give.length > 0 && get.length > 0;
  const net = youGet - youGive;
  const pct = net / Math.max(youGet, youGive, 1);
  const fair = Math.abs(pct) < 0.1;
  const tone = !ready ? "#71717a" : fair ? "#FACC15" : net > 0 ? "#39ff14" : "#ef4444";
  const verdict = !ready ? "ADD PLAYERS" : fair ? "FAIR TRADE" : net > 0 ? "GOOD TRADE" : "BAD TRADE";
  const favours = !ready ? "Add players to both sides" : fair ? "Close to even" : net > 0 ? "Favours your team" : "Favours their team";

  const all = [...give.map((p) => ({ p, mine: false })), ...get.map((p) => ({ p, mine: true }))];
  const top = Math.max(1, ...all.map((x) => value(x.p.rank)));
  const posCount = (l: P[]) => ["QB", "RB", "WR", "TE"].map((k) => [k, l.filter((p) => p.position === k).length] as const).filter(([, n]) => n);
  const fmtPos = (l: P[]) => posCount(l).map(([k, n]) => `${n} ${k}`).join(", ") || "nothing";

  return (
    <div className="min-w-0 space-y-4">
      <div className="gl-panel space-y-3 p-4">
        <div className="flex items-center gap-3">
          <span className="text-2xl" style={{ color: "#39ff14" }} aria-hidden="true">⇄</span>
          <div>
            <h3 className="text-lg font-bold leading-tight">Build Your Trade</h3>
            <p className="text-xs text-zinc-400">Add the players on each side. Search by name.</p>
          </div>
        </div>
        <div className="grid items-start gap-3 md:grid-cols-[1fr_auto_1fr]">
          <SideList title="You give" hint="Players you send away" list={give} players={players} taken={taken}
            onAdd={(p) => setGive((l) => [...l, p])} onRemove={(id) => setGive((l) => l.filter((p) => p.id !== id))} />
          <button className="mx-auto h-12 w-12 self-center rounded-lg border text-xl" style={{ borderColor: "#39ff14", color: "#39ff14", background: "#0c2a0c" }}
            aria-label="Swap sides" onClick={() => { setGive(get); setGet(give); }}>⇄</button>
          <SideList title="You get" hint="Players you receive" list={get} players={players} taken={taken}
            onAdd={(p) => setGet((l) => [...l, p])} onRemove={(id) => setGet((l) => l.filter((p) => p.id !== id))} />
        </div>
        {(give.length > 0 || get.length > 0) && (
          <button className="text-xs text-zinc-400 underline" onClick={() => { setGive([]); setGet([]); }}>Clear trade</button>
        )}
      </div>

      <div className="gl-panel p-4" style={{ borderColor: tone, boxShadow: `0 0 18px ${tone}33` }} aria-live="polite">
        <p className="mb-3 text-center text-xs tracking-[0.45em] text-zinc-300">TRADE ANALYSIS</p>
        <div className="grid items-center gap-4 text-center md:grid-cols-[1fr_auto_1fr]">
          <div>
            <p className="text-lg">Your Return</p>
            <p className="text-4xl font-extrabold italic">{fmt(youGet)}
              {ready && <span className="ml-2 rounded-full border px-3 py-1 align-middle text-sm font-bold not-italic" style={{ color: tone, borderColor: tone }}>{net >= 0 ? "+" : ""}{fmt(net)}</span>}
            </p>
          </div>
          <div>
            <div className="rounded-full px-8 py-3 text-2xl font-extrabold italic" style={{ border: `2px solid ${tone}`, color: tone, background: "#08100a" }}>{verdict}</div>
            <p className="mt-2 text-lg" style={{ color: tone }}>{favours}</p>
          </div>
          <div>
            <p className="text-lg">Their Return</p>
            <p className="text-4xl font-extrabold italic">{fmt(youGive)}</p>
          </div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="gl-panel p-4">
          <h3 className="mb-2 text-lg font-bold"><span style={{ color: "#39ff14" }} aria-hidden="true">▤</span> Trade Summary</h3>
          {ready ? (
            <p className="text-sm leading-relaxed text-zinc-200">
              You give {fmtPos(give)} worth {fmt(youGive)} and get {fmtPos(get)} worth {fmt(youGet)}.
              {" "}{fair ? "That is close to even." : net > 0 ? `You come out ${fmt(net)} ahead.` : `You come out ${fmt(-net)} behind.`}
              {" "}{get.length < give.length ? "You are consolidating into fewer, better players." : get.length > give.length ? "You are trading one for several, which adds depth." : ""}
            </p>
          ) : <p className="text-sm text-zinc-400">Add at least one player to each side to see a summary.</p>}
        </div>
        <div className="gl-panel p-4">
          <h3 className="mb-3 text-lg font-bold"><span style={{ color: "#39ff14" }} aria-hidden="true">▮</span> Value Breakdown</h3>
          {all.length ? (
            <ul className="space-y-3 text-sm">
              {all.map(({ p, mine }) => (
                <li key={p.id} className="flex items-center gap-3">
                  <span className="pn w-28 shrink-0 truncate">{p.name}</span>
                  <span className="h-3 flex-1 rounded bg-zinc-800"><span className="block h-3 rounded" style={{ width: `${(value(p.rank) / top) * 100}%`, background: mine ? "#3dea1f" : "#71717a" }} /></span>
                  <span className="w-10 text-right">{fmt(value(p.rank))}</span>
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-zinc-400">Nothing added yet.</p>}
          <p className="mt-3 text-xs text-zinc-500">Green is what you get. Gray is what you give.</p>
        </div>
      </div>

      <p className="text-xs text-zinc-500">
        How value works: each player&apos;s value comes from his Ball Knowers Consensus rank (rank 1 is worth 100, dropping about 3.5% per spot).
        Stars are weighted extra, so one star can be worth more than several lesser players. Draft picks are not included yet.
      </p>
    </div>
  );
}
