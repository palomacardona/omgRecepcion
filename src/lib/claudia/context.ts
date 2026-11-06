import { readFileSync } from "node:fs";
import path from "node:path";
import type { CatalogItem } from "@/db/schema";
import { formatBusinessHours, type Settings } from "../settings";
import { isOpen, localParts, nextOpening } from "../time";

let cachedPrompt: string | undefined;

/** System prompt versionado en prompts/claudia.md (no hardcodeado). */
export function loadClaudiaPrompt(): string {
  if (cachedPrompt === undefined) {
    const file = path.join(process.cwd(), "prompts", "claudia.md");
    cachedPrompt = readFileSync(file, "utf8").replace(/<!--[\s\S]*?-->\s*/g, "").trim();
  }
  return cachedPrompt;
}

type CatalogLike = Pick<
  CatalogItem,
  "name" | "category" | "description" | "durationMinutes" | "price" | "preparation" | "contraindications" | "active"
>;

/** Texto estable (cacheable) con el catálogo y los datos fijos del centro. Orden determinístico. */
export function renderBusinessContext(catalog: CatalogLike[], s: Settings): string {
  const items = catalog
    .filter((c) => c.active)
    .slice()
    .sort((a, b) => (a.category ?? "").localeCompare(b.category ?? "") || a.name.localeCompare(b.name))
    .map((c) => {
      const lines = [`### ${c.name}${c.category ? ` (${c.category})` : ""}`];
      if (c.description) lines.push(`Descripción: ${c.description}`);
      lines.push(`Precio: ${c.price?.trim() ? c.price : "NO CARGADO (consultar con el equipo, no inventar)"}`);
      if (c.durationMinutes) lines.push(`Duración: ${c.durationMinutes} min`);
      if (c.preparation) lines.push(`Preparación / cuidados: ${c.preparation}`);
      if (c.contraindications) lines.push(`Contraindicaciones (ante cualquiera de estas, derivar): ${c.contraindications}`);
      return lines.join("\n");
    });

  return [
    `# DATOS DEL CENTRO`,
    `Nombre: ${s.businessName}`,
    `Dirección: ${s.address}${s.mapsUrl ? ` (mapa: ${s.mapsUrl})` : ""}`,
    `Horario de atención (hora de Uruguay):\n${formatBusinessHours(s)}`,
    s.extraInfo ? `Otra información:\n${s.extraInfo}` : "",
    ``,
    `# CATÁLOGO (única fuente válida de tratamientos y precios)`,
    items.length ? items.join("\n\n") : "(El catálogo está vacío: derivá toda consulta de precios o tratamientos.)",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Contexto que cambia en cada pedido: va después del breakpoint de caché. */
export function renderVolatileContext(opts: {
  now: Date;
  settings: Settings;
  contactName: string | null;
}): string {
  const open = isOpen(opts.settings, opts.now);
  const next = open ? null : nextOpening(opts.settings, opts.now);
  return [
    `# AHORA`,
    `Fecha y hora en Uruguay: ${localParts(opts.now).label} (${opts.now.toLocaleDateString("es-UY", { timeZone: "America/Montevideo" })})`,
    open
      ? `El centro está ABIERTO.`
      : `El centro está CERRADO. El equipo vuelve a responder ${next ?? "en el próximo horario de atención"}.`,
    `Nombre de la persona (perfil de WhatsApp): ${opts.contactName ?? "desconocido"}`,
  ].join("\n");
}
