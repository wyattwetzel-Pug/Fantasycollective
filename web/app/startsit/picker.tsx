"use client";

import { Avatar } from "@/app/avatar";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

export type PickerPlayer = { id: number; name: string; position: string; team: string; rank: number };

// Chooses 2 to 4 players. The choice lives in the URL (?p=1,2,3) so the server can load the comparison.
export function Picker({ players, selected, base }: { players: PickerPlayer[]; selected: number[]; base: Record<string, string> }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const byId = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);

  function go(ids: number[]) {
    const qs = new URLSearchParams(base);
    if (ids.length) qs.set("p", ids.join(","));
    router.replace(`/startsit${qs.size ? `?${qs}` : ""}`);
  }

  const matches = useMemo(() => {
    const s = q.trim().toLowerCase();
    return players.filter((p) => !selected.includes(p.id) && (!s || p.name.toLowerCase().includes(s))).slice(0, 8);
  }, [players, selected, q]);

  return (
    <div className="space-y-3">
      <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(12rem,1fr))" }}>
        {selected.map((id) => {
          const p = byId.get(id);
          if (!p) return null;
          return (
            <div key={id} className="relative flex min-h-[5.5rem] items-center gap-3 rounded-xl border p-3" style={{ borderColor: "#39ff14", background: "#0a140a", boxShadow: "0 0 10px #39ff1433" }}>
              <button className="absolute right-2 top-2 h-5 w-5 rounded-full bg-zinc-700 text-[10px] leading-5" aria-label={`Remove ${p.name}`} onClick={() => go(selected.filter((x) => x !== id))}>✕</button>
              <Avatar id={id} name={p.name} size={48} />
              <span className="min-w-0 flex-1 pt-3">
                <span className="pn block text-sm leading-tight">{p.name}</span>
                <span className="block text-xs text-zinc-400">{p.position} - {p.team}</span>
              </span>
            </div>
          );
        })}
      </div>
      {selected.length < 4 && (
        <div className="relative max-w-md">
          <input
            value={q} placeholder={selected.length < 2 ? "+ Add a player to compare" : "+ Add another player"} aria-label="Add a player"
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
                    onClick={() => { go([...selected, p.id]); setQ(""); setOpen(false); }}>
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
      )}
    </div>
  );
}
