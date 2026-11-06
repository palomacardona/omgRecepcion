import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

const ts = (name: string) => timestamp(name, { withTimezone: true });

export const contacts = pgTable("contacts", {
  id: serial("id").primaryKey(),
  waId: text("wa_id").notNull().unique(),
  name: text("name"),
  phone: text("phone"),
  optInMarketing: boolean("opt_in_marketing").notNull().default(false),
  optInMarketingAt: ts("opt_in_marketing_at"),
  /** Último mensaje del cliente: define la ventana de 24 h. */
  lastInboundAt: ts("last_inbound_at"),
  /** Último mensaje mandado por una persona desde la app (eco de Coexistence). */
  lastHumanReplyAt: ts("last_human_reply_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export type MessageDirection = "in" | "out" | "echo";
export type MessageType = "text" | "audio" | "image" | "template" | "other";
export type MessageStatus = "received" | "sent" | "delivered" | "read" | "failed" | "simulated";
/** Estado de procesamiento por Claudia (solo para mensajes entrantes). */
export type ProcessingState = "pending" | "processing" | "done" | "skipped" | "failed";

export const messages = pgTable(
  "messages",
  {
    id: serial("id").primaryKey(),
    /** ID de WhatsApp (wamid). Único → idempotencia ante reintentos del webhook. */
    waMessageId: text("wa_message_id").unique(),
    contactId: integer("contact_id")
      .notNull()
      .references(() => contacts.id),
    direction: text("direction").$type<MessageDirection>().notNull(),
    type: text("type").$type<MessageType>().notNull(),
    content: text("content").notNull().default(""),
    timestamp: ts("timestamp").notNull(),
    status: text("status").$type<MessageStatus>().notNull(),
    processing: text("processing").$type<ProcessingState>(),
    attempts: integer("attempts").notNull().default(0),
    claimedAt: ts("claimed_at"),
    lastError: text("last_error"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("messages_contact_ts_idx").on(t.contactId, t.timestamp),
    index("messages_processing_idx").on(t.processing),
  ],
);

export type DraftStatus = "pending" | "sending" | "sent" | "discarded" | "failed" | "superseded";
export type DraftCategory = "faq" | "turno" | "derivacion" | "fuera_de_horario" | "no_texto" | "fuera_de_tema";

export const drafts = pgTable(
  "drafts",
  {
    id: serial("id").primaryKey(),
    contactId: integer("contact_id")
      .notNull()
      .references(() => contacts.id),
    inboundMessageId: integer("inbound_message_id").references(() => messages.id),
    proposedText: text("proposed_text").notNull(),
    /** Texto finalmente enviado (si se editó, difiere de proposedText). */
    finalText: text("final_text"),
    category: text("category").$type<DraftCategory>().notNull(),
    status: text("status").$type<DraftStatus>().notNull().default("pending"),
    edited: boolean("edited").notNull().default(false),
    autoSent: boolean("auto_sent").notNull().default(false),
    reviewedBy: text("reviewed_by"),
    reviewedAt: ts("reviewed_at"),
    sentMessageId: integer("sent_message_id").references(() => messages.id),
    error: text("error"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("drafts_status_idx").on(t.status)],
);

export type AppointmentStatus = "nueva" | "cargada_en_flowww" | "confirmada" | "cancelada";

export const appointmentRequests = pgTable("appointment_requests", {
  id: serial("id").primaryKey(),
  contactId: integer("contact_id")
    .notNull()
    .references(() => contacts.id),
  clientName: text("client_name"),
  treatment: text("treatment").notNull(),
  preferredDays: text("preferred_days"),
  preferredTime: text("preferred_time"),
  notes: text("notes"),
  status: text("status").$type<AppointmentStatus>().notNull().default("nueva"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export type HandoffPriority = "baja" | "media" | "alta" | "urgente";

export const handoffs = pgTable("handoffs", {
  id: serial("id").primaryKey(),
  contactId: integer("contact_id")
    .notNull()
    .references(() => contacts.id),
  reason: text("reason").notNull(),
  priority: text("priority").$type<HandoffPriority>().notNull(),
  resolved: boolean("resolved").notNull().default(false),
  resolvedAt: ts("resolved_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const catalog = pgTable("catalog", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  category: text("category"),
  description: text("description").notNull().default(""),
  durationMinutes: integer("duration_minutes"),
  /** Texto libre: "$ 2.500", "desde $ 1.800", "$ 9.000 el paquete de 4 sesiones". */
  price: text("price"),
  preparation: text("preparation"),
  contraindications: text("contraindications"),
  active: boolean("active").notNull().default(true),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

/** Clave-valor; el contenido tipado está en src/lib/settings.ts. */
export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export type Contact = typeof contacts.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type Draft = typeof drafts.$inferSelect;
export type CatalogItem = typeof catalog.$inferSelect;
export type AppointmentRequest = typeof appointmentRequests.$inferSelect;
export type Handoff = typeof handoffs.$inferSelect;
