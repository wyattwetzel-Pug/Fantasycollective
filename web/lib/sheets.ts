import { cacheLife, cacheTag } from "next/cache";
import ExcelJS from "exceljs";
import JSZip from "jszip";

// One cell, with the parts of its formatting we copy: colors, bold, alignment, borders and merges.
export type SheetCell = {
  v: string; b?: boolean; i?: boolean; c?: string; bg?: string; a?: "left" | "center" | "right";
  bt?: string; br?: string; bb?: string; bl?: string; cs?: number; rs?: number; skip?: boolean; chip?: string;
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

type Color = { argb?: string; theme?: number; tint?: number } | undefined;

// Excel's theme slots: 0 and 1 and 2 and 3 are light1, dark1, light2, dark2; then the six accents.
const THEME_ORDER = ["lt1", "dk1", "lt2", "dk2", "accent1", "accent2", "accent3", "accent4", "accent5", "accent6", "hlink", "folHlink"];
const shade = (rgb: string, tint: number) => {
  const n = [0, 2, 4].map((i) => parseInt(rgb.slice(i, i + 2), 16));
  const out = n.map((v) => Math.round(tint >= 0 ? v + (255 - v) * tint : v * (1 + tint)));
  return `#${out.map((v) => v.toString(16).padStart(2, "0")).join("")}`.toUpperCase();
};
const lum = (h: string) => { const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)); return (0.299 * r + 0.587 * g + 0.114 * b) / 255; };

type Style = { header?: string; stripe1?: string; stripe2?: string; edge?: string };

// Google keeps the green headers, row stripes and table outlines in the table styles, not in the cells.
async function readStyles(buffer: ArrayBuffer | Buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const theme = (await zip.file("xl/theme/theme1.xml")?.async("string")) ?? "";
  const palette = new Map<string, string>();
  for (const k of THEME_ORDER) { const m = theme.match(new RegExp(`<a:${k}>\\s*<a:\\w+ (?:val|lastClr)="([0-9A-Fa-f]{6})"`)); if (m) palette.set(k, m[1].toUpperCase()); }

  const stylesXml = (await zip.file("xl/styles.xml")?.async("string")) ?? "";
  const dxfs = [...stylesXml.matchAll(/<dxf>([\s\S]*?)<\/dxf>/g)].map((m) => ({
    fill: m[1].match(/<fgColor rgb="[0-9A-F]{2}([0-9A-F]{6})"/)?.[1],
    edge: m[1].match(/<border>[\s\S]*?<color rgb="[0-9A-F]{2}([0-9A-F]{6})"/)?.[1],
  }));
  const styles = new Map<string, Style>();
  for (const m of stylesXml.matchAll(/<tableStyle [^>]*name="([^"]+)"[^>]*>([\s\S]*?)<\/tableStyle>/g)) {
    const byType: Record<string, number> = {};
    for (const e of m[2].matchAll(/<tableStyleElement ([^>]*)\/>/g)) {
      const id = e[1].match(/dxfId="(\d+)"/)?.[1], type = e[1].match(/type="(\w+)"/)?.[1];
      if (id !== undefined && type) byType[type] = Number(id);
    }
    const f = (t: string) => { const c = dxfs[byType[t]]?.fill; return c ? `#${c}` : undefined; };
    const edge = dxfs[byType.wholeTable]?.edge;
    styles.set(m[1], { header: f("headerRow"), stripe1: f("firstRowStripe"), stripe2: f("secondRowStripe"), edge: edge ? `#${edge}` : undefined });
  }
  return { palette, styles };
}

const POS_CHIP: Record<string, string> = { QB: "#4F7FD1", RB: "#4F7F5C", WR: "#8A63C7", TE: "#C95757", K: "#8B6B4A", DEF: "#8D8A80", DST: "#8D8A80" };

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
  const { palette, styles } = await readStyles(buffer);
  const hex = (c: Color): string | undefined => {
    if (!c) return undefined;
    if (c.argb && c.argb.length === 8) return `#${c.argb.slice(2).toUpperCase()}`;
    if (c.theme !== undefined) { const base = palette.get(THEME_ORDER[c.theme]); return base ? (c.tint ? shade(base, c.tint) : `#${base}`) : undefined; }
    return undefined;
  };
  return wb.worksheets.map((ws) => {
    const nCols = Math.min(MAX_COLS, ws.columnCount);
    let nRows = Math.min(MAX_ROWS, ws.rowCount);

    // Last row / column that has anything in it (text or a fill), so trailing blanks don't take space.
    let lastRow = 0, lastCol = 0;
    for (let r = 1; r <= nRows; r++) {
      for (let c = 1; c <= nCols; c++) {
        const cell = ws.getCell(r, c);
        if (cellText(cell).v !== "") { lastRow = Math.max(lastRow, r); lastCol = Math.max(lastCol, c); }
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

    // Table styling: header row, row stripes and the outline, by position inside each table.
    type Look = { bg?: string; header?: boolean; bt?: string; br?: string; bb?: string; bl?: string };
    const looks = new Map<string, Look>();
    type TableModel = { tableRef?: string; style?: { theme?: string } };
    for (const t of Object.values((ws as unknown as { tables?: Record<string, { table?: TableModel }> }).tables ?? {})) {
      const model = t.table;
      const g = range(model?.tableRef ?? "");
      const st = styles.get(model?.style?.theme ?? "");
      if (!g || !st) continue;
      for (let r = g.r1; r <= g.r2; r++) for (let c = g.c1; c <= g.c2; c++) {
        const look: Look = {};
        if (r === g.r1) { look.header = true; look.bg = st.header; }
        else look.bg = (r - g.r1) % 2 === 1 ? st.stripe1 : st.stripe2;
        if (st.edge) {
          if (r === g.r1) look.bt = st.edge;
          if (r === g.r2) look.bb = st.edge;
          if (c === g.c1) look.bl = st.edge;
          if (c === g.c2) look.br = st.edge;
        }
        looks.set(`${r},${c}`, look);
      }
    }

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
        const look = looks.get(`${r},${c}`);
        const fill = cell.fill as { type?: string; pattern?: string; fgColor?: Color } | undefined;
        const explicit = fill?.type === "pattern" && fill.pattern === "solid" ? hex(fill.fgColor) : undefined;
        const bg = explicit ?? look?.bg;
        if (bg && bg !== "#FFFFFF") out.bg = bg;
        if (cell.font?.bold || look?.header) out.b = true;
        if (cell.font?.italic) out.i = true;
        let fc = hex(cell.font?.color as Color);
        if (look?.header) fc = "#FFFFFF";
        else if (fc === "#000000") fc = undefined;
        const POS = POS_CHIP[v];
        if (POS && !look?.header) { out.chip = POS; fc = undefined; }
        else if (fc && lum(fc) > 0.75 && (!bg || lum(bg) > 0.6)) fc = undefined;
        if (fc) out.c = fc;
        const h = cell.alignment?.horizontal;
        out.a = h === "center" || h === "right" || h === "left" ? h : num ? "right" : "left";
        const side = (s: { style?: string; color?: Color } | undefined) => (s?.style ? hex(s.color) ?? "#000000" : undefined);
        const bd = cell.border;
        out.bt = side(bd?.top) ?? look?.bt; out.br = side(bd?.right) ?? look?.br; out.bb = side(bd?.bottom) ?? look?.bb; out.bl = side(bd?.left) ?? look?.bl;
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
