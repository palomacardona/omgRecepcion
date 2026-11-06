import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";

export const CLASSIFIER_MODEL = "claude-haiku-5-5";

export const classification = z.object({
  categoria: z.enum([
    "faq_horarios",
    "faq_ubicacion",
    "faq_general",
    "precios",
    "turno",
    "salud",
    "queja",
    "cancelacion",
    "fuera_de_tema",
    "otro",
  ]),
});
export type Classification = z.infer<typeof classification>["categoria"];

let _client: Anthropic | undefined;
const client = () => (_client ??= new Anthropic());

/**
 * Clasifica el último mensaje del cliente + la respuesta propuesta.
 * Solo se usa para decidir el modo automático; ante cualquier duda devuelve "otro" (→ aprobación humana).
 */
export async function classifyExchange(customerText: string, draftText: string): Promise<Classification> {
  try {
    const res = await client().messages.parse({
      model: CLASSIFIER_MODEL,
      max_tokens: 256,
      output_config: { effort: "low", format: zodOutputFormat(classification) },
      system:
        "Clasificás intercambios de WhatsApp de un centro de estética. Elegí la categoría del pedido del cliente. " +
        "faq_horarios = solo pregunta horarios; faq_ubicacion = solo pregunta dirección/cómo llegar; " +
        "faq_general = pregunta simple sobre el centro sin precios ni salud; precios = cualquier mención de precios, promos o paquetes; " +
        "turno = pedir/agendar turno; salud = embarazo, enfermedades, medicación, alergias, reacciones; queja = reclamos o enojo; " +
        "cancelacion = cancelar o cambiar turnos; fuera_de_tema = nada que ver con el centro; otro = cualquier otra cosa o si dudás.",
      messages: [
        {
          role: "user",
          content: `<mensaje_cliente>\n${customerText}\n</mensaje_cliente>\n<respuesta_propuesta>\n${draftText}\n</respuesta_propuesta>`,
        },
      ],
    });
    return res.parsed_output?.categoria ?? "otro";
  } catch {
    return "otro";
  }
}
