"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

// The sheet's tabs in one dropdown. It closes when you pick a tab, click anywhere else, or press Escape.
export function SheetMenu({ leagueId, names, current, active }: { leagueId: number; names: string[]; current: string | undefined; active: boolean }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", away); document.removeEventListener("keydown", esc); };
  }, [open]);

  return (
    <div ref={box} className="relative">
      <button type="button" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((o) => !o)} className={`gl-pill !px-5 ${active ? "on" : ""}`}>
        {active && current ? current : `Sheet tabs (${names.length})`} <span aria-hidden="true" className="ml-1 text-xs">▾</span>
      </button>
      {open && (
        <div role="listbox" className="absolute left-0 z-20 mt-2 max-h-80 w-60 overflow-auto rounded-xl border bg-[var(--card)] p-1 shadow-lg" style={{ borderColor: "var(--card-line)" }}>
          {names.map((n) => (
            <Link
              key={n} role="option" aria-selected={active && current === n} onClick={() => setOpen(false)}
              href={`/teams?league=${leagueId}&tab=sheet&sheettab=${encodeURIComponent(n)}`}
              className={`block rounded-lg px-3 py-2 text-sm hover:bg-[#EDE9DF] ${active && current === n ? "bg-[var(--hilite)] font-bold" : "font-medium"}`}
            >{n}</Link>
          ))}
        </div>
      )}
    </div>
  );
}
