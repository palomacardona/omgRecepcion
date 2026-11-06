/** Cliente mínimo de la WhatsApp Cloud API (Graph API). */

export type SendResult = { ok: true; waMessageId: string; simulated: boolean } | { ok: false; error: string };

export type TemplateSpec = {
  name: string;
  language: string;
  /** Parámetros del cuerpo ({{1}}, {{2}}, …), en orden. */
  bodyParams?: string[];
};

function config() {
  return {
    token: process.env.WHATSAPP_TOKEN ?? "",
    phoneId: process.env.WHATSAPP_PHONE_NUMBER_ID ?? "",
    version: process.env.WHATSAPP_API_VERSION ?? "v23.0",
    dryRun: process.env.WHATSAPP_DRY_RUN === "true",
  };
}

async function post(payload: Record<string, unknown>): Promise<SendResult> {
  const c = config();
  if (c.dryRun) {
    return { ok: true, waMessageId: `simulated.${crypto.randomUUID()}`, simulated: true };
  }
  if (!c.token || !c.phoneId) return { ok: false, error: "Faltan WHATSAPP_TOKEN / WHATSAPP_PHONE_NUMBER_ID" };
  try {
    const res = await fetch(`https://graph.facebook.com/${c.version}/${c.phoneId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${c.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", ...payload }),
      signal: AbortSignal.timeout(15_000),
    });
    const data = (await res.json().catch(() => ({}))) as any;
    if (!res.ok) {
      const e = data?.error;
      return { ok: false, error: e ? `${e.code ?? res.status}: ${e.message ?? "error"}` : `HTTP ${res.status}` };
    }
    const id = data?.messages?.[0]?.id;
    return id ? { ok: true, waMessageId: id, simulated: false } : { ok: false, error: "Respuesta sin message id" };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export function sendText(to: string, body: string): Promise<SendResult> {
  return post({ recipient_type: "individual", to, type: "text", text: { body, preview_url: false } });
}

export function sendTemplate(to: string, t: TemplateSpec): Promise<SendResult> {
  const components = t.bodyParams?.length
    ? [{ type: "body", parameters: t.bodyParams.map((text) => ({ type: "text", text })) }]
    : undefined;
  return post({
    to,
    type: "template",
    template: { name: t.name, language: { code: t.language }, ...(components ? { components } : {}) },
  });
}

/** Marca como leído (tilde azul). Best effort. */
export async function markRead(waMessageId: string): Promise<void> {
  if (config().dryRun) return;
  await post({ status: "read", message_id: waMessageId }).catch(() => undefined);
}
