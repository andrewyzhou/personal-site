import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

// http driver: no tcp pools, works identically in vercel functions and local
// scripts. single-statement only — no interactive transactions anywhere in ws2.
function createDb() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set");
  }
  return drizzle(neon(url), { schema });
}

// lazy singleton so importing this module without DATABASE_URL (e.g. in tests
// that mock it) doesn't throw at load time
let _db: ReturnType<typeof createDb> | null = null;

export function getDb() {
  if (!_db) {
    _db = createDb();
  }
  return _db;
}

export * from "./schema";
