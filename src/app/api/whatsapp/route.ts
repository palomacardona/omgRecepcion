import { after, type NextRequest } from "next/server";
import { processInbound } from "@/lib/pipeline";
import { ingestEvents } from "@/lib/store";
import { parseWebhook } from "@/lib/whatsapp/parse";
import { verifySignature } from "@/lib/whatsapp/signature";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Verificación del webhook (Meta hace GET con hub.mode / hub.verify_token / hub.challenge). */
export function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const expected = process.env.WHATSAPP_VERIFY_TOKEN;
  if (expected && p.get("hub.mode") === "subscribe" && p.get("hub.verify_token") === expected) {
    return new Response(p.get("hub.challenge") ?? "", { status: 200, headers: { "Content-Type": "text/plain" } });
  }
  return new Response("Forbidden", { status: 403 });
}

/**
 * Recepción de eventos. Valida firma, guarda (dedupe por wamid) y responde 200 enseguida.
 * El trabajo con Claude corre después de la respuesta (after → waitUntil en Vercel);
 * si falla, el cron /api/cron/process-pending lo reintenta.
 */
export async function POST(req: NextRequest) {
  const raw = await req.text();
  if (!verifySignature(raw, req.headers.get("x-hub-signature-256"), process.env.WHATSAPP_APP_SECRET ?? "")) {
    return new Response("Invalid signature", { status: 401 });
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return new Response("Bad JSON", { status: 400 });
  }

  const events = parseWebhook(body);
  let ids: number[];
  try {
    ids = await ingestEvents(events);
  } catch (err) {
    // 500 → Meta reintenta; la idempotencia evita duplicados.
    console.error("[webhook] error guardando eventos:", err instanceof Error ? err.message : err);
    return new Response("Error", { status: 500 });
  }

  if (ids.length) {
    after(async () => {
      for (const id of ids) await processInbound(id);
    });
  }
  return new Response("OK", { status: 200 });
}
