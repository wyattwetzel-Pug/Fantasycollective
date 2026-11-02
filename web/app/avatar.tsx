"use client";

import { useState } from "react";

// A player's photo in a circle. Falls back to initials when there is no photo.
export function Avatar({ id, name, size = 32, className = "" }: { id: number; name?: string; size?: number; className?: string }) {
  const [failed, setFailed] = useState(false);
  const initials = (name ?? "").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
  return (
    <span
      className={`relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-zinc-700 text-zinc-300 ${className}`}
      style={{ width: size, height: size, fontSize: Math.max(10, size / 3) }}
      aria-hidden="true"
    >
      {initials}
      {!failed && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={`/photo/${id}`} alt="" loading="lazy" onError={() => setFailed(true)} className="absolute inset-0 h-full w-full bg-zinc-700 object-cover object-top" />
      )}
    </span>
  );
}
