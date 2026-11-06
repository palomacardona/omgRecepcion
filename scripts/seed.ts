/**
 * Inicializa la configuración por defecto (si no existe).
 * Uso: npm run db:seed            → solo settings
 *      npm run db:seed -- --demo  → además carga tratamientos de EJEMPLO (para el sandbox de Meta)
 */
import { db } from "../src/db";
import { catalog, settings } from "../src/db/schema";
import { DEFAULT_SETTINGS } from "../src/lib/settings";

const demo = process.argv.includes("--demo");

await db().insert(settings).values({ key: "main", value: DEFAULT_SETTINGS }).onConflictDoNothing();
console.log("✓ settings por defecto (si no existían)");

if (demo) {
  await db()
    .insert(catalog)
    .values([
      {
        name: "EJEMPLO Limpieza facial profunda",
        category: "Facial",
        description: "Limpieza con extracción, exfoliación y máscara según tipo de piel.",
        durationMinutes: 60,
        price: "$ 0 (EJEMPLO: reemplazar)",
        preparation: "Venir sin maquillaje. No exponerse al sol 48 h después.",
        contraindications: "Lesiones activas, herpes, tratamientos con isotretinoína.",
      },
      {
        name: "EJEMPLO Depilación láser axilas",
        category: "Depilación",
        description: "Sesión de depilación láser.",
        durationMinutes: 20,
        price: "$ 0 (EJEMPLO: reemplazar)",
        preparation: "Rasurar 24 h antes. No usar cera ni pinza en las 4 semanas previas.",
        contraindications: "Embarazo, piel bronceada reciente, medicación fotosensibilizante.",
      },
    ]);
  console.log("✓ catálogo de ejemplo (acordate de reemplazarlo desde el panel)");
}
process.exit(0);
