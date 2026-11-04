// bulk republish: rebuild every activity's published columns from its raw
// inputs. dry run by default (computes everything, writes nothing).
//
//   npx tsx --env-file=.env.local scripts/republish-all.mts \
//     [--ids 1,2,3] [--force] [--stale-only false] [--legacy] [--concurrency 6] [--apply]
//
// before migrations 0002/0003 are applied (no activity_sources / activity_edits
// tables, no processing_version columns) the dry run synthesizes sources and
// edits from the legacy columns exactly like the 0003 backfill would, so it
// shows whether republish reproduces today's published output. --legacy forces
// that mode post-migration too. --apply needs the migrated schema.

import { asc, inArray } from "drizzle-orm";
import { neon } from "@neondatabase/serverless";
import { getDb } from "../src/lib/db";
import { activities, type ActivityRow } from "../src/lib/db/schema";
import { defaultDeps, loadRawBytes, republish, PROCESSING_VERSION, type RepublishDeps, type RepublishResult } from "../src/lib/republish";
import {
  emptySummary,
  legacyActivityColumns,
  legacyDeps,
  recordError,
  recordResult,
  toActivityRow,
  type LegacyActivityRow,
} from "../src/lib/republish-legacy";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const has = (name: string) => process.argv.includes(`--${name}`);

const apply = has("apply");
const staleOnly = (arg("stale-only") ?? "true") !== "false";
const force = has("force") || !staleOnly;
const forceLegacy = has("legacy");
const concurrency = Math.max(1, Number(arg("concurrency") ?? 6));
const idsArg = arg("ids");
const onlyIds = idsArg ? idsArg.split(",").map((s) => Number(s.trim())).filter(Number.isFinite) : null;

// ---------------------------------------------------------------------------
// schema detection (read-only)

const sql = neon(process.env.DATABASE_URL!);
const tableRows = await sql`
  select table_name from information_schema.tables
  where table_schema = 'public' and table_name in ('activity_sources', 'activity_edits', 'privacy_zones', 'raw_objects')`;
const colRows = await sql`
  select column_name from information_schema.columns
  where table_schema = 'public' and table_name = 'activities'
    and column_name in ('processing_version', 'published_inputs_hash', 'canonical_track_key')`;
const migrated = tableRows.length === 4 && colRows.length === 3;
const legacyMode = !migrated || forceLegacy;

if (apply && legacyMode) {
  console.error(
    migrated
      ? "--apply can't be combined with --legacy"
      : "--apply needs migrations 0002/0003 (v2 tables/columns are missing). run `npm run db:migrate` first."
  );
  process.exit(1);
}

console.log(
  `republish-all — ${apply ? "APPLY" : "dry run"}, ${legacyMode ? "legacy-synthesized sources/edits" : "v2 tables"}` +
    `, ${force ? "forced (all activities)" : "stale only"}, processing v${PROCESSING_VERSION}`
);
if (!migrated) {
  console.log(
    `  schema: v2 tables present ${tableRows.length}/4, activities v2 columns ${colRows.length}/3 — migrations 0002/0003 not applied yet`
  );
}
console.log(`  raw store: ${process.env.R2_RAW_BUCKET ? `R2_RAW_BUCKET=${process.env.R2_RAW_BUCKET}` : "not configured (legacy originals read from the public bucket)"}`);

// ---------------------------------------------------------------------------
// rows

const db = getDb();
const legacyCols = legacyActivityColumns();
const baseQuery = db.select(legacyCols).from(activities);
const legacyRows: LegacyActivityRow[] = await (onlyIds
  ? baseQuery.where(inArray(activities.id, onlyIds)).orderBy(asc(activities.id))
  : baseQuery.orderBy(asc(activities.id)));
const byId = new Map(legacyRows.map((r) => [r.id, r]));
const ids = onlyIds ?? legacyRows.map((r) => r.id);

let deps: RepublishDeps;
let currentRow: (id: number) => Promise<Partial<ActivityRow> | null>;
if (legacyMode) {
  deps = legacyDeps({ loadLegacyRow: async (id) => byId.get(id) ?? null, loadRaw: loadRawBytes });
  currentRow = async (id) => {
    const r = byId.get(id);
    return r ? toActivityRow(r) : null;
  };
} else {
  deps = defaultDeps();
  // results carry the new columns; the old ones are what's in the row now
  currentRow = (id) => deps.loadActivity(id);
}

console.log(`  activities: ${ids.length}${onlyIds ? " (from --ids)" : ""}\n`);

// ---------------------------------------------------------------------------
// run

const summary = emptySummary();
const bySource: Record<string, Record<string, number>> = {};
let done = 0;
const started = Date.now();

async function one(id: number): Promise<void> {
  try {
    // the "before" snapshot must be read before an applied republish rewrites it
    const before = await currentRow(id);
    const res: RepublishResult = await republish(id, { dryRun: !apply, force, deps });
    recordResult(summary, res, before);
    const source = byId.get(id)?.source ?? "?";
    const key = res.status === "would-publish" || res.status === "published" ? `${res.status}${res.changed.length ? " (changed)" : " (identical)"}` : res.status;
    bySource[source] ??= {};
    bySource[source][key] = (bySource[source][key] ?? 0) + 1;
  } catch (error) {
    recordError(summary, id, error);
  }
  done++;
  if (done % 25 === 0 || done === ids.length) {
    process.stdout.write(`  ${done}/${ids.length} (${Math.round((Date.now() - started) / 1000)}s)\r`);
  }
}

const queue = [...ids];
await Promise.all(
  Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    for (let id = queue.shift(); id !== undefined; id = queue.shift()) await one(id);
  })
);
console.log("");

// ---------------------------------------------------------------------------
// report

console.log("\nstatuses:");
for (const [k, v] of Object.entries(summary.statuses).sort()) console.log(`  ${k.padEnd(14)} ${v}`);
const rebuilt = summary.changedActivities + summary.unchangedActivities;
console.log(`\nrebuilt from a track: ${rebuilt} — identical to the current row: ${summary.unchangedActivities}, would change: ${summary.changedActivities}`);
if (Object.keys(summary.byTrackKind).length) {
  console.log(`  track sources: ${Object.entries(summary.byTrackKind).map(([k, v]) => `${k} ${v}`).join(", ")}`);
}

console.log("\nby legacy source:");
for (const [source, counts] of Object.entries(bySource).sort()) {
  console.log(`  ${source.padEnd(15)} ${Object.entries(counts).map(([k, v]) => `${k}: ${v}`).join(", ")}`);
}

const cols = Object.entries(summary.columns).sort((a, b) => b[1].count - a[1].count);
if (cols.length) {
  console.log("\ncolumns that would change:");
  for (const [col, { count, examples }] of cols) {
    console.log(`  ${col.padEnd(14)} ${count}`);
    for (const e of examples) console.log(`      #${e.id}: ${e.old} → ${e.new}`);
  }
} else if (rebuilt > 0) {
  console.log("\nno public column would change.");
}

if (summary.errors.length) {
  console.log(`\nerrors (${summary.errors.length}):`);
  for (const e of summary.errors.slice(0, 20)) console.log(`  #${e.id}: ${e.error}`);
  if (summary.errors.length > 20) console.log(`  … ${summary.errors.length - 20} more`);
}

if (apply) {
  const published = summary.statuses.published ?? 0;
  if (published > 0) {
    // cache.ts reads the redis env at import; only load it when it's needed
    const { invalidateCache } = await import("../src/lib/cache");
    await invalidateCache("activities_list", "activities_latest");
    console.log(`\npublished ${published}; invalidated activities_list, activities_latest`);
  }
} else {
  const flags = [onlyIds ? `--ids ${onlyIds.join(",")}` : "", force ? "--force" : ""].filter(Boolean).join(" ");
  console.log(
    `\ndry run: nothing written.${legacyMode && !migrated ? " apply requires migrations 0002/0003 first." : ""}\n` +
      `apply with:\n  npx tsx --env-file=.env.local scripts/republish-all.mts ${flags ? `${flags} ` : ""}--apply`
  );
}

process.exit(summary.errors.length ? 1 : 0);
