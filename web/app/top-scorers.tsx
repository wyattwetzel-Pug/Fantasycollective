"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Avatar } from "@/app/avatar";

export type Scorer = { id: number; name: string; position: string; points: number; played: number };

// The season's top scorer at each position, fading from one to the next.
export function TopScorers({ items }: { items: Scorer[] }) {
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused || items.length < 2 || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const t = setInterval(() => setActive((i) => (i + 1) % items.length), 4500);
    return () => clearInterval(t);
  }, [paused, items.length]);

  if (!items.length) return null;
  return (
    <div className="md:mr-4" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
      <div className="grid rounded-2xl border bg-[var(--card)]" style={{ borderColor: "var(--card-line)" }}>
        {items.map((s, i) => (
          <Link
            key={s.id} href={`/players/${s.id}`} aria-hidden={i !== active} tabIndex={i === active ? 0 : -1}
            className={`col-start-1 row-start-1 flex items-center gap-4 p-4 transition-opacity duration-1000 ease-in-out ${i === active ? "opacity-100" : "pointer-events-none opacity-0"}`}
          >
            <Avatar id={s.id} name={s.name} size={112} />
            <span className="min-w-[13rem]">
              <span className="block text-xs font-bold tracking-widest" style={{ color: "var(--accent)" }}>#1 {s.position} · MOST POINTS SCORED</span>
              <span className="mt-1 block text-2xl font-extrabold leading-tight">{s.name}</span>
              <span className="mt-1 flex items-center gap-2 text-sm text-zinc-500"><span className={`bd ${s.position}`}>{s.position}</span>{s.points.toFixed(1)} pts · {s.played} games</span>
            </span>
          </Link>
        ))}
      </div>
      <div className="mt-2 flex justify-center gap-1.5" aria-hidden="true">
        {items.map((s, i) => (
          <span key={s.id} className="h-1.5 rounded-full transition-all duration-700" style={{ width: i === active ? 18 : 6, background: i === active ? "var(--accent)" : "#cfcabd" }} />
        ))}
      </div>
    </div>
  );
}
