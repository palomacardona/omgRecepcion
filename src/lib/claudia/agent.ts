import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { CatalogItem, MessageDirection } from "@/db/schema";
import type { Settings } from "../settings";
import { loadClaudiaPrompt, renderBusinessContext, renderVolatileContext } from "./context";

export const DRAFT_MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-5-5";
const MAX_ITERATIONS = 4;

export type HistoryItem = { direction: MessageDirection; text: string };

export const appointmentInput = z.object({
  nombre: z.string().min(1),
  tratamiento: z.string().min(1),
  preferencia_dias: z.string(),
  preferencia_horario: z.string(),
  notas: z.string(),
});
export type AppointmentInput = z.infer<typeof appointmentInput>;

export const handoffInput = z.object({
  motivo: z.string().min(1),
  prioridad: z.enum(["baja", "media", "alta", "urgente"]),
});
export type HandoffInput = z.infer<typeof handoffInput>;

export type AgentAction =
  | { tool: "crear_solicitud_turno"; input: AppointmentInput }
  | { tool: "derivar_a_humano"; input: HandoffInput };

export type ToolHandlers = {
  createAppointment(input: AppointmentInput): Promise<string>;
  handoff(input: HandoffInput): Promise<string>;
};

export type AgentResult = {
  text: string;
  actions: AgentAction[];
  stopReason: string | null;
  refused: boolean;
  usage: { input: number; output: number; cacheRead: number; cacheWrite: number };
};

const TOOLS: Anthropic.Beta.BetaTool[] = [
  {
    name: "crear_solicitud_turno",
    description:
      "Registra una SOLICITUD de turno para que el equipo la cargue y confirme en la agenda. Usala solo cuando ya tenés nombre, tratamiento y preferencia de días/horario. No confirma nada: después decile a la persona que el equipo le confirma en un ratito.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        nombre: { type: "string", description: "Nombre de la persona" },
        tratamiento: { type: "string", description: "Tratamiento tal como figura en el catálogo (o lo que pidió, si no figura)" },
        preferencia_dias: { type: "string", description: "Días preferidos, ej. 'martes o jueves', 'esta semana'" },
        preferencia_horario: { type: "string", description: "Franja preferida, ej. 'de tarde', 'después de las 17'" },
        notas: { type: "string", description: "Otra info útil para el equipo; vacío si no hay" },
      },
      required: ["nombre", "tratamiento", "preferencia_dias", "preferencia_horario", "notas"],
      additionalProperties: false,
    },
  },
  {
    name: "derivar_a_humano",
    description:
      "Avisa al equipo que esta conversación necesita a una persona. Usala para temas de salud, reacciones, quejas, pedidos de hablar con alguien, cancelaciones, pagos, o cualquier dato que no esté en el catálogo.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        motivo: { type: "string", description: "Resumen breve para el equipo de por qué se deriva" },
        prioridad: {
          type: "string",
          enum: ["baja", "media", "alta", "urgente"],
          description: "urgente = posible emergencia; alta = salud/reacción/queja; media = cancelaciones, pagos, pide persona; baja = dato que falta en el catálogo",
        },
      },
      required: ["motivo", "prioridad"],
      additionalProperties: false,
    },
  },
];

/** Convierte el historial en mensajes válidos para la API (empieza y termina en "user"). */
export function toApiMessages(history: HistoryItem[]): Anthropic.Beta.BetaMessageParam[] {
  const msgs: Anthropic.Beta.BetaMessageParam[] = [];
  for (const h of history) {
    const text = h.text.trim() || "[mensaje vacío]";
    const role = h.direction === "in" ? "user" : "assistant";
    const last = msgs[msgs.length - 1];
    if (last && last.role === role && typeof last.content === "string") {
      last.content = `${last.content}\n${text}`;
    } else {
      msgs.push({ role, content: text });
    }
  }
  while (msgs.length && msgs[0].role !== "user") msgs.shift();
  while (msgs.length && msgs[msgs.length - 1].role !== "user") msgs.pop();
  return msgs;
}

let _client: Anthropic | undefined;
const client = () => (_client ??= new Anthropic());

export async function runClaudia(opts: {
  history: HistoryItem[];
  catalog: CatalogItem[] | Parameters<typeof renderBusinessContext>[0];
  settings: Settings;
  contactName: string | null;
  now: Date;
  handlers: ToolHandlers;
}): Promise<AgentResult> {
  const messages = toApiMessages(opts.history);
  if (!messages.length) throw new Error("No hay mensaje del cliente para responder");

  const system: Anthropic.Beta.BetaTextBlockParam[] = [
    { type: "text", text: loadClaudiaPrompt() },
    {
      type: "text",
      text: renderBusinessContext(opts.catalog, opts.settings),
      cache_control: { type: "ephemeral" },
    },
    { type: "text", text: renderVolatileContext(opts) },
  ];

  const actions: AgentAction[] = [];
  const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  let text = "";
  let stopReason: string | null = null;

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const response = await client().beta.messages.create({
      model: DRAFT_MODEL,
      max_tokens: 4096,
      // Chat corto: esfuerzo bajo-medio alcanza y responde más rápido.
      output_config: { effort: "medium" },
      // Si el modelo declina por un falso positivo de seguridad, el servidor reintenta con otro modelo.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system,
      tools: TOOLS,
      messages,
    });

    usage.input += response.usage.input_tokens;
    usage.output += response.usage.output_tokens;
    usage.cacheRead += response.usage.cache_read_input_tokens ?? 0;
    usage.cacheWrite += response.usage.cache_creation_input_tokens ?? 0;
    stopReason = response.stop_reason;

    const textNow = response.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
    if (textNow) text = textNow;

    if (response.stop_reason === "refusal") {
      return { text: "", actions, stopReason, refused: true, usage };
    }
    if (response.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: response.content });
      continue;
    }
    if (response.stop_reason !== "tool_use") break;

    const toolUses = response.content.filter(
      (b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use",
    );
    messages.push({ role: "assistant", content: response.content });

    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    for (const tu of toolUses) {
      results.push(await executeTool(tu, opts.handlers, actions));
    }
    messages.push({ role: "user", content: results });
  }

  return { text, actions, stopReason, refused: false, usage };
}

async function executeTool(
  tu: Anthropic.Beta.BetaToolUseBlock,
  handlers: ToolHandlers,
  actions: AgentAction[],
): Promise<Anthropic.Beta.BetaToolResultBlockParam> {
  const err = (content: string): Anthropic.Beta.BetaToolResultBlockParam => ({
    type: "tool_result",
    tool_use_id: tu.id,
    is_error: true,
    content,
  });
  try {
    if (tu.name === "crear_solicitud_turno") {
      const p = appointmentInput.safeParse(tu.input);
      if (!p.success) return err("Datos incompletos: hacen falta nombre, tratamiento y preferencia.");
      actions.push({ tool: tu.name, input: p.data });
      return { type: "tool_result", tool_use_id: tu.id, content: await handlers.createAppointment(p.data) };
    }
    if (tu.name === "derivar_a_humano") {
      const p = handoffInput.safeParse(tu.input);
      if (!p.success) return err("Falta motivo o prioridad.");
      actions.push({ tool: tu.name, input: p.data });
      return { type: "tool_result", tool_use_id: tu.id, content: await handlers.handoff(p.data) };
    }
    return err(`Herramienta desconocida: ${tu.name}`);
  } catch (e) {
    return err("No se pudo registrar. Decile a la persona que el equipo le escribe.");
  }
}
