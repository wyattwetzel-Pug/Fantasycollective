"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type Item = { label: string; icon: string; href?: string };

const MAIN: Item[] = [
  { label: "Home", icon: "🏠", href: "/" },
  { label: "My Teams", icon: "👥", href: "/teams" },
  { label: "Rankings", icon: "🥇", href: "/rankings" },
  { label: "Start / Sit", icon: "🤔", href: "/startsit" },
  { label: "Trade", icon: "🤝", href: "/trade" },
  { label: "Dynasty", icon: "👑", href: "/dynasty" },
  { label: "Draft", icon: "📋", href: "/draft" },
];

export function Sidebar({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname();
  const items = [...MAIN];
  if (isAdmin) items.push({ label: "Admin", icon: "🛡️", href: "/admin" });

  return (
    <nav aria-label="Primary" className="fixed bottom-0 left-0 top-0 z-40 flex w-16 flex-col overflow-hidden sm:w-48"
         style={{ background: "#030503", borderRight: "1px solid #1a2a1a" }}>
      <ul className="flex flex-col gap-3 overflow-y-auto p-2 pt-10 sm:p-3 sm:pt-10">
        {items.map((it) => {
          const inner = (
            <>
              <span className="gl-nav-ico" aria-hidden="true">{it.icon}</span>
              <span className="gl-nav-sep" aria-hidden="true" />
              <span className="hidden sm:inline">{it.label}</span>
            </>
          );
          if (!it.href) {
            return (
              <li key={it.label}>
                <span className="gl-nav soon" title="Coming soon" aria-disabled="true" aria-label={`${it.label} (coming soon)`}>{inner}</span>
              </li>
            );
          }
          const on = it.href === "/" ? pathname === "/" : pathname === it.href || pathname.startsWith(`${it.href}/`);
          return (
            <li key={it.label}>
              <Link href={it.href} className={`gl-nav ${on ? "on" : ""}`} aria-current={on ? "page" : undefined} aria-label={it.label}>{inner}</Link>
            </li>
          );
        })}
      </ul>
      <div className="gl-field mt-auto" aria-hidden="true" />
    </nav>
  );
}
