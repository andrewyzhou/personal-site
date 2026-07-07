// quick connectivity/schema check: npx tsx --env-file=.env.local scripts/db-check.mts
import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL!);
const tables = await sql`select table_name from information_schema.tables where table_schema='public' order by 1`;
console.log("tables:", tables.map((x) => x.table_name).join(", "));
const count = await sql`select count(*)::int as n from activities`;
console.log("activities rows:", count[0].n);
