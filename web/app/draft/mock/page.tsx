import { Suspense } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { MockRoom, type P, type Slots } from "./mock-room";

type Row = {
  player_id: number; position_in_list: number;
  players: { name: string; position: string; nfl_team: string | null } | null;
};

const int = (v: string | string[] | undefined, d: number, min: number, max: number) => {
  const n = typeof v === "string" ? parseInt(v, 10) : NaN;
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : d;
};

async function Room({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const str = (k: string, ok: string[], d: string) => { const v = sp[k]; return typeof v === "string" && ok.includes(v) ? v : d; };
  const format = str("format", ["redraft", "dynasty"], "redraft");
  const scoring = str("scoring", ["ppr", "half", "std"], "ppr");
  const qb = str("qb", ["1qb", "superflex"], "1qb");
  const teams = int(sp.size, 12, 4, 16);
  const slot = int(sp.slot, 5, 1, teams);
  const slots: Slots = {
    QB: int(sp.QB, 1, 0, 9), RB: int(sp.RB, 2, 0, 9), WR: int(sp.WR, 2, 0, 9), TE: int(sp.TE, 1, 0, 9),
    FLEX: int(sp.FLEX, 1, 0, 9), SUPERFLEX: int(sp.SUPERFLEX, qb === "superflex" ? 1 : 0, 0, 9), K: int(sp.K, 1, 0, 9), DEF: int(sp.DEF, 1, 0, 9),
  };
  const bench = int(sp.bench, 6, 0, 15);
  const rounds = Math.max(1, Math.min(25, Object.values(slots).reduce((a, b) => a + b, 0) + bench));

  const supabase = await createClient();
  const { data } = await supabase
    .from("consensus_current")
    .select("player_id, position_in_list, players(name, position, nfl_team)")
    .match({ format, scoring, qb_type: qb })
    .order("position_in_list").limit(400)
    .returns<Row[]>();

  const { data: latest } = await supabase.from("adp").select("season, source").match({ format, scoring, qb_type: qb }).order("season", { ascending: false }).limit(1);
  const adpOf = new Map<number, number>();
  if (latest?.length) {
    const { data: adpRows } = await supabase
      .from("adp").select("player_id, adp").match({ format, scoring, qb_type: qb }).eq("season", latest[0].season).eq("source", latest[0].source).limit(1000)
      .returns<{ player_id: number; adp: number }[]>();
    (adpRows ?? []).forEach((r) => adpOf.set(r.player_id, Number(r.adp)));
  }

  const back = new URLSearchParams({ tab: "mock", format, scoring, qb });
  const players: P[] = (data ?? []).map((r) => ({
    id: r.player_id, name: r.players?.name ?? "Unknown", position: r.players?.position ?? "", team: r.players?.nfl_team ?? "", rank: r.position_in_list, adp: adpOf.get(r.player_id) ?? null,
  }));

  if (players.length < teams * rounds) {
    return (
      <div className="gl-panel space-y-2 p-4">
        <p className="text-zinc-300">
          A {teams}-team, {rounds}-round draft needs at least {teams * rounds} ranked players, but only {players.length} are ranked for these settings.
        </p>
        <Link href={`/draft?${back}`} style={{ color: "var(--accent)" }}>← Back to Draft setup</Link>
      </div>
    );
  }
  return <MockRoom players={players} teams={teams} rounds={rounds} slot={slot} slots={slots} bench={bench} backHref={`/draft?${back}`} />;
}

export default function MockPage(props: PageProps<"/draft/mock">) {
  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-5 md:px-10 md:py-8">
      <h1 className="gl-title mb-4 text-4xl">Mock <span style={{ color: "var(--accent)" }}>Draft</span></h1>
      <Suspense fallback={<p className="text-zinc-400">Loading...</p>}>
        <Room searchParams={props.searchParams} />
      </Suspense>
    </main>
  );
}
