"use client";

import { useState } from "react";
import { syncLeague } from "./actions";

const SITES = [["sleeper", "Sleeper"], ["espn", "ESPN"], ["fleaflicker", "Fleaflicker"], ["mfl", "MyFantasyLeague"]] as const;
const input = "gl-search max-w-xs";

const HELP: Record<string, string> = {
  sleeper: "Uses Sleeper's public data. We only read your leagues and rosters and never need your password.",
  espn: "Public ESPN leagues only need the league ID. Type part of your team name so we know which roster is yours. For private leagues, also paste your espn_s2 and SWID cookies from espn.com (browser developer tools, Application, Cookies). They're used for this sync only and never saved.",
  fleaflicker: "Works for any league that's visible without logging in. Find the league ID in your league's web address (fleaflicker.com/nfl/leagues/123456). Fleaflicker doesn't share who's starting, so players show as bench.",
  mfl: "The league ID is the number after L= in your league's web address. The commissioner must allow public roster access. MyFantasyLeague doesn't share who's starting, so players show as bench.",
};

export function SyncForm() {
  const [site, setSite] = useState<string>("sleeper");
  const other = site !== "sleeper";

  return (
    <div className="space-y-3">
      <div role="tablist" aria-label="Fantasy site" className="flex flex-wrap gap-2">
        {SITES.map(([v, l]) => (
          <button key={v} type="button" role="tab" aria-selected={site === v} onClick={() => setSite(v)} className={`gl-pill !px-5 ${site === v ? "on" : ""}`}>{l}</button>
        ))}
      </div>

      <form action={syncLeague} className="space-y-3" key={site}>
        <input type="hidden" name="platform" value={site} />
        <div className="flex flex-wrap gap-2">
          {site === "sleeper" ? (
            <>
              <label htmlFor="sync-username" className="sr-only">Sleeper username</label>
              <input id="sync-username" name="username" required placeholder="Your Sleeper username" className={input} />
            </>
          ) : (
            <>
              <label htmlFor="sync-league" className="sr-only">League ID</label>
              <input id="sync-league" name="league_id" required placeholder="League ID" inputMode="numeric" className={input} />
              <label htmlFor="sync-team" className="sr-only">Your team name</label>
              <input id="sync-team" name="team" placeholder="Your team name (optional)" className={input} />
            </>
          )}
        </div>

        {site === "espn" && (
          <div className="flex flex-wrap gap-2">
            <label htmlFor="sync-s2" className="sr-only">espn_s2 cookie</label>
            <input id="sync-s2" name="espn_s2" placeholder="espn_s2 (private leagues only)" autoComplete="off" className={input} />
            <label htmlFor="sync-swid" className="sr-only">SWID cookie</label>
            <input id="sync-swid" name="swid" placeholder="SWID (private leagues only)" autoComplete="off" className={input} />
          </div>
        )}

        {other && (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <label className="flex items-center gap-2">Scoring
              <select name="scoring" defaultValue={site === "espn" ? "" : "ppr"} className="rounded border border-zinc-700 bg-black px-2 py-1.5">
                {site === "espn" && <option value="">Auto-detect</option>}
                <option value="ppr">PPR</option><option value="half">Half PPR</option><option value="std">Standard</option>
              </select>
            </label>
            <label className="flex items-center gap-2">Lineup
              <select name="qb" defaultValue={site === "espn" ? "" : "1qb"} className="rounded border border-zinc-700 bg-black px-2 py-1.5">
                {site === "espn" && <option value="">Auto-detect</option>}
                <option value="1qb">1 QB</option><option value="superflex">Superflex</option>
              </select>
            </label>
            <label className="flex items-center gap-2">League type
              <select name="format" defaultValue="redraft" className="rounded border border-zinc-700 bg-black px-2 py-1.5">
                <option value="redraft">Redraft</option><option value="dynasty">Dynasty</option>
              </select>
            </label>
          </div>
        )}

        <button className="gl-pill on-o !px-5 !py-2.5">Sync from {SITES.find((s) => s[0] === site)?.[1]}</button>
      </form>
      <p className="text-xs text-zinc-500">{HELP[site]}</p>
    </div>
  );
}
