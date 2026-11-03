import { refreshSheet, disconnectSheet } from "./actions";
import type { SheetTab } from "@/lib/sheets";

// One tab of the linked Google Sheet, shown as a table that follows the sheet.
export function SheetView({ leagueId, sheetId, url, tab }: { leagueId: number; sheetId: string; url: string; tab: SheetTab }) {
  const [head, ...body] = tab.rows;
  return (
    <div className="gl-panel space-y-3 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <h3 className="mr-auto text-xl">{tab.name}</h3>
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
      {tab.rows.length ? (
        <div className="max-h-[70vh] overflow-auto rounded-xl border" style={{ borderColor: "var(--card-line)" }}>
          <table className="gl-table min-w-full text-[13px]">
            <thead>
              <tr>{head.map((c, i) => <th key={i} scope="col" className="sticky top-0 whitespace-nowrap bg-[var(--bar)] !px-3 !py-2 !text-[11px] !text-[var(--bar-ink)] first:!text-left">{c}</th>)}</tr>
            </thead>
            <tbody>
              {body.map((r, ri) => (
                <tr key={ri} className="hover:bg-[#F1EEE5]">
                  {r.map((c, ci) => <td key={ci} className={`whitespace-nowrap !px-3 ${ci === 0 ? "!text-left font-semibold" : ""}`}>{c}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <p className="text-sm text-zinc-400">This tab is empty.</p>}
      <p className="text-xs text-zinc-500">Read-only copy of your sheet. Changes in Google Sheets show up here within a few minutes, or press Refresh sheet.</p>
    </div>
  );
}
