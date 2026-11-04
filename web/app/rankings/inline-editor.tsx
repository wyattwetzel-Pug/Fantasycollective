"use client";

import { TIER_COLORS, TIER_ORDER, tierInk } from "@/lib/tier-config";
import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { Avatar } from "@/app/avatar";
import { PlayerLink } from "@/app/player-link";
import { TeamLogo } from "@/app/team-logo";
import { saveList, saveScopeList, pasteRankings, type CopiedRankings } from "../lists/actions";

export type Item = { player_id: number; name: string; position: string; team: string; tier: string; note: string; placed: boolean };
export type Line = { proj: number | null; played: number; snapPct: number | null; posFinish: number | null };

const ORDER = TIER_ORDER;
const POSITIONS = ["All", "QB", "RB", "WR", "TE", "FLEX", "K", "DEF"];
const GROUPS: Record<string, string[]> = { FLEX: ["RB", "WR", "TE"] };
const label = (p: string) => (p === "All" ? "Overall" : p === "DEF" ? "DST" : p === "FLEX" ? "Flex" : p);
const COLORS = TIER_COLORS;

// Players with a tier always sit above players with none, and tiers run S to F, so a tier card can
// never show up below the Unsorted players. Order inside a tier is kept.
const tierRank = (t: string) => (ORDER.indexOf(t) >= 0 ? ORDER.indexOf(t) : ORDER.length);
const tidy = (list: Item[]) => list.map((it, i) => ({ it, i })).sort((a, b) => tierRank(a.it.tier) - tierRank(b.it.tier) || a.i - b.i).map((x) => x.it);

// Edit your own list right on the Rankings page: move players up and down, or up and down a tier.
export function InlineEditor({
  setId, initial, scopes, initialPublished, lines, settings, exitHref, fullEditorHref,
}: { setId: number; initial: Item[]; scopes: Record<string, Item[]>; initialPublished: boolean; lines: Record<number, Line>; settings: string; exitHref: string; fullEditorHref: string }) {
  // Overall and each position are separate lists, each with its own order and tiers.
  const [store, setStore] = useState<Record<string, Item[]>>(() => ({ All: tidy(initial) }));
  const [published, setPublished] = useState(initialPublished);
  // Tidying a list whose tiers and order disagreed counts as a change you still need to save.
  const [dirtyScopes, setDirtyScopes] = useState<Set<string>>(() => new Set(tidy(initial).some((it, i) => it.player_id !== initial[i].player_id) ? ["All"] : []));
  const dirty = dirtyScopes.size > 0;
  const [message, setMessage] = useState("");
  const [pending, start] = useTransition();
  const [limit, setLimit] = useState(100);
  const [pos, setPos] = useState("All");
  const items = store[pos] ?? [];
  const [dragId, setDragId] = useState<number | null>(null);
  // Press and drag across rows to connect them; dragging one of the connected rows' handles moves them all.
  const [dragIds, setDragIds] = useState<number[]>([]);
  const [sel, setSel] = useState<number[]>([]);
  const [selecting, setSelecting] = useState(false);
  const anchor = useRef<number | null>(null);
  const base = useRef<number | null>(null);   // where the last selection started, for Shift+click
  const extendRef = useRef<(id: number) => void>(() => {});
  // While connecting rows, the page scrolls when the pointer nears the top or bottom edge, so a selection
  // can run as long as you like.
  useEffect(() => {
    if (!selecting) return;
    const pt = { x: 0, y: -1 };
    const move = (e: MouseEvent) => { pt.x = e.clientX; pt.y = e.clientY; };
    const up = () => { setSelecting(false); anchor.current = null; setSel((cur) => (cur.length > 1 ? cur : [])); };
    const ZONE = 120, MAX = 30;
    let frame = requestAnimationFrame(function tick() {
      const h = window.innerHeight;
      const v = pt.y < 0 ? 0 : pt.y < ZONE ? -Math.ceil(MAX * (ZONE - pt.y) / ZONE) : pt.y > h - ZONE ? Math.ceil(MAX * (pt.y - (h - ZONE)) / ZONE) : 0;
      if (v) {
        window.scrollBy(0, v);
        const row = document.elementFromPoint(pt.x, Math.min(Math.max(pt.y, 1), h - 1))?.closest("tr[data-pid]") as HTMLElement | null;
        if (row) extendRef.current(Number(row.dataset.pid));
      }
      frame = requestAnimationFrame(tick);
    });
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => { cancelAnimationFrame(frame); window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
  }, [selecting]);
  useEffect(() => {
    if (!sel.length) return;
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setSel([]); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [sel.length]);
  const [over, setOver] = useState<{ id: number; after: boolean } | { card: string } | null>(null);

  // While a player is being dragged, scroll the page when the pointer nears the top or bottom edge,
  // and keep scrolling until the drag ends (even if the pointer leaves the window).
  const scrollSpeed = useRef(0);
  useEffect(() => {
    if (dragId === null) return;
    const ZONE = 140, MAX = 26;
    const onOver = (e: DragEvent) => {
      const h = window.innerHeight;
      if (e.clientY < ZONE) scrollSpeed.current = -Math.ceil(MAX * Math.min(1, (ZONE - e.clientY) / ZONE));
      else if (e.clientY > h - ZONE) scrollSpeed.current = Math.ceil(MAX * Math.min(1, (e.clientY - (h - ZONE)) / ZONE));
      else scrollSpeed.current = 0;
    };
    let frame = requestAnimationFrame(function tick() {
      if (scrollSpeed.current) window.scrollBy(0, scrollSpeed.current);
      frame = requestAnimationFrame(tick);
    });
    window.addEventListener("dragover", onOver);
    return () => { cancelAnimationFrame(frame); window.removeEventListener("dragover", onOver); scrollSpeed.current = 0; };
  }, [dragId]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  function change(fn: (prev: Item[]) => Item[]) {
    const scope = pos;
    setStore((prev) => ({ ...prev, [scope]: tidy(fn(prev[scope] ?? [])) }));
    setDirtyScopes((prev) => new Set(prev).add(scope));
    setMessage("");
  }

  // A position's list starts as a copy of Overall for that position, until you change it.
  function choose(p: string) {
    setStore((prev) => prev[p] ? prev : {
      ...prev,
      [p]: tidy(scopes[p] ?? prev.All.filter((it) => (GROUPS[p] ?? [p]).includes(it.position)).map((it) => ({ ...it, placed: true }))),
    });
    setPos(p);
    setLimit(100);
    setMessage("");
  }

  // Move one spot. With a position picked, "one spot" means past the next player at that position.
  // At the edge of a tier, the arrow moves the player into the next tier instead
  // (the tier right above or below, even if it is empty).
  function step(idx: number, dir: -1 | 1) {
    const here = items[idx];
    const j = idx + dir;
    if (j < 0 || j >= items.length) return;
    const neighbour = items[j];
    if (here.tier !== "" && neighbour.tier !== here.tier) { shiftTier(idx, dir); return; }
    change((prev) => {
      const next = [...prev];
      const [moved] = next.splice(idx, 1);
      next.splice(j, 0, { ...moved, placed: true, tier: neighbour.tier || moved.tier });
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

      // The tier right above or below, even if nobody is in it yet. Players with no tier join the one above.
      const at = ORDER.indexOf(tier);
      let newTier: string;
      if (dir === -1) newTier = tier === "" ? (s > 0 ? prev[s - 1].tier : "") : ORDER[at - 1] ?? "";
      else newTier = tier === "" ? "" : ORDER[at + 1] ?? "";
      if (!newTier || newTier === tier) return prev;

      const next = [...prev];
      const [moved] = next.splice(idx, 1);
      next.splice(dir === -1 ? s : e, 0, { ...moved, tier: newTier, placed: true });
      return next;
    });
  }

  // Drag and drop: drop on a row to put the player before or after it (taking that row's tier),
  // or on a tier's header or empty card to put them at the top of that tier.
  function dropOnRow(targetId: number, after: boolean) {
    const ids = dragIds.length ? dragIds : dragId === null ? [] : [dragId];
    if (!ids.length || ids.includes(targetId)) return;
    change((prev) => {
      const target = prev.find((i) => i.player_id === targetId);
      const moving = prev.filter((i) => ids.includes(i.player_id));
      if (!target || !moving.length) return prev;
      const next = prev.filter((i) => !ids.includes(i.player_id));
      next.splice(next.findIndex((i) => i.player_id === targetId) + (after ? 1 : 0), 0, ...moving.map((m) => ({ ...m, tier: target.tier, placed: true })));
      return next;
    });
  }

  function dropOnTier(tier: string) {
    if (dragId === null) return;
    moveToTier(dragIds.length ? dragIds : [dragId], tier);
  }

  // Put a player in a tier: at the top of it (a drop on the tier's header) or at the bottom (the Tier picker).
  function moveToTier(ids: number[], tier: string, bottom = false) {
    change((prev) => {
      const moving = prev.filter((i) => ids.includes(i.player_id));
      if (!moving.length) return prev;
      const next = prev.filter((i) => !ids.includes(i.player_id));
      let at = bottom ? next.map((i) => i.tier).lastIndexOf(tier) + 1 || -1 : next.findIndex((i) => i.tier === tier);
      if (at < 0) {
        // Empty tier: it sits right after the last player in an earlier tier.
        const ti = tier ? ORDER.indexOf(tier) : ORDER.length;
        at = 0;
        next.forEach((i, k) => { if (i.tier && ORDER.indexOf(i.tier) < ti) at = k + 1; });
      }
      next.splice(at, 0, ...moving.map((m) => ({ ...m, tier, placed: true })));
      return next;
    });
  }

  function endDrag() { setDragId(null); setDragIds([]); setOver(null); setSel([]); }

  function save(publish: boolean) {
    const scope = pos;
    if (scope !== "All") {
      start(async () => {
        const res = await saveScopeList(setId, scope, items.map((it, i) => ({ player_id: it.player_id, rank: i + 1, tier: it.tier || null })));
        if (res.ok) {
          setDirtyScopes((prev) => { const n = new Set(prev); n.delete(scope); return n; });
          setMessage(`Saved your ${label(scope)} ranking.`);
        } else {
          setMessage(`Could not save: ${res.error}`);
        }
      });
      return;
    }
    start(async () => {
      const res = await saveList(
        setId,
        items.map((it, i) => ({ player_id: it.player_id, rank: i + 1, tier: it.tier || null, note: it.note || null, needs_ranking: !it.placed })),
        publish,
      );
      if (res.ok) {
        setPublished(publish);
        setDirtyScopes((prev) => { const n = new Set(prev); n.delete("All"); return n; });
        const left = items.filter((it) => !it.placed).length;
        const base = publish ? "Saved and published." : "Saved as a draft.";
        setMessage(publish && left > 0 ? `${base} ${left} players aren't placed yet, so they don't count toward the consensus.` : base);
      } else {
        setMessage(`Could not save: ${res.error}`);
      }
    });
  }

  // Copy / paste between settings. The copy is kept in this browser, so it survives switching settings.
  const CLIP = "ff-copied-rankings";
  const [clip, setClip] = useState<CopiedRankings | null>(null);
  useEffect(() => {
    try { const raw = window.localStorage.getItem(CLIP); if (raw) setClip(JSON.parse(raw) as CopiedRankings); } catch { /* no saved copy */ }
  }, []);

  function copyRankings() {
    const lists: Record<string, Item[]> = { ...scopes, ...store };
    const made: CopiedRankings = {
      label: settings,
      overall: store.All.map((i) => ({ player_id: i.player_id, tier: i.tier, note: i.note, placed: i.placed })),
      scopes: Object.fromEntries(Object.entries(lists).filter(([k]) => k !== "All").map(([k, list]) => [k, list.map((i) => ({ player_id: i.player_id, tier: i.tier }))])),
    };
    try { window.localStorage.setItem(CLIP, JSON.stringify(made)); } catch { setMessage("Could not copy: this browser blocked saving it."); return; }
    setClip(made);
    setMessage(`Copied the ${settings} rankings (Overall${Object.keys(made.scopes).length ? ` and ${Object.keys(made.scopes).length} position list${Object.keys(made.scopes).length === 1 ? "" : "s"}` : ""}). Switch settings and click Paste Copied Rankings.`);
  }

  function pasteCopied() {
    if (!clip) return;
    if (!window.confirm(`Paste the rankings copied from ${clip.label} into ${settings}? This replaces the Overall list${Object.keys(clip.scopes).length ? " and the copied position lists" : ""} here, and it saves right away.`)) return;
    start(async () => {
      const res = await pasteRankings(setId, clip);
      if (!res.ok) { setMessage(`Could not paste: ${res.error}`); return; }
      setDirtyScopes(new Set());
      window.location.reload();
    });
  }

  // Everyone goes back to Unsorted. The order stays.
  function clearTiers() {
    if (!window.confirm(`Clear every tier in this ${pos === "All" ? "Overall" : label(pos)} list? Everyone goes to Unsorted. Their order stays, and it isn't saved until you press save.`)) return;
    change((prev) => prev.map((i) => ({ ...i, tier: "" })));
  }

  function extendTo(id: number) {
    if (anchor.current === null) return;
    const order = inView.map((i) => items[i].player_id);
    const a = order.indexOf(anchor.current), h = order.indexOf(id);
    if (a < 0 || h < 0) return;
    setSel(order.slice(Math.min(a, h), Math.max(a, h) + 1));
  }

  // Runs of the same tier share one card.
  const runs: { tier: string; idx: number[] }[] = [];
  const inView: number[] = [];
  items.forEach((it, i) => { if (pos !== "All" || (it.position !== "K" && it.position !== "DEF")) inView.push(i); });
  inView.slice(0, Math.max(limit, 0)).forEach((i) => {
    const it = items[i];
    const last = runs[runs.length - 1];
    if (last && last.tier === it.tier) last.idx.push(i); else runs.push({ tier: it.tier, idx: [i] });
  });
  // Every tier always has a card, so a player can be moved into a tier nobody is in yet.
  const used = new Set(inView.map((i) => items[i].tier));
  const cards: { tier: string; idx: number[] }[] = [];
  let nextTier = 0;
  for (const run of runs) {
    const ti = run.tier ? ORDER.indexOf(run.tier) : ORDER.length;
    for (; nextTier < ti; nextTier++) if (!used.has(ORDER[nextTier])) cards.push({ tier: ORDER[nextTier], idx: [] });
    cards.push(run);
    nextTier = Math.max(nextTier, ti + 1);
  }
  for (; nextTier < ORDER.length; nextTier++) if (!used.has(ORDER[nextTier])) cards.push({ tier: ORDER[nextTier], idx: [] });
  extendRef.current = extendTo;
  let shownSoFar = 0;
  const listRank = items.map((it) => (it.position !== "K" && it.position !== "DEF" ? ++shownSoFar : 0));
  const posCount: Record<string, number> = {};
  const posRank = items.map((it) => (posCount[it.position] = (posCount[it.position] ?? 0) + 1));
  const unplaced = items.filter((i) => !i.placed).length;
  const num = (v: number | null | undefined) => (v === null || v === undefined ? "–" : v.toFixed(1));
  const btn = "rounded-md border border-zinc-700 bg-[#FBFAF6] px-2.5 py-1.5 text-sm font-bold leading-none text-zinc-300 hover:bg-[#E7E3D8] disabled:opacity-30";

  return (
    <div className="space-y-4">
      <div className="gl-panel flex flex-wrap items-center gap-3 p-4">
        <div className="min-w-[14rem] flex-1">
          <p className="font-bold">{pos === "All" ? "Editing your list" : `Editing your ${label(pos)} ranking`}</p>
          <p className="text-xs text-zinc-400">{settings}. {pos !== "All" && `This is its own ${label(pos)} ranking, so its tiers and order are separate from Overall. `}Drag players (⠿) to where you want them, or use ▲ and ▼. At the edge of a tier the arrows move a player into the next tier; ⇈ and ⇊ jump a player straight to the next tier.</p>
        </div>
        {message && <span className={`text-sm ${message.startsWith("Could not") ? "text-red-400" : "text-green-400"}`}>{message}</span>}
        {dirty && !message && <span className="text-sm text-yellow-400">Unsaved changes</span>}
        {pos === "All" ? (
          <>
            <button disabled={pending} onClick={() => save(false)} className="gl-pill disabled:opacity-50">Save draft</button>
            <button disabled={pending} onClick={() => save(true)} className="gl-pill on disabled:opacity-50">{published ? "Save and keep published" : "Save and publish"}</button>
          </>
        ) : (
          <button disabled={pending} onClick={() => save(false)} className="gl-pill on disabled:opacity-50">Save {label(pos)} ranking</button>
        )}
        <Link href={exitHref} onClick={(e) => { if (dirty && !window.confirm("You have unsaved changes. Leave without saving?")) e.preventDefault(); }} className="gl-pill">Done</Link>
      </div>
      <div className="flex flex-wrap items-center gap-3 text-xs text-zinc-400">
        {pos === "All" && <span>{items.length - unplaced} of {items.length} placed</span>}
        {pos === "All" && <button onClick={() => change((prev) => prev.map((i) => ({ ...i, placed: true })))} className="text-green-400">Mark all as placed</button>}
        <button onClick={clearTiers} className="text-red-400">Clear all tiers</button>
        <button onClick={copyRankings} className="text-green-400">Copy these rankings</button>
        {clip && clip.label !== settings && <button disabled={pending} onClick={pasteCopied} className="text-green-400 disabled:opacity-50">Paste Copied Rankings</button>}
        <Link href={fullEditorHref} className="text-green-400">Open the full editor (notes, sort by ADP)</Link>
      </div>

      <div role="group" aria-label="Position filter" className="flex flex-wrap gap-2">
        {POSITIONS.map((p) => (
          <button key={p} onClick={() => choose(p)} className={`gl-pill !px-5 ${pos === p ? "on" : ""}`}>{label(p)}</button>
        ))}
        {pos !== "All" && <span className="self-center text-xs text-zinc-400">Showing only {pos === "DEF" ? "DST" : pos}. Rank numbers are still overall.</span>}
      </div>

      {sel.length > 1 && (
        <p className="flex flex-wrap items-center gap-2 rounded-lg bg-[#DCE6D6] px-3 py-2 text-sm font-semibold">
          {sel.length} players connected. Drag any one&apos;s ⠿ handle (or use its Tier menu) to move them all together. Shift+click another row to extend.
          <button className="underline" onClick={() => setSel([])}>Clear</button>
        </p>
      )}
      <div
        className={`space-y-5 overflow-x-auto pb-1 ${selecting ? "select-none" : ""}`}
        onMouseDown={(e) => {
          if (e.button !== 0) return;
          const t = e.target as HTMLElement;
          if (t.closest("button, select, a, input, [draggable='true']")) return;
          const row = t.closest("tr[data-pid]") as HTMLElement | null;
          if (!row) { setSel([]); return; }
          const id = Number(row.dataset.pid);
          // Shift+click connects everything between the last row you started on and this one.
          if (e.shiftKey && base.current !== null) { e.preventDefault(); anchor.current = base.current; setSelecting(true); extendTo(id); return; }
          anchor.current = id; base.current = id; setSelecting(true); setSel([id]);
        }}
        onMouseOver={(e) => {
          if (!selecting || anchor.current === null) return;
          const row = (e.target as HTMLElement).closest("tr[data-pid]") as HTMLElement | null;
          if (row) extendTo(Number(row.dataset.pid));
        }}
      >
        {cards.map((run, ri) => {
          const c = run.tier ? COLORS[run.tier] : "#8b8576";
          return (
            <div
              key={ri} className={`gl-tierbox min-w-[50rem] ${over && "card" in over && over.card === run.tier ? "drop-card" : ""}`}
              onDragOver={(e) => { if (dragId === null) return; e.preventDefault(); if (!over || !("card" in over) || over.card !== run.tier) setOver({ card: run.tier }); }}
              onDrop={(e) => { e.preventDefault(); dropOnTier(run.tier); endDrag(); }}
            >
              <table className="gl-table dark gl-cols">
                <colgroup>
                  <col style={{ width: "5rem" }} /><col />
                  <col style={{ width: "6.5rem" }} /><col style={{ width: "6rem" }} /><col style={{ width: "5rem" }} /><col style={{ width: "15.5rem" }} />
                </colgroup>
                <thead>
                  <tr>
                    <th scope="col" colSpan={2} className="!text-left">
                      <span className="flex items-center">
                        <span className="tier-chip" style={{ background: c, color: tierInk(run.tier) }}>{run.tier || "–"}</span>
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
                  {run.idx.length === 0 && (
                    <tr><td colSpan={6} className="!py-4 text-sm text-zinc-400">{pos === "All" ? "No players in this tier yet." : `No ${label(pos)} players in this tier.`} Drag a player here, or move one to the edge of the tier above or below and press ▲ or ▼.</td></tr>
                  )}
                  {run.idx.map((i) => {
                    const it = items[i];
                    const l = lines[it.player_id];
                    return (
                      <tr
                        key={it.player_id} data-pid={it.player_id}
                        className={`${dragIds.includes(it.player_id) || dragId === it.player_id ? "dragging" : ""} ${over && "id" in over && over.id === it.player_id ? (over.after ? "drop-after" : "drop-before") : ""}`}
                        style={sel.length > 1 && sel.includes(it.player_id) ? { background: "#DCE6D6" } : it.placed ? undefined : { background: "#fcf1cc" }}
                        onDragOver={(e) => {
                          if (dragId === null) return;
                          e.preventDefault(); e.stopPropagation();
                          const r = e.currentTarget.getBoundingClientRect();
                          const after = e.clientY > r.top + r.height / 2;
                          if (!over || !("id" in over) || over.id !== it.player_id || over.after !== after) setOver({ id: it.player_id, after });
                        }}
                        onDrop={(e) => { e.preventDefault(); e.stopPropagation(); if (over && "id" in over) dropOnRow(over.id, over.after); endDrag(); }}
                      >
                        <td className="w-16 font-semibold whitespace-nowrap">
                          <span
                            draggable aria-label={`Drag ${it.name}`} title="Drag to move"
                            className="mr-1 inline-block cursor-grab select-none px-1 text-zinc-500 active:cursor-grabbing"
                            onDragStart={(e) => {
                              e.dataTransfer.effectAllowed = "move";
                              e.dataTransfer.setData("text/plain", String(it.player_id));
                              const row = e.currentTarget.closest("tr");
                              if (row) e.dataTransfer.setDragImage(row, 20, 20);
                              setDragIds(sel.length > 1 && sel.includes(it.player_id) ? sel : []);
                              setDragId(it.player_id);
                            }}
                            onDragEnd={endDrag}
                          >⠿</span>
                          {pos === "All" ? listRank[i] : i + 1}
                        </td>
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
                            <select
                              className={`${btn} w-[4.25rem] cursor-pointer !px-1 text-xs`} value="" aria-label={`Put ${it.name} in a tier`} title="Put in a tier"
                              onChange={(e) => { if (e.target.value !== "") moveToTier(sel.length > 1 && sel.includes(it.player_id) ? sel : [it.player_id], e.target.value === "__none" ? "" : e.target.value, true); }}
                            >
                              <option value="" disabled>Tier</option>
                              {ORDER.map((t) => <option key={t} value={t}>{t}</option>)}
                              <option value="__none">Unsorted</option>
                            </select>
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
      {inView.length > limit && (
        <button onClick={() => setLimit(limit + 100)} className="gl-pill block w-full !py-3 text-center">
          Show {Math.min(100, inView.length - limit)} more ({inView.length - limit} left)
        </button>
      )}
    </div>
  );
}
