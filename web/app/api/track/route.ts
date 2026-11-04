import { NextResponse, type NextRequest } from "next/server";
import { sessionUser, profileOf } from "@/lib/session";
import { logEvent } from "@/lib/supabase/service";

// The page-view beacon. Skips bots and the admin's own browsing so the numbers show real visitors.
export async function POST(request: NextRequest) {
  const ua = request.headers.get("user-agent") ?? "";
  if (/bot|crawl|spider|slurp|preview|monitor|lighthouse|vercel-/i.test(ua)) return new NextResponse(null, { status: 204 });
  let body: { path?: unknown; visitor?: unknown } = {};
  try { body = await request.json(); } catch { /* empty */ }
  const path = typeof body.path === "string" && body.path.startsWith("/") ? body.path.slice(0, 200) : null;
  const visitor = typeof body.visitor === "string" ? body.visitor.slice(0, 64) : null;
  if (!path) return new NextResponse(null, { status: 204 });

  const user = await sessionUser();
  const me = user ? await profileOf(user.id) : null;
  if (!me?.is_admin) await logEvent("view", { path, userId: user?.id, visitorId: visitor });
  return new NextResponse(null, { status: 204 });
}
