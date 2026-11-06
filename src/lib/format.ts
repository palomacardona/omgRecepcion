import { TIMEZONE } from "./settings";

export function fmtDate(d: Date | null | undefined): string {
  if (!d) return "—";
  return d.toLocaleString("es-UY", { timeZone: TIMEZONE, dateStyle: "short", timeStyle: "short" });
}

export function ago(d: Date | null | undefined, now = new Date()): string {
  if (!d) return "—";
  const min = Math.round((now.getTime() - d.getTime()) / 60_000);
  if (min < 1) return "recién";
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `hace ${h} h`;
  return `hace ${Math.round(h / 24)} d`;
}

export const CATEGORY_LABEL: Record<string, string> = {
  faq: "Consulta",
  turno: "Turno",
  derivacion: "Derivación",
  fuera_de_horario: "Fuera de horario",
  no_texto: "Audio/imagen",
  fuera_de_tema: "Fuera de tema",
};
