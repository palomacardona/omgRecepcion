import type { DraftCategory } from "@/db/schema";
import type { AgentAction } from "./claudia/agent";
import type { Classification } from "./claudia/classify";
import type { SafetyFlag } from "./safety";
import type { Settings } from "./settings";

/** Categoría del borrador a partir de lo que hizo Claudia y de la red de seguridad. */
export function draftCategory(actions: AgentAction[], flags: SafetyFlag[], open: boolean): DraftCategory {
  if (flags.length || actions.some((a) => a.tool === "derivar_a_humano")) return "derivacion";
  if (actions.some((a) => a.tool === "crear_solicitud_turno")) return "turno";
  if (!open) return "fuera_de_horario";
  return "faq";
}

/**
 * ¿Se puede mandar solo, sin aprobación? (handover §6.4)
 * Nunca para: derivaciones, salud, quejas, cancelaciones, precios, turnos, ni fuera de horario.
 */
export function canAutoSend(opts: {
  settings: Settings;
  category: DraftCategory;
  classification: Classification | null;
  flags: SafetyFlag[];
  windowOpen: boolean;
}): boolean {
  const { settings, category, classification, flags, windowOpen } = opts;
  if (!windowOpen || flags.length || category !== "faq" || !classification) return false;
  if (classification === "faq_horarios") return settings.autoSend.faq_horarios;
  if (classification === "faq_ubicacion") return settings.autoSend.faq_ubicacion;
  if (classification === "faq_general") return settings.autoSend.faq_general;
  return false;
}

export function anyAutoSendEnabled(s: Settings): boolean {
  return Object.values(s.autoSend).some(Boolean);
}
