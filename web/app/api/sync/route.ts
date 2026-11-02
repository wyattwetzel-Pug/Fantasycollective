import { runSync } from "@/lib/sync";

export const maxDuration = 60;

// Called daily by Vercel Cron (see vercel.json). Vercel sends "Authorization: Bearer <CRON_SECRET>".
// Optional: ?backfill=1 for the whole season, or ?weeks=3,4 for specific weeks.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  const q = new URL(request.url).searchParams;
  const weeks = q.get("weeks")?.split(",").map(Number).filter((n) => Number.isInteger(n));
  const result = await runSync({ weeks, backfill: q.get("backfill") === "1" });
  return Response.json(result, { status: result.ok ? 200 : 500 });
}
