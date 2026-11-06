import { runClaudia, type AgentAction, type HistoryItem } from "./claudia/agent";
import { detectSafetyFlags, EMERGENCY_REPLY } from "./safety";
import { getActiveCatalog, getSettings } from "./store";

export type SimTurn = { role: "cliente" | "claudia"; text: string };

export type SimResult =
  | {
      ok: true;
      reply: string;
      /** Lo que en la vida real habría pasado además de la respuesta (no se guarda nada). */
      notes: string[];
    }
  | { ok: false; error: string };

const MAX_TURNS = 30;
const MAX_CHARS = 2000;

/**
 * Corre a Claudia sobre una conversación de prueba, con el catálogo y la configuración reales,
 * pero SIN guardar nada en la base y SIN enviar nada por WhatsApp.
 * Replica las mismas reglas del pipeline (emergencias, red de seguridad, derivaciones).
 */
export async function simulateConversation(turns: SimTurn[], now = new Date()): Promise<SimResult> {
  const clean = turns
    .slice(-MAX_TURNS)
    .map((t) => ({ role: t.role, text: String(t.text ?? "").slice(0, MAX_CHARS).trim() }))
    .filter((t) => t.text);
  if (!clean.length || clean[clean.length - 1].role !== "cliente") {
    return { ok: false, error: "Escribí un mensaje como cliente." };
  }

  const history: HistoryItem[] = clean.map((t) => ({ direction: t.role === "cliente" ? "in" : "out", text: t.text }));
  const recentCustomer = clean.filter((t) => t.role === "cliente").slice(-3).map((t) => t.text).join("\n");
  const flags = detectSafetyFlags(recentCustomer);
  const notes: string[] = [];

  if (flags.some((f) => f.kind === "emergencia")) {
    notes.push(`🚨 Red de seguridad: posible emergencia ("${flags[0].match}"). Respuesta fija sin pasar por Claude y derivación URGENTE al equipo.`);
    return { ok: true, reply: EMERGENCY_REPLY, notes };
  }

  const [catalog, settings] = await Promise.all([getActiveCatalog(), getSettings()]);
  const actions: AgentAction[] = [];
  const result = await runClaudia({
    history,
    catalog,
    settings,
    contactName: null,
    now,
    handlers: {
      async createAppointment() {
        return "Solicitud registrada. El equipo la confirma; vos no confirmes nada.";
      },
      async handoff() {
        return "Listo, el equipo fue avisado.";
      },
    },
  });
  actions.push(...result.actions);

  for (const a of actions) {
    if (a.tool === "crear_solicitud_turno") {
      const i = a.input;
      notes.push(`📅 Crearía una solicitud de turno: ${i.nombre} · ${i.tratamiento} · ${i.preferencia_dias} ${i.preferencia_horario}${i.notas ? ` · ${i.notas}` : ""}`);
    } else {
      notes.push(`🙋 Derivaría al equipo (prioridad ${a.input.prioridad}): ${a.input.motivo}`);
    }
  }
  const modelDerivó = actions.some((a) => a.tool === "derivar_a_humano");
  if (flags.length && !modelDerivó) {
    notes.push(`🛡️ Red de seguridad: detectó ${flags.map((f) => f.kind).join(", ")} y derivaría igual (prioridad ${flags[0].priority}).`);
  }
  if (result.refused) notes.push("⚠️ Claude declinó responder: se derivaría al equipo con un mensaje genérico.");
  if (!settings.enabled) notes.push("⏸️ Claudia está pausada: en WhatsApp real no respondería.");

  const reply = result.refused || !result.text ? "Le paso tu consulta al equipo y te escriben por acá en un ratito 😊" : result.text;
  return { ok: true, reply, notes };
}
