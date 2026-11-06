import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import * as schema from "./schema";

// Pool por instancia de función (driver serverless de Neon: WebSocket, soporta transacciones).
let _db: ReturnType<typeof makeDb> | undefined;

function makeDb() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("Falta DATABASE_URL");
  return drizzle(new Pool({ connectionString: url }), { schema });
}

export function db() {
  if (!_db) _db = makeDb();
  return _db;
}

/** Solo para tests: inyecta otra instancia de Drizzle (p. ej. PGlite en memoria). */
export function __setDbForTests(instance: unknown) {
  _db = instance as ReturnType<typeof makeDb>;
}

export type Db = ReturnType<typeof db>;
export { schema };
