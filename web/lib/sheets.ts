import { cacheLife, cacheTag } from "next/cache";
import ExcelJS from "exceljs";

// One cell, with the parts of its formatting we copy: colors, bold, alignment, borders and merges.
export type SheetCell = {
  v: string; b?: boolean; i?: boolean; c?: string; bg?: string; a?: "left" | "center" | "right";
  bt?: string; br?: string; bb?: string; bl?: string; cs?: number; rs?: number; skip?: boolean;
};
export type SheetTab = { name: string; cols: number[]; rows: { h: number; cells: SheetCell[] }[] };
export type SheetResult = { ok: true; tabs: SheetTab[] } | { ok: false; error: string };

const MAX_ROWS = 250;
const MAX_COLS = 40;

// The long id in a Google Sheets link: docs.google.com/spreadsheets/d/<id>/edit
export function sheetIdFrom(url: string): string | null {
  const m = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]{20,})/);
  return m ? m[1] : null;
}

const hex = (c: { argb?: string } | undefined): string | undefined => {
  const a = c?.argb;
  return a && a.length === 8 ? `#${a.slice(2)}` : undefined;
};

const group = (n: number, d: number, commas: boolean) => {
  const s = Math.abs(n).toFixed(d);
  if (!commas) return s;
  const [i, f] = s.split(".");
  return i.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (f ? `.${f}` : "");
};

// Shows a number the way the sheet's number format does (dollars, percents, decimals).
function formatNumber(n: number, fmt: string): string {
  const decimals = (fmt.split(";")[0].match(/\.(0+)/)?.[1] ?? "").length;
  const commas = fmt.includes(",");
  const sign = n < 0 ? "-" : "";
  if (fmt.includes("%")) return `${sign}${group(n * 100, decimals, commas)}%`;
  if (fmt.includes("$")) return `${sign}$${group(n, decimals, commas)}`;
  if (fmt === "General" || fmt === "") return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
  return `${sign}${group(n, decimals, commas)}`;
}

function cellText(cell: ExcelJS.Cell): { v: string; num: boolean } {
  let val: unknown = cell.value;
  if (val && typeof val === "object" && !(val instanceof Date)) {
    const o = val as { result?: unknown; richText?: { text: string }[]; text?: unknown; error?: string };
    if (o.richText) return { v: o.richText.map((r) => r.text).join(""), num: false };
    if ("result" in o) val = o.result;
    else if ("text" in o) val = o.text;
    else if (o.error) return { v: o.error, num: false };
  }
  if (val === null || val === undefined) return { v: "", num: false };
  if (val instanceof Date) return { v: val.toLocaleDateString("en-US", { timeZone: "UTC" }), num: false };
  if (typeof val === "number") return { v: formatNumber(val, cell.numFmt ?? "General"), num: true };
  return { v: String(val), num: false };
}

const range = (ref: string) => {
  const m = ref.match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/);
  if (!m) return null;
  const col = (s: string) => s.split("").reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
  return { c1: col(m[1]), r1: Number(m[2]), c2: col(m[3]), r2: Number(m[4]) };
};

// Reads every tab of an .xlsx file, keeping the layout (column widths, row heights, merges) and look.
export async function parseWorkbook(buffer: ArrayBuffer | Buffer): Promise<SheetTab[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as ArrayBuffer);
  return wb.worksheets.map((ws) => {
    const nCols = Math.min(MAX_COLS, ws.columnCount);
    let nRows = Math.min(MAX_ROWS, ws.rowCount);

    // Last row / column that has anything in it (text or a fill), so trailing blanks don't take space.
    let lastRow = 0, lastCol = 0;
    for (let r = 1; r <= nRows; r++) {
      for (let c = 1; c <= nCols; c++) {
        const cell = ws.getCell(r, c);
        if (cellText(cell).v !== "" || hex((cell.fill as { fgColor?: { argb?: string } } | undefined)?.fgColor)) { lastRow = Math.max(lastRow, r); lastCol = Math.max(lastCol, c); }
      }
    }
    nRows = lastRow;

    const spans = new Map<string, { cs: number; rs: number }>();
    const covered = new Set<string>();
    ((ws.model as { merges?: string[] }).merges ?? []).forEach((m) => {
      const g = range(m);
      if (!g) return;
      spans.set(`${g.r1},${g.c1}`, { cs: g.c2 - g.c1 + 1, rs: g.r2 - g.r1 + 1 });
      for (let r = g.r1; r <= g.r2; r++) for (let c = g.c1; c <= g.c2; c++) if (r !== g.r1 || c !== g.c1) covered.add(`${r},${c}`);
    });

    const cols = Array.from({ length: lastCol }, (_, i) => Math.round((ws.getColumn(i + 1).width ?? 8.43) * 7 + 5));
    const rows = Array.from({ length: nRows }, (_, ri) => {
      const r = ri + 1;
      const row = ws.getRow(r);
      const cells: SheetCell[] = Array.from({ length: lastCol }, (_, ci) => {
        const c = ci + 1;
        if (covered.has(`${r},${c}`)) return { v: "", skip: true };
        const cell = ws.getCell(r, c);
        const { v, num } = cellText(cell);
        const out: SheetCell = { v };
        if (cell.font?.bold) out.b = true;
        if (cell.font?.italic) out.i = true;
        const fc = hex(cell.font?.color as { argb?: string } | undefined);
        if (fc && fc !== "#000000") out.c = fc;
        const fill = cell.fill as { type?: string; pattern?: string; fgColor?: { argb?: string } } | undefined;
        if (fill?.type === "pattern" && fill.pattern === "solid") { const bg = hex(fill.fgColor); if (bg && bg !== "#FFFFFF") out.bg = bg; }
        const h = cell.alignment?.horizontal;
        out.a = h === "center" || h === "right" || h === "left" ? h : num ? "right" : "left";
        const side = (s: { style?: string; color?: { argb?: string } } | undefined) => (s?.style ? hex(s.color) ?? "#000000" : undefined);
        const bd = cell.border;
        out.bt = side(bd?.top); out.br = side(bd?.right); out.bb = side(bd?.bottom); out.bl = side(bd?.left);
        const sp = spans.get(`${r},${c}`);
        if (sp) { out.cs = sp.cs; out.rs = sp.rs; }
        return out;
      });
      return { h: Math.round((row.height ?? 15) * 1.333), cells };
    });
    return { name: ws.name, cols, rows };
  });
}

// Downloads the whole workbook (every tab) from Google. The sheet must be shared as
// "Anyone with the link can view", since this server can't sign in to a Google account.
export async function fetchSheet(id: string): Promise<SheetResult> {
  try {
    const res = await fetch(`https://docs.google.com/spreadsheets/d/${id}/export?format=xlsx`, { redirect: "follow", cache: "no-store" });
    const type = res.headers.get("content-type") ?? "";
    if (!res.ok || !type.includes("spreadsheetml")) {
      return { ok: false, error: "Google wouldn't share that sheet. In Google Sheets click Share, then under General access choose \"Anyone with the link\" as Viewer." };
    }
    return { ok: true, tabs: await parseWorkbook(await res.arrayBuffer()) };
  } catch (e) {
    return { ok: false, error: `Could not read the sheet: ${e instanceof Error ? e.message : String(e)}` };
  }
}

// Kept for a few minutes so the page stays quick. Edits in the sheet show up within a few minutes,
// or right away with the Refresh button.
export async function loadSheet(id: string): Promise<SheetResult> {
  "use cache";
  cacheLife("minutes");
  cacheTag(`sheet-${id}`);
  return fetchSheet(id);
}
