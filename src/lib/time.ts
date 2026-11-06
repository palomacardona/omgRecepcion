import { DAY_NAMES, TIMEZONE, type Settings } from "./settings";

export const WINDOW_MS = 24 * 60 * 60 * 1000;

/** Día de la semana (0-6) y minutos desde medianoche en America/Montevideo. */
export function localParts(date: Date): { day: number; minutes: number; label: string } {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: TIMEZONE,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]));
  const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday);
  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  const label = `${DAY_NAMES[day]} ${parts.hour}:${parts.minute}`;
  return { day, minutes, label };
}

const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

export function isOpen(settings: Settings, now: Date): boolean {
  const { day, minutes } = localParts(now);
  const h = settings.businessHours[day];
  if (!h) return false;
  return minutes >= toMin(h.open) && minutes < toMin(h.close);
}

/** Próxima apertura, en texto ("hoy a las 09:00", "el lunes a las 09:00"). */
export function nextOpening(settings: Settings, now: Date): string | null {
  const { day, minutes } = localParts(now);
  for (let offset = 0; offset < 8; offset++) {
    const d = (day + offset) % 7;
    const h = settings.businessHours[d];
    if (!h) continue;
    if (offset === 0 && minutes >= toMin(h.open)) continue;
    if (offset === 0) return `hoy a las ${h.open}`;
    if (offset === 1) return `mañana a las ${h.open}`;
    return `el ${DAY_NAMES[d]} a las ${h.open}`;
  }
  return null;
}

/** Ventana de servicio de 24 h de WhatsApp desde el último mensaje del cliente. */
export function isWindowOpen(lastInboundAt: Date | null | undefined, now: Date): boolean {
  if (!lastInboundAt) return false;
  return now.getTime() - lastInboundAt.getTime() < WINDOW_MS;
}

export function windowClosesAt(lastInboundAt: Date | null | undefined): Date | null {
  return lastInboundAt ? new Date(lastInboundAt.getTime() + WINDOW_MS) : null;
}

/** ¿Respondió una persona desde la app hace poco? Entonces Claudia no propone nada. */
export function humanRecentlyReplied(
  lastHumanReplyAt: Date | null | undefined,
  now: Date,
  cooldownMinutes: number,
): boolean {
  if (!lastHumanReplyAt || cooldownMinutes <= 0) return false;
  return now.getTime() - lastHumanReplyAt.getTime() < cooldownMinutes * 60_000;
}
