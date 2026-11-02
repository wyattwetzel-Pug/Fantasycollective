"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { saveList } from "../actions";

export type Item = {
  player_id: number;
  name: string;
  position: string;
  team: string;
  tier: string;
  note: string;
  placed: boolean;
};

const TIERS = ["", "S", "A", "B", "C", "D", "E", "F"];
const POSITIONS = ["All", "QB", "RB", "WR", "TE", "K", "DEF"];
const PAGE = 100;

export function Editor({
  setId, title, backHref, initial, initialPublished,
}: { setId: number; title: string; backHref: string; initial: Item[]; initialPublished: boolean }) {
  const [items, setItems] = useState(initial);
  const [published, setPublished] = useState(initialPublished);
  const [pos, setPos] = useState("All");
  const [query, setQuery] = useState("");
  const [unplacedOnly, setUnplacedOnly] = useState(false);
  const [limit, setLimit] = useState(PAGE);
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState("");
  const [pending, start] = useTransition();

  const unplaced = items.filter((i) => !i.placed).length;

  // Indexes (into the full ordering) of the rows that pass the current filters.
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const out: number[] = [];
    items.forEach((it, idx) => {
      if (pos !== "All" && it.position !== pos) return;
      if (unplacedOnly && it.placed) return;
      if (q && !it.name.toLowerCase().includes(q)) return;
      out.push(idx);
    });
    return out;
  }, [items, pos, query, unplacedOnly]);

  function change(fn: (prev: Item[]) => Item[]) {
    setItems(fn);
    setDirty(true);
    setMessage("");
  }

  // Moves a player to a new spot and marks them as placed.
  function moveTo(from: number, to: number) {
    to = Math.max(0, Math.min(items.length - 1, to));
    change((prev) => {
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, { ...moved, placed: true });
      return next;
    });
  }

  // Up/down swaps with the neighbour that is currently visible.
  function step(idx: number, dir: -1 | 1) {
    const at = visible.indexOf(idx);
    const neighbour = visible[at + dir];
    if (neighbour !== undefined) moveTo(idx, neighbour);
  }

  function update(idx: number, patch: Partial<Item>) {
    change((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  }

  function save(publish: boolean) {
    start(async () => {
      const res = await saveList(
        setId,
        items.map((it, i) => ({
          player_id: it.player_id,
          rank: i + 1,
          tier: it.tier || null,
          note: it.note || null,
          needs_ranking: !it.placed,
        })),
        publish,
      );
      if (res.ok) {
        setPublished(publish);
        setDirty(false);
        const left = items.filter((it) => !it.placed).length;
        const base = publish ? "Saved and published." : "Saved as a draft.";
        setMessage(publish && left > 0 ? `${base} ${left} players are not placed yet, so they don't count toward the consensus.` : base);
      } else {
        setMessage(`Could not save: ${res.error}`);
      }
    });
  }

  const pill = "rounded-full border px-3 py-1 text-sm";
  return (
    <div className="space-y-4">
      <div>
        <Link href={backHref} className="text-sm text-green-400">← Back to Rankings</Link>
        <h1 className="mt-1 text-3xl font-bold">{title}</h1>
      </div>

      <div className="sticky top-0 z-10 space-y-3 border-b border-zinc-800 bg-black py-3">
        <div className="flex flex-wrap items-center gap-2">
          {POSITIONS.map((p) => (
            <button key={p} onClick={() => { setPos(p); setLimit(PAGE); }}
              className={`${pill} ${pos === p ? "border-green-500 text-green-400" : "border-zinc-700 text-zinc-300"}`}>{p}</button>
          ))}
          <input value={query} onChange={(e) => { setQuery(e.target.value); setLimit(PAGE); }} placeholder="Search players"
            className="ml-2 rounded border border-zinc-700 bg-zinc-900 px-3 py-1 text-sm" />
          <label className="flex items-center gap-1 text-sm text-zinc-300">
            <input type="checkbox" checked={unplacedOnly} onChange={(e) => { setUnplacedOnly(e.target.checked); setLimit(PAGE); }} />
            Not placed only
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="text-zinc-300">{items.length - unplaced} of {items.length} placed</span>
          <button onClick={() => change((prev) => prev.map((i) => ({ ...i, placed: true })))} className="text-green-400">Mark all as placed</button>
          <span className="flex-1" />
          {message && <span className={message.startsWith("Could not") ? "text-red-400" : "text-green-400"}>{message}</span>}
          {dirty && !message && <span className="text-yellow-400">Unsaved changes</span>}
          <button disabled={pending} onClick={() => save(false)} className="rounded border border-zinc-600 px-3 py-1.5 disabled:opacity-50">Save draft</button>
          <button disabled={pending} onClick={() => save(true)} className="rounded bg-green-500 px-3 py-1.5 font-semibold text-black disabled:opacity-50">
            {published ? "Save and keep published" : "Save and publish"}
          </button>
          {published && (
            <button disabled={pending} onClick={() => save(false)} className="text-red-400 disabled:opacity-50">Unpublish</button>
          )}
        </div>
        {!published && unplaced > 0 && (
          <p className="text-xs text-zinc-400">Players not placed don&apos;t count toward the consensus. Move a player, or use Mark all as placed.</p>
        )}
      </div>

      <ul className="space-y-1">
        {visible.slice(0, limit).map((idx) => {
          const it = items[idx];
          return (
            <li key={it.player_id} className={`flex items-center gap-2 rounded border p-2 ${it.placed ? "border-zinc-800" : "border-yellow-900 bg-yellow-950/20"}`}>
              <input
                key={`${it.player_id}-${idx}`}
                defaultValue={idx + 1}
                inputMode="numeric"
                aria-label={`Rank for ${it.name}`}
                className="w-14 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-center"
                onBlur={(e) => { const n = parseInt(e.target.value, 10); if (n && n - 1 !== idx) moveTo(idx, n - 1); }}
                onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
              />
              <button onClick={() => step(idx, -1)} aria-label="Move up" className="px-1 text-zinc-300">▲</button>
              <button onClick={() => step(idx, 1)} aria-label="Move down" className="px-1 text-zinc-300">▼</button>
              <span className="w-10 text-center text-xs font-semibold text-green-400">{it.position}</span>
              <span className="min-w-0 flex-1 truncate font-semibold">{it.name} <span className="font-normal text-zinc-400">{it.team}</span></span>
              <select value={it.tier} onChange={(e) => update(idx, { tier: e.target.value, placed: true })} aria-label={`Tier for ${it.name}`}
                className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1">
                {TIERS.map((t) => <option key={t} value={t}>{t || "Tier"}</option>)}
              </select>
              <input value={it.note} onChange={(e) => update(idx, { note: e.target.value })} placeholder="Note"
                className="hidden w-48 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-sm md:block" />
              <label className="flex items-center gap-1 text-xs text-zinc-400" title="Counts toward the consensus">
                <input type="checkbox" checked={it.placed} onChange={(e) => update(idx, { placed: e.target.checked })} />
                Placed
              </label>
            </li>
          );
        })}
      </ul>

      {visible.length > limit && (
        <button onClick={() => setLimit(limit + PAGE)} className="w-full rounded border border-zinc-700 py-2 text-zinc-300">
          Show {Math.min(PAGE, visible.length - limit)} more ({visible.length - limit} left)
        </button>
      )}
      {visible.length === 0 && <p className="text-zinc-400">No players match.</p>}
    </div>
  );
}
