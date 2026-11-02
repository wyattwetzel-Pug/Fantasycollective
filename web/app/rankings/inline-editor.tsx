"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { Avatar } from "@/app/avatar";
import { PlayerLink } from "@/app/player-link";
import { TeamLogo } from "@/app/team-logo";
import { saveList } from "../lists/actions";

export type Item = { player_id: number; name: string; position: string; team: string; tier: string; note: string; placed: boolean };
export type Line = { proj: number | null; played: number; snapPct: number | null; posFinish: number | null };

const ORDER = ["S", "A", "B", "C", "D", "E", "F"];
const COLORS: Record<string, string> = { S: "#D4A72C", A: "#43B02A", B: "#2F7BEA", C: "#8B5CF6", D: "#E0A800", E: "#F28C28", F: "#E5484D" };

// Edit your own list right on the Rankings page: move players up and down, or up and down a tier.
export function InlineEditor({
  setId, initial, initialPublished, lines, settings, exitHref, fullEditorHref,
}: { setId: number; initial: Item[]; initialPublished: boolean; lines: Record<number, Line>; settings: string; exitHref: string; fullEditorHref: string }) {
  const [items, setItems] = useState(initial);
  const [published, setPublished] = useState(initialPublished);
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState("");
  const [pending, start] = useTransition();

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  function change(fn: (prev: Item[]) => Item[]) {
    setItems(fn);
    setDirty(true);
    setMessage("");
  }

  // Swap with the neighbour. Crossing a tier line puts the player in that tier.
  function step(idx: number, dir: -1 | 1) {
    change((prev) => {
      const j = idx + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      const moved = { ...next[idx], placed: true, tier: next[j].tier || next[idx].tier };
      next[idx] = next[j];
      next[j] = moved;
      return next;
    });
  }

  // Move to the neighbouring tier: the bottom of the tier above, or the top of the tier below.
  function shiftTier(idx: number, dir: -1 | 1) {
    change((prev) => {
      const tier = prev[idx].tier;
      let s = idx, e = idx;
      while (s > 0 && prev[s - 1].tier === tier) s--;
      while (e < prev.length - 1 && prev[e + 1].tier === tier) e++;

      let newTier: string;
      if (dir === -1) newTier = s > 0 ? prev[s - 1].tier : ORDER[ORDER.indexOf(tier) - 1] ?? "";
      else newTier = e < prev.length - 1 ? prev[e + 1].tier : ORDER[ORDER.indexOf(tier) + 1] ?? "";
      if (!newTier || newTier === tier) return prev;

      const next = [...prev];
      const [moved] = next.splice(idx, 1);
      next.splice(dir === -1 ? s : e, 0, { ...moved, tier: newTier, placed: true });
      return next;
    });
  }

  function save(publish: boolean) {
    start(async () => {
      const res = await saveList(
        setId,
        items.map((it, i) => ({ player_id: it.player_id, rank: i + 1, tier: it.tier || null, note: it.note || null, needs_ranking: !it.placed })),
        publish,
      );
      if (res.ok) {
        setPublished(publish);
        setDirty(false);
        const left = items.filter((it) => !it.placed).length;
        const base = publish ? "Saved and published." : "Saved as a draft.";
        setMessage(publish && left > 0 ? `${base} ${left} players aren't placed yet, so they don't count toward the consensus.` : base);
      } else {
        setMessage(`Could not save: ${res.error}`);
      }
    });
  }

  // Runs of the same tier share one card.
  const runs: { tier: string; idx: number[] }[] = [];
  items.forEach((it, i) => {
    const last = runs[runs.length - 1];
    if (last && last.tier === it.tier) last.idx.push(i); else runs.push({ tier: it.tier, idx: [i] });
  });
  const posCount: Record<string, number> = {};
  const posRank = items.map((it) => (posCount[it.position] = (posCount[it.position] ?? 0) + 1));
  const unplaced = items.filter((i) => !i.placed).length;
  const num = (v: number | null | undefined) => (v === null || v === undefined ? "–" : v.toFixed(1));
  const btn = "rounded-md border border-zinc-700 bg-[#fffdf8] px-2.5 py-1.5 text-sm font-bold leading-none text-zinc-300 hover:bg-[#f0eadc] disabled:opacity-30";

  return (
    <div className="space-y-4">
      <div className="gl-panel flex flex-wrap items-center gap-3 p-4">
        <div className="min-w-[14rem] flex-1">
          <p className="font-bold">Editing your list</p>
          <p className="text-xs text-zinc-400">{settings}. Use the arrows to move players, or move them up or down a tier.</p>
        </div>
        {message && <span className={`text-sm ${message.startsWith("Could not") ? "text-red-400" : "text-green-400"}`}>{message}</span>}
        {dirty && !message && <span className="text-sm text-yellow-400">Unsaved changes</span>}
        <button disabled={pending} onClick={() => save(false)} className="gl-pill disabled:opacity-50">Save draft</button>
        <button disabled={pending} onClick={() => save(true)} className="gl-pill on disabled:opacity-50">{published ? "Save and keep published" : "Save and publish"}</button>
        <Link href={exitHref} onClick={(e) => { if (dirty && !window.confirm("You have unsaved changes. Leave without saving?")) e.preventDefault(); }} className="gl-pill">Done</Link>
      </div>
      <div className="flex flex-wrap items-center gap-3 text-xs text-zinc-400">
        <span>{items.length - unplaced} of {items.length} placed</span>
        <button onClick={() => change((prev) => prev.map((i) => ({ ...i, placed: true })))} className="text-green-400">Mark all as placed</button>
        <Link href={fullEditorHref} className="text-green-400">Open the full editor (notes, sort by ADP)</Link>
      </div>

      <div className="space-y-5 overflow-x-auto pb-1">
        {runs.map((run, ri) => {
          const c = run.tier ? COLORS[run.tier] : "#8b8576";
          return (
            <div key={ri} className="gl-tierbox min-w-[44rem]">
              <table className="gl-table dark">
                <thead>
                  <tr>
                    <th scope="col" colSpan={2} className="!text-left">
                      <span className="flex items-center">
                        <span className="tier-chip" style={{ background: `linear-gradient(180deg, ${c}, ${c}cc)` }}>{run.tier || "–"}</span>
                        <span className="text-lg font-bold">{run.tier ? "TIER" : "UNSORTED"}</span>
                      </span>
                    </th>
                    <th scope="col">Pos</th>
                    <th scope="col">Proj Pts</th>
                    <th scope="col">Team</th>
                    <th scope="col">Move</th>
                  </tr>
                </thead>
                <tbody>
                  {run.idx.map((i) => {
                    const it = items[i];
                    const l = lines[it.player_id];
                    return (
                      <tr key={it.player_id} style={it.placed ? undefined : { background: "#fcf1cc" }}>
                        <td className="w-10 font-semibold">{i + 1}</td>
                        <td className="!text-left">
                          <span className="flex items-center gap-3">
                            <Avatar id={it.player_id} name={it.name} size={40} />
                            <span><PlayerLink id={it.player_id} name={it.name} />{!it.placed && <span className="block text-xs text-yellow-400">not placed yet</span>}</span>
                          </span>
                        </td>
                        <td><span className={`bd ${it.position}`}>{it.position} {posRank[i]}</span></td>
                        <td className="hl font-semibold">{num(l?.proj)}</td>
                        <td><TeamLogo team={it.team} /></td>
                        <td>
                          <span className="inline-flex gap-1">
                            <button className={btn} onClick={() => shiftTier(i, -1)} aria-label={`Move ${it.name} up a tier`} title="Up a tier">⇈</button>
                            <button className={btn} onClick={() => step(i, -1)} disabled={i === 0} aria-label={`Move ${it.name} up`} title="Up">▲</button>
                            <button className={btn} onClick={() => step(i, 1)} disabled={i === items.length - 1} aria-label={`Move ${it.name} down`} title="Down">▼</button>
                            <button className={btn} onClick={() => shiftTier(i, 1)} aria-label={`Move ${it.name} down a tier`} title="Down a tier">⇊</button>
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          );
        })}
      </div>
    </div>
  );
}
