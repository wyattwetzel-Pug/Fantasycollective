"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type Item = { label: string; icon: React.ReactNode; href: string };

const svg = (d: React.ReactNode) => (
  <svg className="gl-nav-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d}</svg>
);

const MAIN: Item[] = [
  { label: "Home", href: "/", icon: svg(<><path d="M3 11l9-8 9 8" /><path d="M5 10v10h14V10" /></>) },
  { label: "My Teams", href: "/teams", icon: svg(<><circle cx="9" cy="8" r="3.2" /><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" /><circle cx="17" cy="9" r="2.5" /><path d="M16 14.2c2.9.2 5 2.4 5 5.3" /></>) },
  { label: "Rankings", href: "/rankings", icon: svg(<><path d="M5 20V10M10 20V4M15 20v-8M20 20v-5" /></>) },
  { label: "Start / Sit", href: "/startsit", icon: svg(<><path d="M4 8h14M14 4l4 4-4 4" /><path d="M20 16H6M10 12l-4 4 4 4" /></>) },
  { label: "Trade Calculator", href: "/trade", icon: svg(<><path d="M4 8h14M14 4l4 4-4 4" /><path d="M20 16H6M10 12l-4 4 4 4" /></>) },
  { label: "Dynasty Hub", href: "/dynasty", icon: svg(<><path d="M12 3l7 3v5c0 4.5-3 8.2-7 10-4-1.8-7-5.5-7-10V6l7-3z" /><circle cx="12" cy="11" r="2.4" /></>) },
  { label: "Draft Guide", href: "/draft", icon: svg(<><rect x="4" y="4" width="16" height="16" rx="2" /><path d="M9 9l6 6M15 9l-6 6" /></>) },
];

export function Sidebar({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname();
  const items = [...MAIN];
  if (isAdmin) items.push({ label: "Site Stats", href: "/stats", icon: svg(<><path d="M4 20h16" /><rect x="5" y="11" width="3" height="7" /><rect x="10.5" y="6" width="3" height="12" /><rect x="16" y="9" width="3" height="9" /></>) });
  if (isAdmin) items.push({ label: "Admin", href: "/admin", icon: svg(<><path d="M12 3l8 4v5c0 4.4-3.2 7.8-8 9-4.8-1.2-8-4.6-8-9V7l8-4z" /><path d="M9 12l2 2 4-4" /></>) });

  return (
    <nav aria-label="Primary" className="fixed bottom-0 left-0 top-0 z-40 flex w-16 flex-col overflow-hidden sm:w-56"
         style={{ background: "#EDE9DF", borderRight: "1px solid #DEDAD0" }}>
      <Link href="/" className="flex justify-center px-3 pb-5 pt-5 sm:px-5" aria-label="FantasyForecast home">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-icon.png" alt="FantasyForecast" width={40} height={40} className="h-10 w-10 sm:hidden" />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.png" alt="FantasyForecast" width={717} height={414} className="hidden h-auto w-full max-w-[11rem] sm:block" />
      </Link>
      <ul className="flex flex-col gap-1 overflow-y-auto p-2 sm:px-3">
        {items.map((it) => {
          const on = it.href === "/" ? pathname === "/" : pathname === it.href || pathname.startsWith(`${it.href}/`);
          return (
            <li key={it.label}>
              <Link href={it.href} className={`gl-nav ${on ? "on" : ""}`} aria-current={on ? "page" : undefined} aria-label={it.label}>
                {it.icon}
                <span className="hidden sm:inline">{it.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
      <svg className="mt-auto w-full" viewBox="0 0 224 120" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
        <polygon points="0,120 0,70 40,30 70,62 110,10 150,66 185,40 224,80 224,120" fill="#55745D" fillOpacity="0.45" />
        <polygon points="0,120 0,95 30,70 60,92 100,58 140,95 190,72 224,100 224,120" fill="#55745D" />
      </svg>
    </nav>
  );
}
