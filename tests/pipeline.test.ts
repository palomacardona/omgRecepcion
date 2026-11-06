import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { appointmentRequests, contacts, drafts, handoffs, messages, settings } from "@/db/schema";
import { DEFAULT_SETTINGS } from "@/lib/settings";
import { sign } from "@/lib/whatsapp/signature";
import { echo, inboundAudio, inboundText, status } from "./helpers/payloads";
import { setupTestDb } from "./helpers/testdb";

// --- Mocks: Claude y el `after()` de Next -----------------------------------------
const agentMock = vi.hoisted(() => ({
  impl: null as null | ((opts: any) => Promise<any>),
  calls: 0,
}));
vi.mock("@/lib/claudia/agent", async (orig) => {
  const real = await orig<typeof import("@/lib/claudia/agent")>();
  return {
    ...real,
    runClaudia: async (opts: any) => {
      agentMock.calls++;
      return agentMock.impl!(opts);
    },
  };
});
const classifyMock = vi.hoisted(() => ({ value: "otro" as string }));
vi.mock("@/lib/claudia/classify", () => ({ classifyExchange: async () => classifyMock.value }));

const afterQueue = vi.hoisted(() => [] as Array<() => Promise<void>>);
vi.mock("next/server", async (orig) => ({
  ...(await orig<typeof import("next/server")>()),
  after: (fn: () => Promise<void>) => afterQueue.push(fn),
}));

const { POST, GET } = await import("@/app/api/whatsapp/route");
const { sendDraft, processBacklog } = await import("@/lib/pipeline");

// ----------------------------------------------------------------------------------
const SECRET = "app-secret-test";
let d: Awaited<ReturnType<typeof setupTestDb>>;
let seq = 0;

const reply = (text: string, actions: any[] = []) => async (opts: any) => {
  for (const a of actions) {
    if (a.tool === "crear_solicitud_turno") await opts.handlers.createAppointment(a.input);
    if (a.tool === "derivar_a_humano") await opts.handlers.handoff(a.input);
  }
  return { text, actions, stopReason: "end_turn", refused: false, usage: {} };
};

async function deliver(payload: unknown, opts: { badSignature?: boolean } = {}) {
  const raw = JSON.stringify(payload);
  const req = new NextRequest("http://localhost/api/whatsapp", {
    method: "POST",
    body: raw,
    headers: { "x-hub-signature-256": sign(raw, opts.badSignature ? "otro" : SECRET), "content-type": "application/json" },
  });
  const res = await POST(req);
  while (afterQueue.length) await afterQueue.shift()!();
  return res;
}

const uid = () => `wamid.TEST${++seq}`;
const phone = () => `5989${String(1000000 + seq).padStart(7, "0")}`;

async function contactByWa(waId: string) {
  const [c] = await d.select().from(contacts).where(eq(contacts.waId, waId));
  return c;
}
async function draftsOf(contactId: number) {
  return d.select().from(drafts).where(eq(drafts.contactId, contactId));
}

beforeAll(async () => {
  process.env.WHATSAPP_APP_SECRET = SECRET;
  process.env.WHATSAPP_VERIFY_TOKEN = "verificame";
  process.env.WHATSAPP_DRY_RUN = "true";
  d = await setupTestDb();
});

beforeEach(async () => {
  agentMock.calls = 0;
  agentMock.impl = reply("¡Hola Sofi! La limpieza facial sale $ 2.500 😊");
  classifyMock.value = "otro";
  await d.delete(settings);
});

describe("verificación GET", () => {
  it("devuelve el challenge con el token correcto y 403 si no", async () => {
    const ok = await GET(new NextRequest("http://x/api/whatsapp?hub.mode=subscribe&hub.verify_token=verificame&hub.challenge=123"));
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe("123");
    const bad = await GET(new NextRequest("http://x/api/whatsapp?hub.mode=subscribe&hub.verify_token=nop&hub.challenge=123"));
    expect(bad.status).toBe(403);
  });
});

describe("webhook POST", () => {
  it("rechaza firma inválida y no guarda nada", async () => {
    const from = phone();
    const res = await deliver(inboundText({ id: uid(), from, text: "Hola" }), { badSignature: true });
    expect(res.status).toBe(401);
    expect(await contactByWa(from)).toBeUndefined();
  });

  it("guarda, crea borrador pendiente y no envía nada (modo aprobación)", async () => {
    const from = phone();
    const res = await deliver(inboundText({ id: uid(), from, text: "¿Cuánto sale la limpieza?" }));
    expect(res.status).toBe(200);
    const c = await contactByWa(from);
    expect(c.name).toBe("Sofi");
    const ds = await draftsOf(c.id);
    expect(ds).toHaveLength(1);
    expect(ds[0]).toMatchObject({ status: "pending", category: "faq", autoSent: false });
    const outs = await d.select().from(messages).where(eq(messages.contactId, c.id));
    expect(outs.filter((m) => m.direction === "out")).toHaveLength(0);
  });

  it("dedupe: el mismo wamid dos veces no duplica mensajes ni borradores", async () => {
    const from = phone();
    const id = uid();
    await deliver(inboundText({ id, from, text: "Hola" }));
    await deliver(inboundText({ id, from, text: "Hola" }));
    const c = await contactByWa(from);
    const ins = await d.select().from(messages).where(eq(messages.contactId, c.id));
    expect(ins).toHaveLength(1);
    expect(await draftsOf(c.id)).toHaveLength(1);
    expect(agentMock.calls).toBe(1);
  });

  it("actualiza estados de entrega", async () => {
    const from = phone();
    await deliver(inboundText({ id: uid(), from, text: "Hola" }));
    const c = await contactByWa(from);
    const [draft] = await draftsOf(c.id);
    expect((await sendDraft(draft.id, { reviewer: "Paloma" })).ok).toBe(true);
    const [out] = (await d.select().from(messages).where(eq(messages.contactId, c.id))).filter((m) => m.direction === "out");
    await deliver(status({ id: out.waMessageId!, status: "delivered" }));
    const [after] = await d.select().from(messages).where(eq(messages.id, out.id));
    expect(after.status).toBe("delivered");
  });
});

describe("eco del equipo (Coexistence)", () => {
  it("un eco descarta el borrador pendiente y Claudia se calla durante el cooldown", async () => {
    const from = phone();
    await deliver(inboundText({ id: uid(), from, text: "Hola" }));
    const c = await contactByWa(from);
    await deliver(echo({ id: uid(), to: from, text: "Hola! Te escribo yo 😊" }));
    expect((await draftsOf(c.id))[0].status).toBe("superseded");

    await deliver(inboundText({ id: uid(), from, text: "Genial gracias" }));
    expect(agentMock.calls).toBe(1); // no se llamó de nuevo
    expect((await draftsOf(c.id)).filter((x) => x.status === "pending")).toHaveLength(0);
  });
});

describe("audios e imágenes", () => {
  it("contesta que solo lee texto y deriva, sin llamar a Claude", async () => {
    const from = phone();
    await deliver(inboundAudio({ id: uid(), from }));
    const c = await contactByWa(from);
    const [draft] = await draftsOf(c.id);
    expect(draft.category).toBe("no_texto");
    expect(draft.proposedText).toMatch(/solo puedo leer mensajes de texto/);
    expect(await d.select().from(handoffs).where(eq(handoffs.contactId, c.id))).toHaveLength(1);
    expect(agentMock.calls).toBe(0);
  });
});

describe("salud", () => {
  it("emergencia: respuesta fija con 911 y derivación urgente, sin Claude", async () => {
    const from = phone();
    await deliver(inboundText({ id: uid(), from, text: "Me cuesta respirar después del relleno" }));
    const c = await contactByWa(from);
    const [draft] = await draftsOf(c.id);
    expect(draft.proposedText).toContain("911");
    const [h] = await d.select().from(handoffs).where(eq(handoffs.contactId, c.id));
    expect(h.priority).toBe("urgente");
    expect(agentMock.calls).toBe(0);
  });

  it("si Claudia no derivó un tema de salud, la red de seguridad deriva igual con prioridad alta", async () => {
    agentMock.impl = reply("¡Claro! Te cuento sobre el peeling…"); // el modelo "se olvida" de derivar
    const from = phone();
    await deliver(inboundText({ id: uid(), from, text: "Estoy embarazada, ¿puedo hacerme un peeling?" }));
    const c = await contactByWa(from);
    const hs = await d.select().from(handoffs).where(eq(handoffs.contactId, c.id));
    expect(hs.map((h) => h.priority)).toContain("alta");
    expect((await draftsOf(c.id))[0].category).toBe("derivacion");
  });

  it("si Claudia ya derivó con prioridad suficiente, no duplica", async () => {
    agentMock.impl = reply("Le paso tu consulta al equipo 😊", [
      { tool: "derivar_a_humano", input: { motivo: "embarazo", prioridad: "alta" } },
    ]);
    const from = phone();
    await deliver(inboundText({ id: uid(), from, text: "Estoy embarazada" }));
    const c = await contactByWa(from);
    expect(await d.select().from(handoffs).where(eq(handoffs.contactId, c.id))).toHaveLength(1);
  });
});

describe("turnos", () => {
  it("crea la solicitud de turno vía herramienta", async () => {
    agentMock.impl = reply("¡Listo! Te confirmamos en un ratito 😊", [
      {
        tool: "crear_solicitud_turno",
        input: { nombre: "Sofi", tratamiento: "Limpieza facial", preferencia_dias: "jueves", preferencia_horario: "tarde", notas: "" },
      },
    ]);
    const from = phone();
    await deliver(inboundText({ id: uid(), from, text: "Soy Sofi, limpieza el jueves de tarde" }));
    const c = await contactByWa(from);
    const [a] = await d.select().from(appointmentRequests).where(eq(appointmentRequests.contactId, c.id));
    expect(a).toMatchObject({ treatment: "Limpieza facial", status: "nueva" });
    expect((await draftsOf(c.id))[0].category).toBe("turno");
  });
});

describe("envío y ventana de 24 h", () => {
  it("aprobar envía el texto editado y lo registra", async () => {
    const from = phone();
    await deliver(inboundText({ id: uid(), from, text: "Hola" }));
    const c = await contactByWa(from);
    const [draft] = await draftsOf(c.id);
    const res = await sendDraft(draft.id, { reviewer: "Paloma", editedText: "Hola Sofi! 💖" });
    expect(res.ok).toBe(true);
    const [after] = await draftsOf(c.id);
    expect(after).toMatchObject({ status: "sent", edited: true, reviewedBy: "Paloma", finalText: "Hola Sofi! 💖" });
    // Doble click: no se manda dos veces.
    expect((await sendDraft(draft.id, { reviewer: "Paloma" })).ok).toBe(false);
  });

  it("con la ventana cerrada no deja enviar texto libre", async () => {
    const from = phone();
    const old = Math.floor(Date.now() / 1000) - 25 * 3600;
    await deliver(inboundText({ id: uid(), from, text: "Hola", ts: old }));
    const c = await contactByWa(from);
    const [draft] = await draftsOf(c.id);
    const res = await sendDraft(draft.id, { reviewer: "Paloma" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/24 h/);
    expect((await draftsOf(c.id))[0].status).toBe("pending");
  });
});

describe("modo automático", () => {
  it("solo autoenvía la categoría activada", async () => {
    await d.insert(settings).values({
      key: "main",
      value: {
        ...DEFAULT_SETTINGS,
        businessHours: Array(7).fill({ open: "00:00", close: "23:59" }),
        autoSend: { faq_horarios: true, faq_ubicacion: false, faq_general: false },
      },
    });
    classifyMock.value = "faq_horarios";
    agentMock.impl = reply("Abrimos de lunes a viernes de 9 a 19 😊");
    const from = phone();
    await deliver(inboundText({ id: uid(), from, text: "¿Qué horario tienen?" }));
    const c = await contactByWa(from);
    expect((await draftsOf(c.id))[0]).toMatchObject({ status: "sent", autoSent: true });

    classifyMock.value = "precios";
    agentMock.impl = reply("La limpieza sale $ 2.500");
    const from2 = phone();
    await deliver(inboundText({ id: uid(), from: from2, text: "¿precio?" }));
    const c2 = await contactByWa(from2);
    expect((await draftsOf(c2.id))[0].status).toBe("pending");
  });
});

describe("Claudia pausada", () => {
  it("guarda el mensaje pero no llama a Claude, no crea borrador ni manda nada automático", async () => {
    await d.insert(settings).values({
      key: "main",
      value: {
        ...DEFAULT_SETTINGS,
        enabled: false,
        businessHours: Array(7).fill(null), // siempre cerrado
        outOfHoursAutoReply: true, // aunque esté activado, pausada no manda el aviso
        autoSend: { faq_horarios: true, faq_ubicacion: true, faq_general: true },
      },
    });
    const from = phone();
    await deliver(inboundText({ id: uid(), from, text: "¿Qué horario tienen?" }));
    const c = await contactByWa(from);
    const msgs = await d.select().from(messages).where(eq(messages.contactId, c.id));
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toMatchObject({ direction: "in", processing: "skipped", lastError: "Claudia pausada" });
    expect(c.lastInboundAt).not.toBeNull(); // la ventana de 24 h se sigue registrando
    expect(await draftsOf(c.id)).toHaveLength(0);
    expect(agentMock.calls).toBe(0);
  });

  it("al reactivarla no responde lo acumulado, sí lo nuevo", async () => {
    await d.insert(settings).values({ key: "main", value: { ...DEFAULT_SETTINGS, enabled: false } });
    const from = phone();
    await deliver(inboundText({ id: uid(), from, text: "Hola, ¿están?" }));

    await d.update(settings).set({ value: { ...DEFAULT_SETTINGS, enabled: true } }).where(eq(settings.key, "main"));
    // El cron no lo retoma: quedó "skipped", no "failed".
    await d.update(messages).set({ createdAt: new Date(Date.now() - 5 * 60_000) });
    await processBacklog();
    expect(agentMock.calls).toBe(0);

    await deliver(inboundText({ id: uid(), from, text: "¿Cuánto sale la limpieza?" }));
    expect(agentMock.calls).toBe(1);
    const c = await contactByWa(from);
    expect(await draftsOf(c.id)).toHaveLength(1);
  });
});

describe("reintentos", () => {
  it("si Claude falla, el mensaje queda 'failed' y el cron lo reintenta", async () => {
    agentMock.impl = async () => {
      throw new Error("overloaded");
    };
    const from = phone();
    await deliver(inboundText({ id: uid(), from, text: "Hola" }));
    const c = await contactByWa(from);
    const [m] = await d.select().from(messages).where(eq(messages.contactId, c.id));
    expect(m.processing).toBe("failed");

    agentMock.impl = reply("¡Hola!");
    // Simular que pasó más de un minuto.
    await d.update(messages).set({ createdAt: new Date(Date.now() - 5 * 60_000) }).where(eq(messages.id, m.id));
    await processBacklog();
    expect((await draftsOf(c.id))[0].status).toBe("pending");
  });
});
