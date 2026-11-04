// raw ingest of a strava bulk export zip into the private raw store, then
// attach the activity originals as device-file sources.
//
//   npx tsx --env-file=.env.local scripts/import-strava-export.mts \
//     [--zip ~/Downloads/export_161887324.zip] [--apply] [--republish] [--verbose]
//
// dry run by default (reads the zip + neon, writes nothing). --apply stores
// every file in the zip byte-for-byte (write-once, content-addressed) plus one
// manifest object, and adds device-file sources pointing at the exact archive
// bytes (the .gz container, not unwrapped). --republish (with --apply) rebuilds
// each activity that gained a source. idempotent: re-runs are no-ops.

import fs from "node:fs";
import { unzipSync } from "fflate";
import { parse as parseCsv } from "csv-parse/sync";
import { and, eq, sql } from "drizzle-orm";
import { getDb } from "../src/lib/db";
import { activities, activitySources } from "../src/lib/db/schema";
import { getRawStore, isRawStoreConfigured, sha256Hex } from "../src/lib/raw-store";
import { addActivitySource } from "../src/lib/activity-sources";
import { legacyProvider } from "../src/lib/legacy-sources";
import { parseTrackFile, unwrapTrackFile } from "../src/lib/fit";
import {
  buildExportManifest,
  classifyExportEntry,
  csvActivityRefs,
  deviceFileKey,
  exportName,
  planAttachments,
  stravaIdsNotInCsv,
  type ExportManifestEntry,
} from "../src/lib/strava-export";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const has = (name: string) => process.argv.includes(`--${name}`);

const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
const zipPath = (arg("zip") ?? `${home}/Downloads/export_161887324.zip`).replace(/^~/, home);
const apply = has("apply");
const doRepublish = has("republish");
const verbose = has("verbose");

if (doRepublish && !apply) {
  console.error("--republish only runs with --apply");
  process.exit(1);
}

const name = exportName(zipPath);
console.log(`export: ${zipPath} (${name})${apply ? "" : " — dry run, nothing is written"}`);

// ---------------------------------------------------------------------------
// zip

const zip = unzipSync(new Uint8Array(fs.readFileSync(zipPath)));

interface Entry extends ExportManifestEntry {
  bytes: Uint8Array;
  contentType: string;
}
const entries: Entry[] = [];
for (const [path, bytes] of Object.entries(zip)) {
  const cls = classifyExportEntry(path);
  if (!cls) continue;
  entries.push({ path, bytes, sha256: sha256Hex(bytes), size: bytes.length, kind: cls.kind, contentType: cls.contentType });
}
const { manifest, bytes: manifestBytes } = buildExportManifest(name, entries);
const manifestSha = sha256Hex(manifestBytes);
const kindCounts = new Map<string, number>();
for (const e of entries) kindCounts.set(e.kind, (kindCounts.get(e.kind) ?? 0) + 1);
const distinctShas = new Set(entries.map((e) => e.sha256));
console.log(
  `zip: ${entries.length} files, ${(manifest.totalBytes / 1e6).toFixed(1)} MB, ${distinctShas.size} distinct objects ` +
    `(${[...kindCounts].map(([k, n]) => `${k} ${n}`).join(", ")}); manifest ${manifestSha.slice(0, 12)}…`
);

const csvEntry = zip["activities.csv"];
if (!csvEntry) throw new Error("zip has no activities.csv");
const refs = csvActivityRefs(parseCsv(Buffer.from(csvEntry), { relax_column_count: true }) as string[][]);
console.log(`activities.csv: ${refs.length} rows, ${refs.filter((r) => r.filename).length} with a Filename`);

// ---------------------------------------------------------------------------
// neon (select only in dry runs)

const db = getDb();
const tableRows = await db.execute(sql`
  select table_name from information_schema.tables
  where table_schema = 'public' and table_name in ('raw_objects', 'activity_sources')
`);
const tables = new Set((tableRows.rows as { table_name: string }[]).map((r) => r.table_name));
const sourcesTable = tables.has("activity_sources");
const rawTable = tables.has("raw_objects");
if (!sourcesTable) console.log("note: activity_sources does not exist yet (migrations 0002/0003 unapplied) — treating it as empty");
if (!rawTable) console.log("note: raw_objects does not exist yet — treating the manifest as empty");

const dbRows = await db
  .select({ id: activities.id, source: activities.source, externalId: activities.externalId, fitSha256: activities.fitSha256 })
  .from(activities);
const byId = new Map(dbRows.map((r) => [r.id, r]));

const byLegacy = new Map<string, number>();
for (const r of dbRows) if (r.externalId && legacyProvider(r.source) === "strava") byLegacy.set(r.externalId, r.id);

const bySource = new Map<string, number>();
const existingDeviceFiles = new Set<string>();
if (sourcesTable) {
  const srcRows = await db
    .select({ activityId: activitySources.activityId, externalId: activitySources.externalId, kind: activitySources.kind, rawSha256: activitySources.rawSha256 })
    .from(activitySources)
    .where(eq(activitySources.provider, "strava"));
  for (const s of srcRows) {
    if (s.externalId && !bySource.has(s.externalId)) bySource.set(s.externalId, s.activityId);
    if (s.kind === "device-file" && s.rawSha256) existingDeviceFiles.add(deviceFileKey(s.activityId, s.rawSha256));
  }
}

const plan = planAttachments(refs, {
  bySource,
  byLegacy,
  entryShas: new Map(entries.map((e) => [e.path, e.sha256])),
  existingDeviceFiles,
});

// strava exports indoor/manual activities as empty gpx shells; a device-file
// source that can't produce a track would only make republish fail, so those
// stay raw-only (still stored, just not linked)
const entryByPath = new Map(entries.map((e) => [e.path, e]));
const trackless = new Set<string>();
// sanity: an export copy of a legacy original unwraps to the same bytes
let legacySame = 0;
const legacyDiffer: string[] = [];
for (const item of plan.attach) {
  const bytes = entryByPath.get(item.path)!.bytes;
  try {
    parseTrackFile(bytes, item.path);
  } catch (error) {
    trackless.add(item.path);
    if (verbose) console.log(`  ~ ${item.stravaId} ${item.path}: ${(error as Error).message}`);
  }
  const legacySha = byId.get(item.activityId)?.fitSha256;
  if (legacySha) {
    if (sha256Hex(unwrapTrackFile(bytes, item.path).bytes) === legacySha) legacySame++;
    else legacyDiffer.push(`${item.activityId} ${item.path}`);
  }
}
const linkable = plan.attach.filter((a) => !trackless.has(a.path));
const toAdd = linkable.filter((a) => !a.existing);

// ---------------------------------------------------------------------------
// report

const bySourceCategory = (items: { activityId: number }[]) => {
  const m = new Map<string, number>();
  for (const i of items) {
    const s = byId.get(i.activityId)?.source ?? "?";
    m.set(s, (m.get(s) ?? 0) + 1);
  }
  return [...m].map(([k, n]) => `${k} ${n}`).join(", ") || "none";
};

const apiRows = dbRows.filter((r) => r.source === "strava-api");
const apiFileless = apiRows.filter((r) => !r.fitSha256);
const apiGaining = new Set(linkable.filter((a) => apiFileless.some((r) => r.id === a.activityId)).map((a) => a.activityId));
const apiTrackless = new Set(
  plan.attach.filter((a) => trackless.has(a.path) && byId.get(a.activityId)?.source === "strava-api").map((a) => a.activityId)
);
const apiNoFile = plan.noFile.filter((r) => {
  const id = bySource.get(r.stravaId) ?? byLegacy.get(r.stravaId);
  return id !== undefined && byId.get(id)?.source === "strava-api";
});
const dbStravaIds = dbRows.filter((r) => r.externalId && legacyProvider(r.source) === "strava").map((r) => r.externalId!);
const notInCsv = stravaIdsNotInCsv(dbStravaIds, refs);

console.log("");
console.log(`matched csv rows with a file: ${plan.attach.length} (${bySourceCategory(plan.attach)})`);
console.log(`  via activity_sources ${plan.attach.filter((a) => a.via === "source").length}, via activities.external_id ${plan.attach.filter((a) => a.via === "legacy").length}`);
console.log(`  trackless shells (stored raw, not linked): ${trackless.size} (${bySourceCategory(plan.attach.filter((a) => trackless.has(a.path)))})`);
console.log(`  device-file sources to add: ${toAdd.length} (${bySourceCategory(toAdd)}), already present ${linkable.length - toAdd.length}`);
console.log(`strava-api rows: ${apiRows.length}, file-less ${apiFileless.length}; gaining an original: ${apiGaining.size}` +
  `, trackless shell ${apiTrackless.size}, csv row without file ${apiNoFile.length}`);
console.log(`export copies of legacy originals identical after unwrap: ${legacySame}/${legacySame + legacyDiffer.length}`);
for (const d of legacyDiffer) console.log(`  ! activity ${d} differs from the legacy original`);
console.log(`csv rows without a Filename (matched): ${plan.noFile.length}`);
console.log(`csv rows with a Filename missing from the zip: ${plan.missingFile.length}`);
for (const r of plan.missingFile) console.log(`  ! ${r.stravaId} ${r.filename}`);
console.log(`csv rows not in db: ${plan.notInDb.length}`);
for (const r of plan.notInDb) console.log(`  - ${r.stravaId} ${r.date} "${r.name}"`);
console.log(`db strava ids not in csv: ${notInCsv.length}`);
for (const id of notInCsv) {
  const row = dbRows.find((r) => r.externalId === id);
  console.log(`  - ${id} (activity ${row?.id}, ${row?.source})`);
}
if (verbose) for (const a of toAdd) console.log(`  + activity ${a.activityId} (${byId.get(a.activityId)?.source}) ← ${a.path} ${a.sha256.slice(0, 12)}…`);

// raw store state
let alreadyStored = 0;
if (isRawStoreConfigured()) {
  const store = getRawStore();
  for (const sha of distinctShas) if ((await store.head(sha)).exists) alreadyStored++;
  console.log(`raw store: ${alreadyStored}/${distinctShas.size} objects already present`);
} else {
  console.log(`raw store: R2_RAW_BUCKET not set — all ${distinctShas.size} objects + manifest would be uploaded`);
}

if (!apply) {
  console.log("\ndry run complete. to write:");
  console.log(`  npx tsx --env-file=.env.local scripts/import-strava-export.mts --zip "${zipPath}" --apply --republish`);
  process.exit(0);
}

// ---------------------------------------------------------------------------
// apply

if (!isRawStoreConfigured()) throw new Error("R2_RAW_BUCKET is not set; refusing to apply");
if (!sourcesTable || !rawTable) throw new Error("run migrations 0002/0003 before applying");

const store = getRawStore();
let created = 0;
for (const [i, e] of entries.entries()) {
  const put = await store.put(e.bytes, {
    kind: e.kind as "device-file" | "strava-export-file",
    contentType: e.contentType,
    filename: e.path.slice(e.path.lastIndexOf("/") + 1),
    metadata: { export: name, path: e.path },
    expectedSha256: e.sha256,
  });
  if (put.created) created++;
  if ((i + 1) % 50 === 0) console.log(`  stored ${i + 1}/${entries.length}`);
}
const mput = await store.put(manifestBytes, {
  kind: "strava-export-manifest",
  contentType: "application/json",
  filename: `${name}.manifest.json`,
  metadata: { export: name, fileCount: manifest.fileCount, totalBytes: manifest.totalBytes },
  expectedSha256: manifestSha,
});
console.log(`raw store: ${created} new objects, manifest ${mput.created ? "stored" : "already present"} (${mput.sha256})`);

const gained = new Set<number>();
for (const a of toAdd) {
  await addActivitySource({ activityId: a.activityId, provider: "strava", externalId: a.stravaId, kind: "device-file", rawSha256: a.sha256 });
  const check = await db
    .select({ id: activitySources.id })
    .from(activitySources)
    .where(and(eq(activitySources.activityId, a.activityId), eq(activitySources.kind, "device-file"), eq(activitySources.rawSha256, a.sha256)))
    .limit(1);
  if (check.length === 0) throw new Error(`source row for activity ${a.activityId} did not land`);
  gained.add(a.activityId);
}
console.log(`sources: ${gained.size} activities gained a device-file source`);

// every stored object must read back with the right hash
let bad = 0;
for (const sha of [...distinctShas, manifestSha]) {
  const v = await store.verify(sha);
  if (!v.ok) {
    bad++;
    console.error(`  ✗ ${sha}: ${v.reason}`);
  }
}
console.log(`verify: ${distinctShas.size + 1 - bad}/${distinctShas.size + 1} objects ok`);

if (doRepublish) {
  const { republish } = await import("../src/lib/republish");
  const counts = new Map<string, number>();
  for (const id of gained) {
    try {
      const res = await republish(id);
      counts.set(res.status, (counts.get(res.status) ?? 0) + 1);
    } catch (error) {
      counts.set("error", (counts.get("error") ?? 0) + 1);
      console.error(`  ✗ republish ${id}: ${(error as Error).message}`);
    }
  }
  console.log(`republish: ${[...counts].map(([k, n]) => `${k} ${n}`).join(", ") || "nothing to do"}`);
}
if (bad > 0) process.exit(1);
