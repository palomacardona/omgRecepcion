import { and, desc, eq, gt, inArray, ne, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { catalog, contacts, drafts, messages, settings as settingsTable } from "@/db/schema";
import type { Contact, MessageType } from "@/db/schema";
import { parseSettings, type Settings } from "./settings";
import type { WaEvent } from "./whatsapp/parse";

const SETTINGS_KEY = "main";

export async function getSettings(): Promise<Settings> {
  const [row] = await db().select().from(settingsTable).where(eq(settingsTable.key, SETTINGS_KEY));
  return parseSettings(row?.value);
}

export async function saveSettings(s: Settings): Promise<void> {
  await db()
    .insert(settingsTable)
    .values({ key: SETTINGS_KEY, value: s })
    .onConflictDoUpdate({ target: settingsTable.key, set: { value: s, updatedAt: new Date() } });
}

export async function getActiveCatalog() {
  return db().select().from(catalog).where(eq(catalog.active, true));
}

export async function upsertContact(waId: string, name: string | null): Promise<Contact> {
  const [row] = await db()
    .insert(contacts)
    .values({ waId, name, phone: waId })
    .onConflictDoUpdate({
      target: contacts.waId,
      // Mantener el nombre si ya lo teníamos y ahora no vino.
      set: { name: sql`coalesce(${name}, ${contacts.name})` },
    })
    .returning();
  return row;
}

/**
 * Guarda los eventos del webhook. Idempotente: un wamid repetido no se inserta dos veces.
 * Devuelve los IDs de mensajes entrantes NUEVOS que hay que procesar.
 */
export async function ingestEvents(events: WaEvent[]): Promise<number[]> {
  const toProcess: number[] = [];
  for (const ev of events) {
    if (ev.kind === "status") {
      await db()
        .update(messages)
        .set({ status: ev.status, ...(ev.error ? { lastError: ev.error } : {}) })
        .where(and(eq(messages.waMessageId, ev.waMessageId), ne(messages.status, "read")));
      continue;
    }

    const contact = await upsertContact(ev.waId, ev.kind === "inbound" ? ev.profileName : null);
    const [inserted] = await db()
      .insert(messages)
      .values({
        waMessageId: ev.waMessageId,
        contactId: contact.id,
        direction: ev.kind === "inbound" ? "in" : "echo",
        type: ev.type,
        content: ev.text,
        timestamp: ev.timestamp,
        status: ev.kind === "inbound" ? "received" : "sent",
        processing: ev.kind === "inbound" ? "pending" : null,
      })
      .onConflictDoNothing({ target: messages.waMessageId })
      .returning({ id: messages.id });
    if (!inserted) continue; // duplicado

    if (ev.kind === "inbound") {
      await db()
        .update(contacts)
        .set({ lastInboundAt: sql`greatest(${contacts.lastInboundAt}, ${ev.timestamp})` })
        .where(eq(contacts.id, contact.id));
      toProcess.push(inserted.id);
    } else {
      // Respondió una persona desde la app: Claudia no pisa al equipo.
      await db()
        .update(contacts)
        .set({ lastHumanReplyAt: sql`greatest(${contacts.lastHumanReplyAt}, ${ev.timestamp})` })
        .where(eq(contacts.id, contact.id));
      await supersedePendingDrafts(contact.id);
    }
  }
  return toProcess;
}

export async function supersedePendingDrafts(contactId: number, exceptId?: number) {
  await db()
    .update(drafts)
    .set({ status: "superseded" })
    .where(
      and(
        eq(drafts.contactId, contactId),
        eq(drafts.status, "pending"),
        exceptId ? ne(drafts.id, exceptId) : undefined,
      ),
    );
}

export async function recordOutbound(opts: {
  contactId: number;
  waMessageId: string;
  type: MessageType;
  content: string;
  simulated: boolean;
}) {
  const [row] = await db()
    .insert(messages)
    .values({
      waMessageId: opts.waMessageId,
      contactId: opts.contactId,
      direction: "out",
      type: opts.type,
      content: opts.content,
      timestamp: new Date(),
      status: opts.simulated ? "simulated" : "sent",
    })
    .returning({ id: messages.id });
  return row.id;
}

export async function recentHistory(contactId: number, limit: number) {
  const rows = await db()
    .select({ direction: messages.direction, content: messages.content, type: messages.type, timestamp: messages.timestamp })
    .from(messages)
    .where(eq(messages.contactId, contactId))
    .orderBy(desc(messages.timestamp), desc(messages.id))
    .limit(limit);
  return rows.reverse();
}

export async function hasNewerInbound(contactId: number, messageId: number, ts: Date) {
  const [row] = await db()
    .select({ id: messages.id })
    .from(messages)
    .where(
      and(
        eq(messages.contactId, contactId),
        eq(messages.direction, "in"),
        or(gt(messages.timestamp, ts), and(eq(messages.timestamp, ts), gt(messages.id, messageId))),
      ),
    )
    .limit(1);
  return Boolean(row);
}

export async function lastOutboundAt(contactId: number): Promise<Date | null> {
  const [row] = await db()
    .select({ ts: messages.timestamp })
    .from(messages)
    .where(and(eq(messages.contactId, contactId), inArray(messages.direction, ["out", "echo"])))
    .orderBy(desc(messages.timestamp))
    .limit(1);
  return row?.ts ?? null;
}
