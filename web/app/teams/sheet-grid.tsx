"use client";

import { useEffect, useRef, useState } from "react";
import type { SheetTab } from "@/lib/sheets";

// The sheet drawn like Google Sheets: same column widths, colors and merged cells, shrunk to fit the screen.
export function SheetGrid({ tab }: { tab: SheetTab }) {
  const box = useRef<HTMLDivElement>(null);
  const width = tab.cols.reduce((a, b) => a + b, 0);
  const [fit, setFit] = useState(1);
  const [manual, setManual] = useState<number | null>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setFit(Math.max(0.8, Math.min(1, (el.clientWidth - 2) / width)));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [width]);

  const zoom = manual ?? fit;
  const step = (d: number) => setManual(Math.min(1.5, Math.max(0.3, Math.round((zoom + d) * 100) / 100)));

  return (
    <div>
      <div className="mb-1 flex items-center justify-end gap-1 text-xs text-zinc-500">
        <button type="button" onClick={() => step(-0.1)} className="gl-pill !px-2.5 !py-0.5" aria-label="Zoom out">−</button>
        <span className="w-10 text-center tabular-nums">{Math.round(zoom * 100)}%</span>
        <button type="button" onClick={() => step(0.1)} className="gl-pill !px-2.5 !py-0.5" aria-label="Zoom in">+</button>
        <button type="button" onClick={() => setManual(null)} className="gl-pill !px-2.5 !py-0.5">Fit</button>
      </div>
      <div ref={box} className="overflow-auto rounded-lg border" style={{ borderColor: "var(--card-line)", background: "#ffffff" }}>
        <div style={{ zoom }}>
          <table style={{ tableLayout: "fixed", width, borderCollapse: "collapse", fontFamily: "Arial, Helvetica, sans-serif", fontSize: 13, color: "#000" }}>
            <colgroup>{tab.cols.map((w, i) => <col key={i} style={{ width: w }} />)}</colgroup>
            <tbody>
              {tab.rows.map((r, ri) => (
                <tr key={ri} style={{ height: r.h }}>
                  {r.cells.map((c, ci) => c.skip ? null : (
                    <td
                      key={ci} colSpan={c.cs} rowSpan={c.rs}
                      style={{
                        background: c.bg, color: c.c, fontWeight: c.b ? 700 : 400, fontStyle: c.i ? "italic" : undefined, textAlign: c.a,
                        padding: "0 4px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "clip",
                        border: "1px solid #e2e3e3", borderTop: c.bt ? `1px solid ${c.bt}` : undefined, borderRight: c.br ? `1px solid ${c.br}` : undefined,
                        borderBottom: c.bb ? `1px solid ${c.bb}` : undefined, borderLeft: c.bl ? `1px solid ${c.bl}` : undefined,
                      }}
                    >{c.chip ? <span style={{ background: c.chip, color: "#fff", borderRadius: 999, padding: "1px 9px", fontWeight: 700, fontSize: "0.9em" }}>{c.v}</span> : c.v}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
