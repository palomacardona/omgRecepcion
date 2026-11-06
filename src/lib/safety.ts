/**
 * Red de seguridad determinística, además del criterio de Claude.
 * Si un mensaje matchea, se fuerza la derivación aunque el modelo no la haya pedido,
 * y el borrador nunca puede salir en modo automático.
 */

export type SafetyFlag = {
  kind: "emergencia" | "salud" | "queja" | "pide_humano";
  priority: "urgente" | "alta" | "media";
  match: string;
};

const normalize = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

const RULES: { kind: SafetyFlag["kind"]; priority: SafetyFlag["priority"]; patterns: RegExp[] }[] = [
  {
    kind: "emergencia",
    priority: "urgente",
    patterns: [
      /no puedo respirar/,
      /(me cuesta|dificultad para|problemas? para) respirar/,
      /me (estoy )?ahog/,
      /se me (esta )?(cerrando|hinchando) la garganta/,
      /(hinchazon|hinchad[oa]s?|inflamad[oa]s?) .{0,20}(cara|labios?|garganta|lengua|ojos?)/,
      /(cara|labios?|garganta|lengua|ojos?) .{0,12}(hinchad[oa]s?|inflamad[oa]s?)/,
      /desmay/,
      /sangr(a|ando|ado) (mucho|sin parar|no para)/,
      /no (me )?para de sangrar/,
      /dolor (muy |re |super |insoportable|terrible|tremendo)/,
      /anafila/,
      /fiebre (alta|de 3[89]|de 40)/,
    ],
  },
  {
    kind: "salud",
    priority: "alta",
    patterns: [
      /embaraz/,
      /lactan|amamant|dando (la )?teta|dando pecho/,
      /alergi|alergic/,
      /medicacion|medicament|remedio|pastillas?|antibiotic|anticoagul|isotretinoin|roacutan/,
      /diabet|hipertens|presion alta|cancer|oncolog|quimio|marcapaso|epileps|tiroides|lupus|herpes/,
      /(me|le) (salio|salieron|quedo|quedaron) .{0,25}(ronchas?|granos?|manchas?|marcas?|ampollas?|moretones?)/,
      /ronchas?|ampollas?|quemadura|me quem|infecci|pus\b/,
      /reaccion/,
      /me (arde|pica|duele) (mucho|un monton|la cara|la piel|la zona)/,
      /se me (inflamo|hincho|irrito|puso roj)/,
    ],
  },
  {
    kind: "queja",
    priority: "alta",
    patterns: [
      /quej|reclamo|denunci|estafa|defensa del consumidor/,
      /devolu(cion|eltan|elvan)|reembols|me devuelvan/,
      /pesim[oa]|horrible|un desastre|muy mal servicio|nunca mas (voy|vuelvo)/,
    ],
  },
  {
    kind: "pide_humano",
    priority: "media",
    patterns: [
      /hablar con (una |alguna |alguien|un |el |la )?(persona|humano|humana|encargad|duen|alguien|recepcionista|profesional)/,
      /(atiende|atendeme|me atiende) (una persona|alguien|un humano)/,
      /(sos|eres) (un )?(bot|robot|ia|inteligencia artificial)\?.{0,40}(persona|humano)/,
      /quiero (una persona|un humano|alguien real)/,
    ],
  },
];

export function detectSafetyFlags(text: string): SafetyFlag[] {
  const t = normalize(text);
  const flags: SafetyFlag[] = [];
  for (const rule of RULES) {
    for (const p of rule.patterns) {
      const m = t.match(p);
      if (m) {
        flags.push({ kind: rule.kind, priority: rule.priority, match: m[0] });
        break;
      }
    }
  }
  return flags;
}

const ORDER = { urgente: 3, alta: 2, media: 1, baja: 0 } as const;

export function highestPriority(
  ps: Array<"urgente" | "alta" | "media" | "baja">,
): "urgente" | "alta" | "media" | "baja" | null {
  if (!ps.length) return null;
  return ps.reduce((a, b) => (ORDER[b] > ORDER[a] ? b : a));
}

export const EMERGENCY_REPLY =
  "Si tenés dificultad para respirar, hinchazón de la cara o la garganta, un dolor muy fuerte o un sangrado que no para, llamá ya al 911 o andá a la emergencia más cercana. Ya le avisé al equipo para que te contacte enseguida.";
