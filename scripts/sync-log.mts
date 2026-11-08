// read the sync log (sync_events): one line per event, oldest first.
//
//   npx tsx --env-file=.env.local scripts/sync-log.mts [--tail 50] [--run <id>] [--activity <id>]
//       [--source intervals] [--kind update_field] [--since 2d]
//
// --run takes a full run id or its first 8 characters (as printed). read-only.

import { and, desc, eq, gte, like, type SQL } from "drizzle-orm";
import { getDb, syncEvents } from "../src/lib/db";
import { formatEvent, parseSince } from "../src/lib/sync-log";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const tail = Number(arg("tail") ?? 50);
if (!(tail > 0)) {
  console.error("--tail must be a positive number");
  process.exit(1);
}
const where: SQL[] = [];
const run = arg("run");
if (run) where.push(run.length >= 36 ? eq(syncEvents.runId, run) : like(syncEvents.runId, `${run}%`));
const activity = arg("activity");
if (activity) where.push(eq(syncEvents.activityId, Number(activity)));
const source = arg("source");
if (source) where.push(eq(syncEvents.source, source));
const kind = arg("kind");
if (kind) where.push(eq(syncEvents.kind, kind));
const since = arg("since");
if (since) {
  const at = parseSince(since);
  if (!at) {
    console.error(`--since: can't read "${since}" (try 2d, 6h, 30m or an iso date)`);
    process.exit(1);
  }
  where.push(gte(syncEvents.at, at));
}

const rows = await getDb()
  .select()
  .from(syncEvents)
  .where(where.length ? and(...where) : undefined)
  .orderBy(desc(syncEvents.at), desc(syncEvents.id))
  .limit(tail);

for (const r of rows.reverse()) console.log(formatEvent(r));
if (rows.length === 0) console.log("no events");
