import { fetchAll } from "@/lib/fetch-all";
import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Editor, type Item } from "./editor";

type Row = {
  player_id: number;
  tier: string | null;
  note: string | null;
  needs_ranking: boolean;
  players: { name: string; position: string; nfl_team: string | null } | null;
};

async function Loaded({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const setId = Number(id);
  if (!Number.isInteger(setId)) notFound();

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: set } = await supabase
    .from("ranking_sets").select("id, format, scoring, qb_type, published, contributor_id").eq("id", setId).maybeSingle();
  if (!set || set.contributor_id !== user.id) notFound();

  const rows = await fetchAll<Row>((a, b) => supabase
    .from("rankings")
    .select("player_id, tier, note, needs_ranking, players(name, position, nfl_team)")
    .eq("set_id", setId)
    .order("rank").order("player_id")
    .range(a, b)
    .returns<Row[]>());

  // ADP for this list's settings, so the contributor can start from the market order.
  const combo = { format: set.format, scoring: set.scoring, qb_type: set.qb_type };
  let adp: { map: Record<number, number>; label: string } | null = null;
  const { data: latest } = await supabase.from("adp").select("season, source").match(combo).order("season", { ascending: false }).limit(1);
  if (latest?.length) {
    const { data: adpRows } = await supabase
      .from("adp").select("player_id, adp").match(combo).eq("season", latest[0].season).eq("source", latest[0].source).limit(1000)
      .returns<{ player_id: number; adp: number }[]>();
    if (adpRows?.length) {
      adp = { map: Object.fromEntries(adpRows.map((r) => [r.player_id, Number(r.adp)])), label: `${latest[0].season} · ${latest[0].source}` };
    }
  }

  const items: Item[] = rows.map((r) => ({
    player_id: r.player_id,
    name: r.players?.name ?? "Unknown",
    position: r.players?.position ?? "",
    team: r.players?.nfl_team ?? "",
    tier: r.tier ?? "",
    note: r.note ?? "",
    placed: !r.needs_ranking,
  }));

  const title = `${set.format} · ${set.scoring} · ${set.qb_type}`.toUpperCase();
  const back = new URLSearchParams({ format: set.format, scoring: set.scoring, qb: set.qb_type });
  return <Editor setId={setId} title={title} backHref={`/rankings?${back}`} adp={adp} initial={items} initialPublished={set.published} />;
}

export default function ListPage(props: PageProps<"/lists/[id]">) {
  return (
    <main className="mx-auto w-full max-w-5xl p-6">
      <Suspense fallback={<p className="text-zinc-400">Loading...</p>}>
        <Loaded params={props.params} />
      </Suspense>
    </main>
  );
}
