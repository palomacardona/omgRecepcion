import { describe, expect, it, beforeAll } from "vitest";
import { toApiMessages } from "@/lib/claudia/agent";
import { renderBusinessContext } from "@/lib/claudia/context";
import { canAutoSend, draftCategory } from "@/lib/policy";
import { detectSafetyFlags } from "@/lib/safety";
import { DEFAULT_SETTINGS, parseSettings } from "@/lib/settings";
import { humanRecentlyReplied, isOpen, isWindowOpen, nextOpening } from "@/lib/time";
import { parseWebhook } from "@/lib/whatsapp/parse";
import { sign, verifySignature } from "@/lib/whatsapp/signature";
import { decodeSession, encodeSession } from "@/lib/auth";
import { echo, inboundAudio, inboundText, status } from "./helpers/payloads";

describe("firma del webhook (X-Hub-Signature-256)", () => {
  const secret = "app-secret-de-prueba";
  const body = JSON.stringify(inboundText({ id: "wamid.1", from: "59891111111", text: "Hola" }));

  it("acepta una firma válida", () => {
    expect(verifySignature(body, sign(body, secret), secret)).toBe(true);
  });
  it("rechaza firma con otro secreto", () => {
    expect(verifySignature(body, sign(body, "otro"), secret)).toBe(false);
  });
  it("rechaza si el cuerpo cambió (aunque sea un espacio)", () => {
    expect(verifySignature(body + " ", sign(body, secret), secret)).toBe(false);
  });
  it("rechaza header ausente, mal formado o algoritmo distinto", () => {
    expect(verifySignature(body, null, secret)).toBe(false);
    expect(verifySignature(body, "sha256=zzz", secret)).toBe(false);
    expect(verifySignature(body, sign(body, secret).replace("sha256", "sha1"), secret)).toBe(false);
  });
  it("rechaza todo si no hay App Secret configurado", () => {
    expect(verifySignature(body, sign(body, ""), "")).toBe(false);
  });
});

describe("parseo del webhook", () => {
  it("extrae mensaje de texto con nombre de perfil", () => {
    const [ev] = parseWebhook(inboundText({ id: "wamid.A", from: "59891111111", text: "Hola!", ts: 1_700_000_000, name: "Sofi" }));
    expect(ev).toMatchObject({ kind: "inbound", waMessageId: "wamid.A", waId: "59891111111", profileName: "Sofi", type: "text", text: "Hola!" });
    expect(ev.timestamp.getTime()).toBe(1_700_000_000_000);
  });
  it("marca audios como audio", () => {
    const [ev] = parseWebhook(inboundAudio({ id: "wamid.B", from: "59891111111" }));
    expect(ev).toMatchObject({ kind: "inbound", type: "audio" });
  });
  it("lee ecos de Coexistence (smb_message_echoes) con el cliente en 'to'", () => {
    const [ev] = parseWebhook(echo({ id: "wamid.C", to: "59891111111", text: "Te escribo yo" }));
    expect(ev).toMatchObject({ kind: "echo", waId: "59891111111", text: "Te escribo yo" });
  });
  it("lee estados de entrega", () => {
    const [ev] = parseWebhook(status({ id: "wamid.D", status: "delivered" }));
    expect(ev).toMatchObject({ kind: "status", status: "delivered" });
  });
  it("ignora payloads basura sin romper", () => {
    expect(parseWebhook(null)).toEqual([]);
    expect(parseWebhook({ entry: [{ changes: [{ field: "messages", value: {} }] }] })).toEqual([]);
  });
});

describe("ventana de 24 h", () => {
  const now = new Date("2026-11-06T15:00:00Z");
  it("abierta dentro de las 24 h", () => {
    expect(isWindowOpen(new Date(now.getTime() - 23.9 * 3600_000), now)).toBe(true);
  });
  it("cerrada a las 24 h justas o después", () => {
    expect(isWindowOpen(new Date(now.getTime() - 24 * 3600_000), now)).toBe(false);
    expect(isWindowOpen(new Date(now.getTime() - 30 * 3600_000), now)).toBe(false);
  });
  it("cerrada si el cliente nunca escribió", () => {
    expect(isWindowOpen(null, now)).toBe(false);
  });
});

describe("horario (America/Montevideo, UTC-3)", () => {
  const s = DEFAULT_SETTINGS; // L-V 9-19, sáb 9-13, dom cerrado
  it("viernes 10:00 UY (13:00 UTC) está abierto", () => {
    expect(isOpen(s, new Date("2026-11-06T13:00:00Z"))).toBe(true);
  });
  it("viernes 19:30 UY está cerrado y abre mañana a las 09:00", () => {
    const t = new Date("2026-11-06T22:30:00Z");
    expect(isOpen(s, t)).toBe(false);
    expect(nextOpening(s, t)).toBe("mañana a las 09:00");
  });
  it("domingo cerrado → abre el lunes", () => {
    const t = new Date("2026-11-08T15:00:00Z");
    expect(isOpen(s, t)).toBe(false);
    expect(nextOpening(s, t)).toBe("mañana a las 09:00");
  });
  it("sábado 14:00 UY → el lunes", () => {
    expect(nextOpening(s, new Date("2026-11-07T17:00:00Z"))).toBe("el lunes a las 09:00");
  });
  it("madrugada → hoy", () => {
    expect(nextOpening(s, new Date("2026-11-06T09:00:00Z"))).toBe("hoy a las 09:00");
  });
});

describe("no pisar al equipo", () => {
  const now = new Date("2026-11-06T15:00:00Z");
  it("respuesta humana reciente bloquea a Claudia", () => {
    expect(humanRecentlyReplied(new Date(now.getTime() - 10 * 60_000), now, 30)).toBe(true);
    expect(humanRecentlyReplied(new Date(now.getTime() - 40 * 60_000), now, 30)).toBe(false);
    expect(humanRecentlyReplied(null, now, 30)).toBe(false);
  });
});

describe("red de seguridad: derivaciones de salud, quejas y pedidos de humano", () => {
  const cases: [string, string][] = [
    ["Hola, estoy embarazada de 3 meses, ¿me puedo hacer la limpieza?", "salud"],
    ["Estoy amamantando todavía", "salud"],
    ["Tomo Roacutan, ¿hay problema?", "salud"],
    ["Soy alérgica al látex", "salud"],
    ["Me salieron ronchas después del peeling", "salud"],
    ["Tengo diabetes tipo 2", "salud"],
    ["se me hinchó mucho la zona y me arde", "salud"],
    ["No puedo respirar bien desde que salí", "emergencia"],
    ["Tengo los labios muy hinchados después del relleno", "emergencia"],
    ["Me desmayé hace un rato", "emergencia"],
    ["Quiero hacer un reclamo, el servicio fue pésimo", "queja"],
    ["Quiero que me devuelvan la plata", "queja"],
    ["Quiero hablar con una persona por favor", "pide_humano"],
  ];
  it.each(cases)("%s → %s", (text, kind) => {
    expect(detectSafetyFlags(text).map((f) => f.kind)).toContain(kind);
  });

  const benign = [
    "Hola! ¿Cuánto sale la limpieza facial?",
    "¿Qué horario tienen el sábado?",
    "Quiero sacar turno para depilación láser",
    "¿Dónde quedan?",
    "Gracias divina!",
  ];
  it.each(benign)("no deriva consultas normales: %s", (text) => {
    expect(detectSafetyFlags(text)).toEqual([]);
  });

  it("la emergencia tiene prioridad urgente", () => {
    expect(detectSafetyFlags("me cuesta respirar")[0].priority).toBe("urgente");
  });
});

describe("política de envío automático", () => {
  const on = { ...DEFAULT_SETTINGS, autoSend: { faq_horarios: true, faq_ubicacion: true, faq_general: false } };
  const base = { settings: on, category: "faq" as const, flags: [], windowOpen: true };

  it("v1 por defecto: nunca automático", () => {
    expect(canAutoSend({ ...base, settings: DEFAULT_SETTINGS, classification: "faq_horarios" })).toBe(false);
  });
  it("automático solo para la categoría activada", () => {
    expect(canAutoSend({ ...base, classification: "faq_horarios" })).toBe(true);
    expect(canAutoSend({ ...base, classification: "faq_general" })).toBe(false);
  });
  it("nunca para precios, salud, quejas, turnos, cancelaciones", () => {
    for (const c of ["precios", "salud", "queja", "turno", "cancelacion", "otro"] as const) {
      expect(canAutoSend({ ...base, classification: c })).toBe(false);
    }
  });
  it("nunca si hay derivación, flags de seguridad o ventana cerrada", () => {
    expect(canAutoSend({ ...base, category: "derivacion", classification: "faq_horarios" })).toBe(false);
    expect(canAutoSend({ ...base, flags: detectSafetyFlags("estoy embarazada"), classification: "faq_horarios" })).toBe(false);
    expect(canAutoSend({ ...base, windowOpen: false, classification: "faq_horarios" })).toBe(false);
  });
  it("categoría del borrador", () => {
    expect(draftCategory([], [], true)).toBe("faq");
    expect(draftCategory([], [], false)).toBe("fuera_de_horario");
    expect(draftCategory([{ tool: "derivar_a_humano", input: { motivo: "x", prioridad: "baja" } }], [], true)).toBe("derivacion");
    expect(draftCategory([], detectSafetyFlags("tengo alergia"), true)).toBe("derivacion");
  });
});

describe("historial → mensajes de la API", () => {
  it("une mensajes seguidos del mismo rol y empieza/termina en user", () => {
    const msgs = toApiMessages([
      { direction: "out", text: "plantilla vieja" },
      { direction: "in", text: "Hola" },
      { direction: "in", text: "¿precio limpieza?" },
      { direction: "echo", text: "Hola Sofi! Sale $2500" },
      { direction: "in", text: "¿y el sábado?" },
    ]);
    expect(msgs.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    expect(msgs[0].content).toBe("Hola\n¿precio limpieza?");
  });
});

describe("catálogo en el prompt", () => {
  it("excluye inactivos y marca precios faltantes para no inventar", () => {
    const text = renderBusinessContext(
      [
        { name: "Limpieza facial", category: "Facial", description: "", durationMinutes: 60, price: "$ 2.500", preparation: null, contraindications: null, active: true },
        { name: "Peeling", category: "Facial", description: "", durationMinutes: null, price: null, preparation: null, contraindications: null, active: true },
        { name: "Viejo", category: null, description: "", durationMinutes: null, price: "$ 1", preparation: null, contraindications: null, active: false },
      ],
      DEFAULT_SETTINGS,
    );
    expect(text).toContain("Precio: $ 2.500");
    expect(text).toMatch(/Peeling[\s\S]*NO CARGADO/);
    expect(text).not.toContain("Viejo");
  });
});

describe("settings", () => {
  it("valores inválidos vuelven a los defaults", () => {
    expect(parseSettings({ historyLimit: "mucho" })).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings({ humanCooldownMinutes: 5 }).humanCooldownMinutes).toBe(5);
  });
});

describe("sesión del panel", () => {
  beforeAll(() => {
    process.env.SESSION_SECRET = "secreto-de-prueba-largo-123";
  });
  it("firma y valida", () => {
    expect(decodeSession(encodeSession("Paloma"))?.name).toBe("Paloma");
  });
  it("rechaza cookie alterada o vencida", () => {
    const v = encodeSession("Paloma");
    expect(decodeSession(v.slice(0, -2) + "xx")).toBeNull();
    expect(decodeSession(encodeSession("Paloma", Date.now() - 13 * 3600_000))).toBeNull();
  });
});
