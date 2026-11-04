import { openDatabaseSync } from "expo-sqlite";
// the driver subpath, not "drizzle-orm/expo-sqlite": that index also pulls in
// useLiveQuery, which imports react from drizzle's (hoisted) location and would
// resolve the site's react instead of the app's
import { drizzle } from "drizzle-orm/expo-sqlite/driver";
import * as schema from "./schema";

// opened once per js runtime; every repository shares this connection so the
// per-connection pragmas (foreign_keys) set in migrate() apply everywhere
export const sqlite = openDatabaseSync("lift.db");

export const db = drizzle(sqlite, { schema });

export type Db = typeof db;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
