import { and, eq, inArray, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { appointmentRequests, contacts, drafts, handoffs, messages } from "@/db/schema";
import type { Contact, DraftCategory, HandoffPriority, Message } from "@/db/schema";
import { runClaudia, type AgentAction } from "./claudia/agent";
import { classifyExchange, type Classification } from "./claudia/classify";
import { anyAutoSendEnabled, canAutoSend, draftCategory } from "./policy";
import { detectSafetyFlags, EMERGENCY_REPLY, highestPriority } from "./safety";
import { outOfHoursText, type Settings } from "./settings";
import {
  getActiveCatalog,
  getSettings,
  hasNewerInbound,
  lastOutboundAt,
  recentHistory,
  recordOutbound,
  supersedePendingDrafts,
} from "./store";
import { humanRecentlyReplied, isOpen, isWindowOpen, nextOpening } from "./time";
import { sendText } from "./whatsapp/client";

export const MAX_ATTEMPTS = 3;

const NON_TEXT_REPLY =
  "¡Gracias por tu mensaje! 😊 Por ahora solo puedo leer mensajes de texto, así que ya le paso esto al equipo para que lo vean. Si querés, escribime tu consulta y te ayudo.";
const FALLBACK_REPLY = "Le paso tu consulta al equipo y te escriben por acá en un ratito 😊";

/** Toma el mensaje para procesar (lock optimista). Devuelve null si otro worker ya lo tomó. */
async function claim(messageId: number): Promise<Message | null> {
  const [row] = await db()
    .update(messages)
    .set({ processing: "processing", attempts: sql`${messages.attempts} + 1`, claimedAt: new Date() })
    .where(
      and(
        eq(messages.id, messageId),
        eq(messages.direction, "in"),
        inArray(messages.processing, ["pending", "failed"]),
        lt(messages.attempts, MAX_ATTEMPTS),
      ),
    )
    .returning();
  return row ?? null;
}

const finish = (id: number, processing: "done" | "skipped", note?: string) =>
  db().update(messages).set({ processing, lastError: note ?? null }).where(eq(messages.id, id));

async function createHandoff(contactId: number, reason: string, priority: HandoffPriority) {
  await db().insert(handoffs).values({ contactId, reason, priority });
}

export async function processInbound(messageId: number): Promise<string> {
  const msg = await claim(messageId);
  if (!msg) return "not-claimed";
  try {
    const result = await handle(msg);
    return result;
  } catch (err) {
    // Sin datos del paciente en el log: solo el ID y el tipo de error.
    const note = err instanceof Error ? `${err.name}: ${err.message}`.slice(0, 500) : "error";
    console.error(`[pipeline] mensaje ${messageId} falló (intento ${msg.attempts}): ${note}`);
    await db().update(messages).set({ processing: "failed", lastError: note }).where(eq(messages.id, msg.id));
    return "failed";
  }
}

async function handle(msg: Message): Promise<string> {
  const now = new Date();
  const [contact] = await db().select().from(contacts).where(eq(contacts.id, msg.contactId));
  const settings = await getSettings();

  // Claudia pausada desde el panel: el mensaje queda guardado, pero no se responde ni ahora ni al reactivarla.
  if (!settings.enabled) {
    await finish(msg.id, "skipped", "Claudia pausada");
    return "skipped-paused";
  }

  // Ráfaga de mensajes: responde solo el último (que ve todo el historial).
  if (await hasNewerInbound(contact.id, msg.id, msg.timestamp)) {
    await finish(msg.id, "skipped", "hay un mensaje más nuevo");
    return "skipped-newer";
  }
  // Una persona respondió desde la app hace poco: no pisar al equipo.
  if (humanRecentlyReplied(contact.lastHumanReplyAt, now, settings.humanCooldownMinutes)) {
    await finish(msg.id, "skipped", "respondió una persona hace poco");
    return "skipped-human";
  }

  const open = isOpen(settings, now);
  const windowOpen = isWindowOpen(contact.lastInboundAt, now);

  // Aviso automático fuera de horario (solo si el equipo lo activó), una vez por tanda.
  if (!open && settings.outOfHoursAutoReply && windowOpen) {
    const last = await lastOutboundAt(contact.id);
    if (!last || now.getTime() - last.getTime() > 12 * 3600_000) {
      const text = outOfHoursText(nextOpening(settings, now));
      const res = await sendText(contact.waId, text);
      if (res.ok) {
        await recordOutbound({ contactId: contact.id, waMessageId: res.waMessageId, type: "text", content: text, simulated: res.simulated });
      }
    }
  }

  // Audios, imágenes, etc.: v1 no los interpreta.
  if (msg.type !== "text") {
    await createHandoff(contact.id, `Mandó un mensaje de tipo ${msg.type}`, "media");
    await createDraft({ contact, msg, text: NON_TEXT_REPLY, category: "no_texto", settings, windowOpen, classification: null, flags: [] });
    await finish(msg.id, "done");
    return "non-text";
  }

  // Red de seguridad sobre los últimos mensajes del cliente (no solo el último).
  const history = await recentHistory(contact.id, settings.historyLimit);
  const recentCustomerText = history
    .filter((h) => h.direction === "in")
    .slice(-3)
    .map((h) => h.content)
    .join("\n");
  const flags = detectSafetyFlags(recentCustomerText);

  if (flags.some((f) => f.kind === "emergencia")) {
    await createHandoff(contact.id, `Posible emergencia ("${flags[0].match}")`, "urgente");
    await createDraft({ contact, msg, text: EMERGENCY_REPLY, category: "derivacion", settings, windowOpen, classification: null, flags });
    await finish(msg.id, "done");
    return "emergency";
  }

  const catalog = await getActiveCatalog();
  const agent = await runClaudia({
    history: history.map((h) => ({ direction: h.direction, text: h.type === "text" ? h.content : `[${h.type}] ${h.content}` })),
    catalog,
    settings,
    contactName: contact.name,
    now,
    handlers: {
      async createAppointment(input) {
        await db().insert(appointmentRequests).values({
          contactId: contact.id,
          clientName: input.nombre,
          treatment: input.tratamiento,
          preferredDays: input.preferencia_dias,
          preferredTime: input.preferencia_horario,
          notes: input.notas || null,
        });
        return "Solicitud registrada. El equipo la confirma; vos no confirmes nada.";
      },
      async handoff(input) {
        await createHandoff(contact.id, input.motivo, input.prioridad);
        return "Listo, el equipo fue avisado.";
      },
    },
  });

  // Si la red de seguridad detectó algo y Claudia no derivó, derivamos igual.
  const modelHandoffs = agent.actions.filter(
    (a): a is Extract<AgentAction, { tool: "derivar_a_humano" }> => a.tool === "derivar_a_humano",
  );
  if (flags.length) {
    const flagPriority = highestPriority(flags.map((f) => f.priority))!;
    const modelPriority = highestPriority(modelHandoffs.map((a) => a.input.prioridad));
    if (!modelPriority || highestPriority([flagPriority, modelPriority]) !== modelPriority) {
      await createHandoff(contact.id, `Detectado automáticamente: ${flags.map((f) => f.kind).join(", ")}`, flagPriority);
    }
  }

  let text = agent.text;
  if (agent.refused || !text) {
    if (!modelHandoffs.length) {
      await createHandoff(contact.id, agent.refused ? "Claude declinó responder" : "Claudia no generó respuesta", "media");
    }
    text = FALLBACK_REPLY;
  }

  const category = agent.refused ? "derivacion" : draftCategory(agent.actions, flags, open);
  const classification =
    anyAutoSendEnabled(settings) && category === "faq" ? await classifyExchange(msg.content, text) : null;

  await createDraft({ contact, msg, text, category, settings, windowOpen, classification, flags });
  await finish(msg.id, "done");
  return `draft:${category}`;
}

async function createDraft(opts: {
  contact: Contact;
  msg: Message;
  text: string;
  category: DraftCategory;
  settings: Settings;
  windowOpen: boolean;
  classification: Classification | null;
  flags: ReturnType<typeof detectSafetyFlags>;
}) {
  const [draft] = await db()
    .insert(drafts)
    .values({
      contactId: opts.contact.id,
      inboundMessageId: opts.msg.id,
      proposedText: opts.text,
      category: opts.category,
    })
    .returning();
  // Un solo borrador vigente por chat.
  await supersedePendingDrafts(opts.contact.id, draft.id);

  if (
    canAutoSend({
      settings: opts.settings,
      category: opts.category,
      classification: opts.classification,
      flags: opts.flags,
      windowOpen: opts.windowOpen,
    })
  ) {
    await sendDraft(draft.id, { reviewer: "auto", auto: true });
  }
  return draft;
}

export type SendDraftResult = { ok: true } | { ok: false; error: string };

/** Envía un borrador (aprobado por una persona, o automático). Idempotente vía lock de estado. */
export async function sendDraft(
  draftId: number,
  opts: { reviewer: string; editedText?: string; auto?: boolean },
): Promise<SendDraftResult> {
  const [draft] = await db()
    .update(drafts)
    .set({ status: "sending" })
    .where(and(eq(drafts.id, draftId), eq(drafts.status, "pending")))
    .returning();
  if (!draft) return { ok: false, error: "El borrador ya no está pendiente." };

  const [contact] = await db().select().from(contacts).where(eq(contacts.id, draft.contactId));
  const text = (opts.editedText ?? draft.proposedText).trim();
  const fail = async (error: string) => {
    await db().update(drafts).set({ status: "pending", error }).where(eq(drafts.id, draftId));
    return { ok: false as const, error };
  };

  if (!text) return fail("El mensaje está vacío.");
  if (!isWindowOpen(contact.lastInboundAt, new Date())) {
    return fail("La ventana de 24 h está cerrada: solo se puede escribir con una plantilla aprobada.");
  }

  const res = await sendText(contact.waId, text);
  if (!res.ok) return fail(`WhatsApp: ${res.error}`);

  const outId = await recordOutbound({
    contactId: contact.id,
    waMessageId: res.waMessageId,
    type: "text",
    content: text,
    simulated: res.simulated,
  });
  await db()
    .update(drafts)
    .set({
      status: "sent",
      finalText: text,
      edited: text !== draft.proposedText.trim(),
      autoSent: Boolean(opts.auto),
      reviewedBy: opts.reviewer,
      reviewedAt: new Date(),
      sentMessageId: outId,
      error: null,
    })
    .where(eq(drafts.id, draftId));
  return { ok: true };
}

/** Para el cron: reintenta mensajes pendientes/fallidos y destraba los que quedaron "processing". */
export async function processBacklog(limit = 20): Promise<Record<string, number>> {
  const stuckBefore = new Date(Date.now() - 10 * 60_000);
  await db()
    .update(messages)
    .set({ processing: "failed", lastError: "timeout del worker" })
    .where(and(eq(messages.processing, "processing"), lt(messages.claimedAt, stuckBefore)));

  const rows = await db()
    .select({ id: messages.id })
    .from(messages)
    .where(
      and(
        eq(messages.direction, "in"),
        inArray(messages.processing, ["pending", "failed"]),
        lt(messages.attempts, MAX_ATTEMPTS),
        // Dar tiempo al waitUntil del webhook antes de reintentar.
        lt(messages.createdAt, new Date(Date.now() - 60_000)),
      ),
    )
    .orderBy(messages.timestamp)
    .limit(limit);

  const counts: Record<string, number> = {};
  for (const r of rows) {
    const out = await processInbound(r.id);
    counts[out] = (counts[out] ?? 0) + 1;
  }
  return counts;
}
