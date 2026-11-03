import { refreshSheet, disconnectSheet } from "./actions";
import type { SheetTab } from "@/lib/sheets";
import { SheetGrid } from "./sheet-grid";

// One tab of the linked Google Sheet, shown as a table that follows the sheet.
export function SheetView({ leagueId, sheetId, url, tab }: { leagueId: number; sheetId: string; url: string; tab: SheetTab }) {
  return (
    <div className="gl-panel space-y-2 p-3">
      <div className="flex flex-wrap items-center gap-3">
        <h3 className="mr-auto text-lg">{tab.name}</h3>
        <a href={url} target="_blank" rel="noopener noreferrer" className="text-xs" style={{ color: "var(--accent)" }}>Open in Google Sheets ↗</a>
        <form action={refreshSheet}>
          <input type="hidden" name="league" value={leagueId} /><input type="hidden" name="sheet" value={sheetId} /><input type="hidden" name="tabname" value={tab.name} />
          <button className="gl-pill !py-1 text-xs">⟳ Refresh sheet</button>
        </form>
        <form action={disconnectSheet}>
          <input type="hidden" name="league" value={leagueId} />
          <button className="px-2 text-xs text-red-400">Disconnect</button>
        </form>
      </div>
      {tab.rows.length ? <SheetGrid tab={tab} /> : <p className="text-sm text-zinc-400">This tab is empty.</p>}
      <p className="text-xs text-zinc-500">Read-only copy of your sheet. Changes in Google Sheets show up here within a few minutes, or press Refresh sheet.</p>
    </div>
  );
}
