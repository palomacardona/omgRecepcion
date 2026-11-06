/**
 * Aplica las migraciones de drizzle/ a la base. Corre en cada build de Vercel (ver "build" en package.json),
 * que es donde está DATABASE_URL. Sin DATABASE_URL (build local) se saltea.
 */
import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { migrate } from "drizzle-orm/neon-serverless/migrator";

// Para migraciones conviene la conexión directa (sin pooler) si Neon la provee.
const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;

if (!url) {
  console.warn("[migrate] Sin DATABASE_URL: no se aplican migraciones.");
  process.exit(0);
}

const pool = new Pool({ connectionString: url });
try {
  await migrate(drizzle(pool), { migrationsFolder: "./drizzle" });
  console.log("[migrate] Migraciones aplicadas.");
} catch (err) {
  console.error("[migrate] Falló:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await pool.end();
}
