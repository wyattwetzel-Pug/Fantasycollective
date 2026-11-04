import { refreshAllLeagues } from "@/lib/leagues/refresh-all";

export const maxDuration = 60;

// Called daily by Vercel Cron (see vercel.json) with "Authorization: Bearer <CRON_SECRET>".
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  const result = await refreshAllLeagues();
  return Response.json(result, { status: result.ok ? 200 : 500 });
}
