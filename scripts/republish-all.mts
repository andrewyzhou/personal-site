// bulk republish: rebuild every activity's published columns from its raw
// inputs. dry run by default (computes everything, writes nothing).
//
//   npx tsx --env-file=.env.local scripts/republish-all.mts \
//     [--ids 1,2,3] [--force] [--stale-only false] [--legacy] [--concurrency 6] [--apply]
//
// the dry run works against a database that's behind the schema: it selects
// only the activities columns that exist (the rest read as defaults: visible,
// no fog, never republished), reads the real activity_sources / activity_edits
// / privacy_zones tables when they exist, uses default privacy settings when
// privacy_settings is missing and no photos when the photo exif columns are.
// before 0002 (no sources/edits tables) it synthesizes sources and edits from
// the legacy columns exactly like the 0003 backfill would; --legacy forces
// that. the dry run never writes (its deps throw on any write). --apply needs
// the fully migrated schema.

import { asc, inArray, isNull } from "drizzle-orm";
import { neon } from "@neondatabase/serverless";
import { getDb } from "../src/lib/db";
import { activities, activityEdits, activityPhotos, activitySources, privacyZones, type ActivityRow } from "../src/lib/db/schema";
import {
  defaultDeps,
  loadRawBytes,
  republish,
  PROCESSING_VERSION,
  type EditInput,
  type PhotoInput,
  type RepublishDeps,
  type RepublishResult,
  type SourceInput,
  type ZoneInput,
} from "../src/lib/republish";
import {
  emptySummary,
  fillActivityRow,
  legacyDeps,
  missingActivityColumns,
  presentActivityColumns,
  readOnlyDeps,
  recordError,
  recordResult,
  type LegacyActivityRow,
} from "../src/lib/republish-legacy";
import { DEFAULT_PRIVACY_SETTINGS, loadPrivacySettings } from "../src/lib/privacy/settings";
import { isValidPolygon } from "../src/lib/privacy/fog";
import type { PrivacySettings } from "../src/lib/db/schema";

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
const tables = new Set(
  (
    await sql`
      select table_name from information_schema.tables
      where table_schema = 'public'
        and table_name in ('activity_sources', 'activity_edits', 'privacy_zones', 'privacy_settings', 'raw_objects', 'activity_photos', 'activity_suggestions', 'activity_settings')`
  ).map((r) => r.table_name as string)
);
const columnsOf = async (table: string) =>
  new Set(
    (
      await sql`
        select column_name from information_schema.columns
        where table_schema = 'public' and table_name = ${table}`
    ).map((r) => r.column_name as string)
  );
const activityCols = await columnsOf("activities");
const zoneCols = await columnsOf("privacy_zones");
const photoCols = await columnsOf("activity_photos");

const missingCols = missingActivityColumns(activityCols);
const v2Tables = tables.has("activity_sources") && tables.has("activity_edits");
const legacyMode = !v2Tables || forceLegacy;
const hasArchived = zoneCols.has("archived_at");
const hasPhotoExif = ["taken_at", "gps_lat", "gps_lng"].every((c) => photoCols.has(c));
const fullyMigrated =
  missingCols.length === 0 &&
  ["activity_sources", "activity_edits", "privacy_zones", "privacy_settings", "raw_objects", "activity_suggestions", "activity_settings"].every((t) => tables.has(t)) &&
  hasArchived &&
  ["taken_at", "gps_lat", "gps_lng", "pin_lat", "pin_lng"].every((c) => photoCols.has(c));

if (apply && (legacyMode || !fullyMigrated)) {
  console.error(
    forceLegacy
      ? "--apply can't be combined with --legacy"
      : "--apply needs the fully migrated schema (through 0007). run `npm run db:migrate` first."
  );
  process.exit(1);
}

console.log(
  `republish-all — ${apply ? "APPLY" : "dry run (read-only)"}, ${legacyMode ? "legacy-synthesized sources/edits" : "v2 tables"}` +
    `, ${force ? "forced (all activities)" : "stale only"}, processing v${PROCESSING_VERSION}`
);
if (missingCols.length) {
  console.log(`  schema: activities is missing ${missingCols.length} column(s) (read as defaults): ${missingCols.join(", ")}`);
}
const absent = ["activity_sources", "activity_edits", "privacy_zones", "privacy_settings", "raw_objects"].filter((t) => !tables.has(t));
if (absent.length) console.log(`  schema: missing tables: ${absent.join(", ")}`);
if (tables.has("privacy_zones") && !hasArchived) console.log("  schema: privacy_zones has no archived_at (every enabled zone counts)");
if (!hasPhotoExif) console.log("  schema: activity_photos has no exif columns: photos are ignored (no pins)");
console.log(`  raw store: ${process.env.R2_RAW_BUCKET ? `R2_RAW_BUCKET=${process.env.R2_RAW_BUCKET}` : "not configured (legacy originals read from the public bucket)"}`);

// ---------------------------------------------------------------------------
// inputs (all selects)

const db = getDb();
const cols = presentActivityColumns(activityCols);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const baseQuery = db.select(cols as any).from(activities);
const rawRows = (await (onlyIds
  ? baseQuery.where(inArray(activities.id, onlyIds)).orderBy(asc(activities.id))
  : baseQuery.orderBy(asc(activities.id)))) as unknown as LegacyActivityRow[];
const rows = new Map<number, ActivityRow>(rawRows.map((r) => [r.id, fillActivityRow(r)]));
const legacyById = new Map(rawRows.map((r) => [r.id, r]));
const ids = onlyIds ?? rawRows.map((r) => r.id);
const stale = [...rows.values()].filter((r) => r.processingVersion !== PROCESSING_VERSION).length;

let zones: ZoneInput[] = [];
let zoneNote = "privacy_zones missing: none";
if (tables.has("privacy_zones")) {
  const zoneRows = await db
    .select({
      id: privacyZones.id,
      polygon: privacyZones.polygon,
      enabled: privacyZones.enabled,
      ...(hasArchived ? { archivedAt: privacyZones.archivedAt } : {}),
    })
    .from(privacyZones)
    .orderBy(asc(privacyZones.id));
  const active = zoneRows.filter((z) => z.enabled && !("archivedAt" in z && z.archivedAt));
  const invalid = active.filter((z) => !isValidPolygon(z.polygon));
  zones = active.filter((z) => isValidPolygon(z.polygon)).map((z) => ({ id: z.id, polygon: z.polygon }));
  zoneNote = `${zones.length} enabled${hasArchived ? ", non-archived" : ""} (of ${zoneRows.length} rows)${invalid.length ? `, ${invalid.length} invalid polygon(s) skipped` : ""}`;
}

let settings: PrivacySettings = DEFAULT_PRIVACY_SETTINGS;
let settingsNote = "privacy_settings missing: defaults";
if (tables.has("privacy_settings")) {
  settings = await loadPrivacySettings();
  settingsNote = "latest privacy_settings row (or defaults)";
}

const sourcesById = new Map<number, SourceInput[]>();
const editsById = new Map<number, EditInput[]>();
if (!legacyMode) {
  const sourceRows = await db
    .select({
      activityId: activitySources.activityId,
      id: activitySources.id,
      kind: activitySources.kind,
      provider: activitySources.provider,
      externalId: activitySources.externalId,
      rawSha256: activitySources.rawSha256,
    })
    .from(activitySources)
    .orderBy(asc(activitySources.id));
  for (const { activityId, ...s } of sourceRows) {
    if (!sourcesById.has(activityId)) sourcesById.set(activityId, []);
    sourcesById.get(activityId)!.push(s);
  }
  const editRows = await db
    .select({ activityId: activityEdits.activityId, id: activityEdits.id, kind: activityEdits.kind, params: activityEdits.params })
    .from(activityEdits)
    .where(isNull(activityEdits.revertedAt))
    .orderBy(asc(activityEdits.id));
  for (const { activityId, ...e } of editRows) {
    if (!editsById.has(activityId)) editsById.set(activityId, []);
    editsById.get(activityId)!.push(e);
  }
}

const photosById = new Map<number, PhotoInput[]>();
if (hasPhotoExif) {
  const photoRows = await db
    .select({
      activityId: activityPhotos.activityId,
      id: activityPhotos.id,
      takenAt: activityPhotos.takenAt,
      gpsLat: activityPhotos.gpsLat,
      gpsLng: activityPhotos.gpsLng,
    })
    .from(activityPhotos)
    .orderBy(asc(activityPhotos.id));
  for (const { activityId, ...p } of photoRows) {
    if (!photosById.has(activityId)) photosById.set(activityId, []);
    photosById.get(activityId)!.push(p);
  }
}

let deps: RepublishDeps;
if (apply) {
  deps = defaultDeps();
} else if (legacyMode) {
  deps = legacyDeps({ loadLegacyRow: async (id) => legacyById.get(id) ?? null, loadRaw: loadRawBytes, zones });
} else {
  deps = readOnlyDeps({
    loadRow: async (id) => rows.get(id) ?? null,
    loadSources: async (id) => sourcesById.get(id) ?? [],
    loadEdits: async (id) => editsById.get(id) ?? [],
    loadRaw: loadRawBytes,
    zones,
    settings,
    loadPhotos: async (id) => photosById.get(id) ?? [],
  });
}

console.log(`  zones: ${zoneNote}`);
console.log(`  settings: ${settingsNote} → ${JSON.stringify(settings)}`);
console.log(`  photos: ${hasPhotoExif ? `${[...photosById.values()].reduce((n, p) => n + p.length, 0)} with exif columns` : "ignored"}`);
console.log(`  activities: ${ids.length}${onlyIds ? " (from --ids)" : ""}; not at processing v${PROCESSING_VERSION} (stale): ${stale}\n`);

// ---------------------------------------------------------------------------
// run

const summary = emptySummary();
const bySource: Record<string, Record<string, number>> = {};
let pinned = 0;
let fogged = 0;
let done = 0;
const started = Date.now();

async function one(id: number): Promise<void> {
  try {
    // the "before" snapshot must be read before an applied republish rewrites it
    const before = rows.get(id) ?? null;
    const res: RepublishResult = await republish(id, { dryRun: !apply, force, deps });
    recordResult(summary, res, before);
    if (res.status === "would-publish" || res.status === "published") {
      pinned += res.pins.filter((p) => p.pinLat !== null).length;
      if (res.columns.fogEvents?.length) fogged++;
    }
    const source = before?.source ?? "?";
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
for (const [k, v] of Object.entries(summary.statuses).sort()) console.log(`  ${k.padEnd(18)} ${v}`);
const rebuilt = summary.changedActivities + summary.unchangedActivities;
console.log(`\nrebuilt from a track: ${rebuilt} — identical to the current row: ${summary.unchangedActivities}, would change: ${summary.changedActivities}`);
if (Object.keys(summary.byTrackKind).length) {
  console.log(`  track sources: ${Object.entries(summary.byTrackKind).map(([k, v]) => `${k} ${v}`).join(", ")}`);
}
console.log(`  fogged by zones: ${fogged}; photos that would get a pin: ${pinned}`);

console.log("\nby legacy source:");
for (const [source, counts] of Object.entries(bySource).sort()) {
  console.log(`  ${source.padEnd(15)} ${Object.entries(counts).map(([k, v]) => `${k}: ${v}`).join(", ")}`);
}

const changedCols = Object.entries(summary.columns).sort((a, b) => b[1].count - a[1].count);
if (changedCols.length) {
  console.log("\ncolumns that would change:");
  for (const [col, { count, examples }] of changedCols) {
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
    `\ndry run: nothing written.${fullyMigrated ? "" : " apply requires the fully migrated schema (through 0007) first."}\n` +
      `apply with:\n  npx tsx --env-file=.env.local scripts/republish-all.mts ${flags ? `${flags} ` : ""}--apply`
  );
}

process.exit(summary.errors.length ? 1 : 0);
