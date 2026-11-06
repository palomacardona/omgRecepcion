/**
 * Evals de Claudia con el modelo REAL (gasta tokens de la API de Anthropic).
 * Uso: npm run evals            → todos los casos
 *      npm run evals -- embarazo → solo los casos cuyo id contiene "embarazo"
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { runClaudia, type AgentAction } from "../src/lib/claudia/agent";
import { DEFAULT_SETTINGS } from "../src/lib/settings";
import { CASES, EVAL_CATALOG, type EvalCase } from "./cases";

const ORDER = { baja: 0, media: 1, alta: 2, urgente: 3 } as const;
const settings = { ...DEFAULT_SETTINGS, address: "Calle Falsa 123, Montevideo" };
// Viernes 11:00 en Uruguay: centro abierto.
const NOW = new Date("2026-11-06T14:00:00Z");

function grade(c: EvalCase, text: string, actions: AgentAction[]): string[] {
  const fails: string[] = [];
  const used = new Set(actions.map((a) => a.tool));
  for (const t of c.expect.tools ?? []) if (!used.has(t)) fails.push(`no llamó ${t}`);
  for (const t of c.expect.noTools ?? []) if (used.has(t)) fails.push(`llamó ${t} y no debía`);
  if (c.expect.minPriority) {
    const max = Math.max(-1, ...actions.filter((a) => a.tool === "derivar_a_humano").map((a) => ORDER[(a.input as any).prioridad as keyof typeof ORDER]));
    if (max < ORDER[c.expect.minPriority]) fails.push(`prioridad < ${c.expect.minPriority}`);
  }
  for (const r of c.expect.mustMatch ?? []) if (!r.test(text)) fails.push(`no contiene ${r}`);
  for (const r of c.expect.mustNotMatch ?? []) if (r.test(text)) fails.push(`contiene ${r}`);

  // Regla global: todo precio mencionado tiene que estar en el catálogo.
  const known = EVAL_CATALOG.map((i) => i.price).filter(Boolean).join(" ");
  for (const m of text.matchAll(/\$\s?([\d.]+)/g)) {
    if (!known.includes(m[1].replace(/\.$/, ""))) fails.push(`precio inventado: ${m[0]}`);
  }
  if (text.length > 600) fails.push(`respuesta larga (${text.length} caracteres)`);
  return fails;
}

const filter = process.argv[2];
const cases = CASES.filter((c) => !filter || c.id.includes(filter));
const results: any[] = [];
let passed = 0;

for (const c of cases) {
  try {
    const r = await runClaudia({
      history: c.history,
      catalog: EVAL_CATALOG,
      settings,
      contactName: "Sofi",
      now: NOW,
      handlers: { createAppointment: async () => "Solicitud registrada.", handoff: async () => "Equipo avisado." },
    });
    const fails = r.refused ? ["el modelo declinó"] : grade(c, r.text, r.actions);
    if (!fails.length) passed++;
    console.log(`${fails.length ? "✗" : "✓"} ${c.id}${fails.length ? `  → ${fails.join("; ")}` : ""}`);
    results.push({ id: c.id, ok: !fails.length, fails, text: r.text, actions: r.actions, usage: r.usage });
  } catch (e) {
    console.log(`✗ ${c.id}  → error: ${e instanceof Error ? e.message : e}`);
    results.push({ id: c.id, ok: false, error: String(e) });
  }
}

console.log(`\n${passed}/${cases.length} casos OK`);
mkdirSync("evals/results", { recursive: true });
const file = `evals/results/${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
writeFileSync(file, JSON.stringify(results, null, 2));
console.log(`Detalle en ${file}`);
process.exit(passed === cases.length ? 0 : 1);
