import type { MessageType } from "@/db/schema";

/** Evento normalizado a partir del payload del webhook de Meta. */
export type WaEvent =
  | {
      kind: "inbound";
      waMessageId: string;
      waId: string;
      profileName: string | null;
      type: MessageType;
      text: string;
      timestamp: Date;
    }
  | {
      /** Mensaje que el equipo mandó desde la app del celular (Coexistence: smb_message_echoes). */
      kind: "echo";
      waMessageId: string;
      waId: string;
      type: MessageType;
      text: string;
      timestamp: Date;
    }
  | {
      kind: "status";
      waMessageId: string;
      status: "sent" | "delivered" | "read" | "failed";
      timestamp: Date;
      error: string | null;
    };

type Json = Record<string, any>;

function mapType(t: unknown): MessageType {
  if (t === "text") return "text";
  if (t === "audio" || t === "voice") return "audio";
  if (t === "image" || t === "sticker") return "image";
  if (t === "template") return "template";
  return "other";
}

function extractText(m: Json): string {
  switch (m.type) {
    case "text":
      return String(m.text?.body ?? "");
    case "button":
      return String(m.button?.text ?? "");
    case "interactive":
      return String(
        m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? "",
      );
    case "image":
      return m.image?.caption ? `[imagen] ${m.image.caption}` : "[imagen]";
    case "audio":
      return "[audio]";
    case "template":
      return "[plantilla]";
    default:
      return `[${m.type ?? "desconocido"}]`;
  }
}

const tsFrom = (s: unknown) => new Date(Number(s) * 1000);

export function parseWebhook(body: unknown): WaEvent[] {
  const events: WaEvent[] = [];
  const entries: Json[] = Array.isArray((body as Json)?.entry) ? (body as Json).entry : [];
  for (const entry of entries) {
    for (const change of (entry.changes ?? []) as Json[]) {
      const v: Json = change.value ?? {};
      if (change.field === "messages") {
        const names = new Map<string, string>();
        for (const c of (v.contacts ?? []) as Json[]) {
          if (c.wa_id && c.profile?.name) names.set(c.wa_id, c.profile.name);
        }
        for (const m of (v.messages ?? []) as Json[]) {
          if (!m.id || !m.from) continue;
          // Botones de plantillas y respuestas interactivas se tratan como texto.
          const type = m.type === "button" || m.type === "interactive" ? "text" : mapType(m.type);
          events.push({
            kind: "inbound",
            waMessageId: m.id,
            waId: m.from,
            profileName: names.get(m.from) ?? null,
            type,
            text: extractText(m),
            timestamp: tsFrom(m.timestamp),
          });
        }
        for (const s of (v.statuses ?? []) as Json[]) {
          if (!s.id || !["sent", "delivered", "read", "failed"].includes(s.status)) continue;
          events.push({
            kind: "status",
            waMessageId: s.id,
            status: s.status,
            timestamp: tsFrom(s.timestamp),
            error: s.errors?.[0] ? `${s.errors[0].code}: ${s.errors[0].title ?? ""}` : null,
          });
        }
      } else if (change.field === "smb_message_echoes") {
        for (const m of (v.message_echoes ?? []) as Json[]) {
          if (!m.id || !m.to) continue;
          events.push({
            kind: "echo",
            waMessageId: m.id,
            waId: m.to,
            type: mapType(m.type),
            text: extractText(m),
            timestamp: tsFrom(m.timestamp),
          });
        }
      }
    }
  }
  return events;
}
