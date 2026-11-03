"use client";

import { useId, useState } from "react";

export type WeekPoint = { week: number; pts: number };

const W = 640, H = 300, L = 44, R = 28, T = 26, B = 44;

// Smooth curve through the points that never overshoots between them.
function smooth(p: [number, number][]) {
  const n = p.length;
  if (n < 2) return "";
  const dx: number[] = [], m: number[] = [], t: number[] = [];
  for (let i = 0; i < n - 1; i++) { dx[i] = p[i + 1][0] - p[i][0]; m[i] = (p[i + 1][1] - p[i][1]) / dx[i]; }
  t[0] = m[0]; t[n - 1] = m[n - 2];
  for (let i = 1; i < n - 1; i++) t[i] = m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) { t[i] = 0; t[i + 1] = 0; continue; }
    const a = t[i] / m[i], b = t[i + 1] / m[i], s = a * a + b * b;
    if (s > 9) { const k = 3 / Math.sqrt(s); t[i] = k * a * m[i]; t[i + 1] = k * b * m[i]; }
  }
  let d = `M${p[0][0]},${p[0][1]}`;
  for (let i = 0; i < n - 1; i++) d += `C${p[i][0] + dx[i] / 3},${p[i][1] + (t[i] * dx[i]) / 3} ${p[i + 1][0] - dx[i] / 3},${p[i + 1][1] - (t[i + 1] * dx[i]) / 3} ${p[i + 1][0]},${p[i + 1][1]}`;
  return d;
}

// Fantasy points week by week: a green area with the ups and downs of the season.
export function PointsChart({ data, scoring }: { data: WeekPoint[]; scoring: string }) {
  const id = useId().replace(/:/g, "");
  const [hover, setHover] = useState<number | null>(null);
  if (data.length < 2) return <p className="text-sm text-zinc-400">Not enough games yet to draw a chart.</p>;

  const top = Math.max(...data.map((d) => d.pts), 1);
  const step = top > 40 ? 10 : 5;
  const max = Math.ceil(top / step) * step;
  const ticks: number[] = [];
  for (let v = 0; v <= max; v += step) ticks.push(v);

  const w0 = data[0].week, w1 = data[data.length - 1].week;
  const x = (wk: number) => L + ((wk - w0) / Math.max(1, w1 - w0)) * (W - L - R);
  const y = (v: number) => T + (1 - Math.max(0, v) / max) * (H - T - B);
  const pts: [number, number][] = data.map((d) => [x(d.week), y(d.pts)]);
  const line = smooth(pts);
  const base = y(0);
  const area = `${line}L${pts[pts.length - 1][0]},${base}L${pts[0][0]},${base}Z`;
  const last = data.length - 1;
  const active = hover ?? last;

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`${scoring} fantasy points by week`} onMouseLeave={() => setHover(null)}>
        <defs>
          <linearGradient id={`fill${id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#9BCB6A" stopOpacity="0.75" />
            <stop offset="60%" stopColor="#6FB27A" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#55745D" stopOpacity="0.04" />
          </linearGradient>
          <linearGradient id={`fade${id}`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#fff" stopOpacity="0" />
            <stop offset="12%" stopColor="#fff" stopOpacity="1" />
          </linearGradient>
          <mask id={`mask${id}`}><rect x="0" y="0" width={W} height={H} fill={`url(#fade${id})`} /></mask>
        </defs>

        {ticks.map((v) => (
          <g key={v}>
            <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke="#d9d4c6" strokeWidth="1" strokeDasharray={v === 0 ? undefined : "3 5"} />
            <text x={L - 8} y={y(v) + 4} textAnchor="end" fontSize="12" fill="#8b8576">{v}</text>
          </g>
        ))}
        <text x={L - 8} y={12} textAnchor="end" fontSize="11" fill="#8b8576">pts</text>

        {data.map((d, i) => (
          <line key={d.week} x1={x(d.week)} x2={x(d.week)} y1={T} y2={base} stroke={i === active ? "#55745D" : "#e3dfd2"} strokeWidth="1" />
        ))}

        <g mask={`url(#mask${id})`}>
          <path d={area} fill={`url(#fill${id})`} />
          <path d={line} fill="none" stroke="#55745D" strokeOpacity="0.25" strokeWidth="7" strokeLinecap="round" />
          <path d={line} fill="none" stroke="#1f2a22" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
        </g>

        {data.map((d, i) => (
          <g key={d.week}>
            <circle cx={pts[i][0]} cy={pts[i][1]} r={i === active ? 5 : 3} fill="#1f2a22" />
            <text x={x(d.week)} y={H - 16} textAnchor="middle" fontSize="13" fontWeight={i === active ? 800 : 500} fill={i === active ? "#1f2a22" : "#b3ae9f"}>w {d.week}</text>
            <rect x={x(d.week) - (W - L - R) / Math.max(1, data.length - 1) / 2} y={0} width={(W - L - R) / Math.max(1, data.length - 1)} height={H} fill="transparent" onMouseEnter={() => setHover(i)} onClick={() => setHover(i)} />
          </g>
        ))}
      </svg>

      <div
        className="pointer-events-none absolute whitespace-nowrap rounded-xl border border-[#e3dfd2] bg-[#FBFAF6]/90 px-3 py-1.5 text-sm font-semibold shadow-sm"
        style={{ left: `${Math.min(86, Math.max(8, (pts[active][0] / W) * 100))}%`, top: `${Math.max(2, (pts[active][1] / H) * 100 - 16)}%`, transform: "translateX(-50%)" }}
      >
        Week {data[active].week} · {data[active].pts.toFixed(1)} pts
      </div>
    </div>
  );
}
