import { runAdpSync } from "@/lib/sync-adp";

export const maxDuration = 60;

// Called daily by Vercel Cron (see vercel.json). Vercel sends "Authorization: Bearer <CRON_SECRET>".
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  const result = await runAdpSync();
  return Response.json(result, { status: result.ok ? 200 : 500 });
}
