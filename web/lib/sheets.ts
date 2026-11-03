import { cacheLife, cacheTag } from "next/cache";

export type SheetTab = { name: string; rows: string[][] };
export type SheetResult = { ok: true; tabs: SheetTab[] } | { ok: false; error: string };

const MAX_ROWS = 400;
const MAX_COLS = 40;

// The long id in a Google Sheets link: docs.google.com/spreadsheets/d/<id>/edit
export function sheetIdFrom(url: string): string | null {
  const m = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]{20,})/);
  return m ? m[1] : null;
}

const show = (v: unknown): string => {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toLocaleDateString("en-US", { timeZone: "UTC" });
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100);
  return String(v);
};

// Downloads the whole workbook (every tab) from Google. The sheet must be shared as
// "Anyone with the link can view", since this server can't sign in to a Google account.
export async function fetchSheet(id: string): Promise<SheetResult> {
  try {
    const res = await fetch(`https://docs.google.com/spreadsheets/d/${id}/export?format=xlsx`, { redirect: "follow", cache: "no-store" });
    const type = res.headers.get("content-type") ?? "";
    if (!res.ok || !type.includes("spreadsheetml")) {
      return { ok: false, error: "Google wouldn't share that sheet. In Google Sheets click Share, then under General access choose \"Anyone with the link\" as Viewer." };
    }
    const { default: readExcelFile } = await import("read-excel-file/node");
    const sheets = await readExcelFile(Buffer.from(await res.arrayBuffer()));
    const tabs: SheetTab[] = sheets.map((s) => {
      let rows = (s.data as unknown[][]).slice(0, MAX_ROWS).map((r) => r.slice(0, MAX_COLS).map(show));
      while (rows.length && rows[rows.length - 1].every((c) => c === "")) rows.pop();
      const width = rows.reduce((w, r) => { let n = r.length; while (n > 0 && r[n - 1] === "") n--; return Math.max(w, n); }, 0);
      rows = rows.map((r) => Array.from({ length: width }, (_, i) => r[i] ?? ""));
      return { name: s.sheet, rows };
    });
    return { ok: true, tabs };
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
