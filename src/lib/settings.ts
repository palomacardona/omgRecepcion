import { z } from "zod";

export const TIMEZONE = "America/Montevideo";

const dayHours = z
  .object({ open: z.string().regex(/^\d{2}:\d{2}$/), close: z.string().regex(/^\d{2}:\d{2}$/) })
  .nullable();

export const AUTO_CATEGORIES = ["faq_horarios", "faq_ubicacion", "faq_general"] as const;
export type AutoCategory = (typeof AUTO_CATEGORIES)[number];

export const settingsSchema = z.object({
  businessName: z.string(),
  address: z.string(),
  mapsUrl: z.string(),
  extraInfo: z.string(),
  /** 0 = domingo … 6 = sábado (como Date.getDay()). null = cerrado. */
  businessHours: z.array(dayHours).length(7),
  /** Si una persona respondió desde la app hace menos de esto, Claudia no propone nada. */
  humanCooldownMinutes: z.number().int().min(0),
  /** Mensajes del historial que se mandan a Claude. */
  historyLimit: z.number().int().min(2).max(100),
  /** Modo automático por categoría. En la v1 todo arranca en false (aprobación humana). */
  autoSend: z.object({
    faq_horarios: z.boolean(),
    faq_ubicacion: z.boolean(),
    faq_general: z.boolean(),
  }),
  /** Borradores pendientes hace más de esto se marcan como "viejos" en el panel / cron. */
  staleDraftMinutes: z.number().int().min(5),
  /**
   * Fuera de horario, mandar solo un aviso fijo ("te respondemos mañana a las 9").
   * Arranca apagado: en la v1 nada sale sin aprobación salvo que el equipo lo active.
   */
  outOfHoursAutoReply: z.boolean(),
  /** Derivaciones abiertas hace más de estas horas se cierran solas en el cron. */
  handoffExpiryHours: z.number().int().min(1),
});

export type Settings = z.infer<typeof settingsSchema>;

export const DEFAULT_SETTINGS: Settings = {
  businessName: "OMG Que Linda",
  address: "(completar dirección en Configuración)",
  mapsUrl: "",
  extraInfo: "",
  businessHours: [
    null, // domingo
    { open: "09:00", close: "19:00" },
    { open: "09:00", close: "19:00" },
    { open: "09:00", close: "19:00" },
    { open: "09:00", close: "19:00" },
    { open: "09:00", close: "19:00" },
    { open: "09:00", close: "13:00" },
  ],
  humanCooldownMinutes: 30,
  historyLimit: 20,
  autoSend: { faq_horarios: false, faq_ubicacion: false, faq_general: false },
  staleDraftMinutes: 30,
  outOfHoursAutoReply: false,
  handoffExpiryHours: 72,
};

export function outOfHoursText(next: string | null): string {
  return `¡Hola! 🌙 Ahora estamos fuera de horario. Te respondemos ${next ?? "apenas abramos"}. ¡Gracias por escribirnos!`;
}

export const DAY_NAMES = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

export function parseSettings(raw: unknown): Settings {
  const merged = { ...DEFAULT_SETTINGS, ...(typeof raw === "object" && raw ? raw : {}) };
  const res = settingsSchema.safeParse(merged);
  return res.success ? res.data : DEFAULT_SETTINGS;
}

export function formatBusinessHours(s: Settings): string {
  return s.businessHours
    .map((h, i) => `${DAY_NAMES[i]}: ${h ? `${h.open} a ${h.close}` : "cerrado"}`)
    .join("\n");
}
