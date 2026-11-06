import type { NextRequest } from "next/server";
import { isAuthorizedCron } from "@/lib/cron";
import { processBacklog } from "@/lib/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  if (!isAuthorizedCron(req)) return new Response("Unauthorized", { status: 401 });
  const counts = await processBacklog();
  return Response.json({ ok: true, counts });
}
