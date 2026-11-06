import { and, eq, lt } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { db } from "@/db";
import { drafts, handoffs } from "@/db/schema";
import { isAuthorizedCron } from "@/lib/cron";
import { getSettings } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Tareas periódicas:
 * - cuenta borradores viejos sin aprobar (el panel los resalta);
 * - cierra derivaciones vencidas.
 */
export async function GET(req: NextRequest) {
  if (!isAuthorizedCron(req)) return new Response("Unauthorized", { status: 401 });
  const s = await getSettings();
  const now = Date.now();

  const stale = await db()
    .select({ id: drafts.id })
    .from(drafts)
    .where(and(eq(drafts.status, "pending"), lt(drafts.createdAt, new Date(now - s.staleDraftMinutes * 60_000))));

  const expired = await db()
    .update(handoffs)
    .set({ resolved: true, resolvedAt: new Date() })
    .where(and(eq(handoffs.resolved, false), lt(handoffs.createdAt, new Date(now - s.handoffExpiryHours * 3600_000))))
    .returning({ id: handoffs.id });

  if (stale.length) console.warn(`[maintenance] ${stale.length} borradores esperando aprobación hace más de ${s.staleDraftMinutes} min`);
  return Response.json({ ok: true, staleDrafts: stale.length, expiredHandoffs: expired.length });
}
