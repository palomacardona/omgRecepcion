import type { TemplateSpec } from "./whatsapp/client";

/**
 * Plantillas que se pueden mandar cuando la ventana de 24 h está cerrada.
 * Los nombres tienen que coincidir EXACTAMENTE con los aprobados en WhatsApp Manager (ver README).
 */
export type TemplateDef = {
  id: string;
  label: string;
  /** Texto de ejemplo para mostrar en el panel ({{1}}… se reemplazan por los parámetros). */
  preview: string;
  params: { label: string; placeholder: string }[];
  spec: Omit<TemplateSpec, "bodyParams">;
};

export const TEMPLATES: TemplateDef[] = [
  {
    id: "consulta_seguimiento",
    label: "Te escribimos por tu consulta",
    preview: "¡Hola {{1}}! Te escribimos de OMG Que Linda por la consulta que nos dejaste. ¿Seguimos por acá?",
    params: [{ label: "Nombre", placeholder: "Sofi" }],
    spec: { name: "consulta_seguimiento", language: "es" },
  },
  {
    id: "confirmacion_turno",
    label: "Confirmación de turno",
    preview: "¡Hola {{1}}! Te confirmamos tu turno de {{2}} el {{3}}. ¡Te esperamos en OMG Que Linda!",
    params: [
      { label: "Nombre", placeholder: "Sofi" },
      { label: "Tratamiento", placeholder: "limpieza facial" },
      { label: "Día y hora", placeholder: "jueves 12/11 a las 15:00" },
    ],
    spec: { name: "confirmacion_turno", language: "es" },
  },
  {
    id: "recordatorio_turno",
    label: "Recordatorio de turno",
    preview: "¡Hola {{1}}! Te recordamos tu turno de {{2}} el {{3}} en OMG Que Linda. Si no podés venir, avisanos por acá.",
    params: [
      { label: "Nombre", placeholder: "Sofi" },
      { label: "Tratamiento", placeholder: "limpieza facial" },
      { label: "Día y hora", placeholder: "mañana a las 15:00" },
    ],
    spec: { name: "recordatorio_turno", language: "es" },
  },
];

export function renderTemplatePreview(t: TemplateDef, params: string[]): string {
  return t.preview.replace(/\{\{(\d+)\}\}/g, (_, n) => params[Number(n) - 1] ?? `{{${n}}}`);
}
