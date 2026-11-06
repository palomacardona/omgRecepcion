import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { __setDbForTests } from "@/db";
import * as schema from "@/db/schema";

/** Postgres en memoria con las migraciones reales del proyecto. */
export async function setupTestDb() {
  const client = new PGlite();
  const d = drizzle(client, { schema });
  await migrate(d, { migrationsFolder: "./drizzle" });
  __setDbForTests(d);
  return d;
}
