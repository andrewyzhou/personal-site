// raw store integrity audit. always read-only (selects, HEAD/GET/list only).
//
//   npx tsx --env-file=.env.local scripts/audit-raw-integrity.mts \
//     [--full] [--sample 20] [--recent-days 8] [--republish-check]
//
// checks: every raw_objects row's object exists with the manifest size (HEAD);
// a re-hash of every object created in the last --recent-days plus a random
// --sample of the rest (--full: everything); activity_sources pointing at shas
// with no manifest row (dangling); keys under sha256/ with no manifest row
// (orphans); legacy public-bucket originals vs activities.fit_sha256; and with
// --republish-check, activities whose published inputs hash is stale.
// exits 1 on any failure. missing tables / bucket config are reported and
// skipped, so it runs (mostly as a legacy check) before the v2 migrations.

import { neon } from "@neondatabase/serverless";
import { r2BucketList, r2Get, r2Head } from "../src/lib/r2";
import { r2RawBackend, RAW_KEY_PREFIX } from "../src/lib/raw-store";
import {
  compareContent,
  compareHead,
  compareLegacyOriginal,
  findDangling,
  findOrphans,
  selectForRehash,
  summarizeFindings,
  type Finding,
  type ManifestEntry,
} from "../src/lib/raw-audit";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const has = (name: string) => process.argv.includes(`--${name}`);

const full = has("full");
const sample = Number(arg("sample") ?? 20);
const recentDays = Number(arg("recent-days") ?? 8);
const republishCheck = has("republish-check");
const CONCURRENCY = 8;

const findings: Finding[] = [];
const notes: string[] = [];
const push = (f: Finding | null) => {
  if (f) findings.push(f);
};

async function pool<T>(items: T[], fn: (item: T) => Promise<void>): Promise<void> {
  const queue = [...items];
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
      for (let item = queue.shift(); item !== undefined; item = queue.shift()) await fn(item);
    })
  );
}

const sql = neon(process.env.DATABASE_URL!);
const tables = new Set(
  (await sql`
    select table_name from information_schema.tables
    where table_schema = 'public' and table_name in ('raw_objects', 'activity_sources', 'activity_edits', 'privacy_zones')`).map(
    (r) => r.table_name as string
  )
);
const v2Cols = (await sql`
  select column_name from information_schema.columns
  where table_schema = 'public' and table_name = 'activities'
    and column_name in ('processing_version', 'published_inputs_hash', 'canonical_track_key')`).length;
const migrated = tables.size === 4 && v2Cols === 3;
const rawBucket = process.env.R2_RAW_BUCKET ?? null;

console.log(`audit-raw-integrity — read-only, ${full ? "full re-hash" : `re-hash sample ${sample} + last ${recentDays} days`}`);
console.log(`  schema: ${migrated ? "v2 migrated" : `v2 tables not present yet (${tables.size}/4 tables, ${v2Cols}/3 activities columns)`}`);
console.log(`  raw bucket: ${rawBucket ?? "R2_RAW_BUCKET not set"}`);

// ---------------------------------------------------------------------------
// legacy originals in the public bucket (until migrate-originals-private)

const legacy = (await sql`
  select id, fit_blob_pathname, fit_sha256, created_at from activities
  where fit_blob_pathname is not null and fit_sha256 is not null order by id`).map((r) => ({
  id: Number(r.id),
  fitBlobPathname: r.fit_blob_pathname as string,
  fitSha256: r.fit_sha256 as string,
  createdAt: new Date(r.created_at as string),
}));
const legacyRehash = new Set(selectForRehash(legacy, { full, sample, recentDays }).map((r) => r.id));
let legacyHashed = 0;
await pool(legacy, async (row) => {
  try {
    if (legacyRehash.has(row.id)) {
      let bytes: Uint8Array | null = null;
      try {
        bytes = await r2Get(row.fitBlobPathname);
      } catch (error) {
        if (!/ 404 /.test((error as Error).message)) throw error;
      }
      legacyHashed++;
      push(compareLegacyOriginal(row, { exists: bytes !== null, bytes }));
    } else {
      push(compareLegacyOriginal(row, { exists: await r2Head(row.fitBlobPathname) }));
    }
  } catch (error) {
    findings.push({ severity: "failure", check: "legacy-original", subject: `activity ${row.id}`, detail: (error as Error).message });
  }
});
console.log(`  legacy originals: ${legacy.length} checked (${legacy.length - legacyHashed} HEAD, ${legacyHashed} GET + re-hash)`);

// ---------------------------------------------------------------------------
// raw store manifest vs bucket

let manifest: ManifestEntry[] = [];
if (tables.has("raw_objects")) {
  manifest = (await sql`select sha256, key, size_bytes, created_at from raw_objects order by created_at`).map((r) => ({
    sha256: r.sha256 as string,
    key: r.key as string,
    sizeBytes: Number(r.size_bytes),
    createdAt: new Date(r.created_at as string),
  }));
} else {
  notes.push("raw_objects table not present yet: manifest checks skipped");
}

let backend: ReturnType<typeof r2RawBackend> | null = null;
if (rawBucket) {
  if (rawBucket === process.env.R2_BUCKET) {
    findings.push({ severity: "failure", check: "config", subject: "R2_RAW_BUCKET", detail: "is the public bucket" });
  } else {
    backend = r2RawBackend(rawBucket);
  }
} else {
  notes.push("R2_RAW_BUCKET not set: object HEAD/re-hash and orphan checks skipped");
}

if (backend && manifest.length) {
  const rehash = new Set(selectForRehash(manifest, { full, sample, recentDays }).map((r) => r.sha256));
  let hashed = 0;
  await pool(manifest, async (row) => {
    try {
      const head = await backend!.head(row.key);
      const headFinding = compareHead(row, head);
      push(headFinding);
      if (!headFinding && rehash.has(row.sha256)) {
        hashed++;
        push(compareContent(row, await backend!.get(row.key)));
      }
    } catch (error) {
      findings.push({ severity: "failure", check: "head", subject: row.sha256, detail: (error as Error).message });
    }
  });
  console.log(`  raw objects: ${manifest.length} HEAD-checked, ${hashed} re-hashed`);
} else if (manifest.length) {
  console.log(`  raw objects: ${manifest.length} manifest rows (bucket not configured, not checked)`);
}

if (backend && rawBucket) {
  const keys = await r2BucketList(rawBucket, RAW_KEY_PREFIX);
  const orphanFindings = findOrphans(keys, new Set(manifest.map((m) => m.key)));
  findings.push(...orphanFindings);
  console.log(`  bucket keys under ${RAW_KEY_PREFIX}: ${keys.length}, orphans ${orphanFindings.length}`);
}

// ---------------------------------------------------------------------------
// dangling sources

if (tables.has("activity_sources")) {
  const sources = (await sql`
    select s.id, s.activity_id, s.kind, s.raw_sha256, a.fit_sha256
    from activity_sources s join activities a on a.id = s.activity_id
    where s.raw_sha256 is not null`).map((r) => ({
    id: Number(r.id),
    activityId: Number(r.activity_id),
    kind: r.kind as string,
    rawSha256: r.raw_sha256 as string,
    legacyFitSha256: r.fit_sha256 as string | null,
  }));
  const dangling = findDangling(sources, new Set(manifest.map((m) => m.sha256)));
  findings.push(...dangling);
  console.log(`  activity sources with raw: ${sources.length}, dangling ${dangling.length}`);
} else {
  notes.push("activity_sources table not present yet: dangling-source check skipped");
}

// ---------------------------------------------------------------------------
// stale published hashes

if (republishCheck) {
  if (!migrated) {
    notes.push("--republish-check skipped: needs the v2 schema (use scripts/republish-all.mts for the legacy dry run)");
  } else {
    const { republish } = await import("../src/lib/republish");
    const ids = (await sql`select id from activities order by id`).map((r) => Number(r.id));
    const statuses: Record<string, number> = {};
    await pool(ids, async (id) => {
      try {
        const res = await republish(id, { dryRun: true });
        statuses[res.status] = (statuses[res.status] ?? 0) + 1;
        if (res.status === "would-publish") {
          findings.push({
            severity: "warning",
            check: "stale",
            subject: `activity ${id}`,
            detail: res.changed.length ? `would change ${res.changed.join(", ")}` : "inputs hash stale (output identical)",
          });
        }
      } catch (error) {
        findings.push({ severity: "failure", check: "republish", subject: `activity ${id}`, detail: (error as Error).message });
      }
    });
    console.log(`  republish check: ${Object.entries(statuses).map(([k, v]) => `${k} ${v}`).join(", ")}`);
  }
}

// ---------------------------------------------------------------------------
// report

for (const n of notes) console.log(`  note: ${n}`);
const s = summarizeFindings(findings);
console.log(`\n${s.failures} failure(s), ${s.warnings} warning(s)`);
for (const [check, c] of Object.entries(s.byCheck)) console.log(`  ${check.padEnd(16)} failures ${c.failures}, warnings ${c.warnings}`);
const show = [...findings].sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "failure" ? -1 : 1));
for (const f of show.slice(0, 40)) console.log(`  ${f.severity === "failure" ? "FAIL" : "warn"} [${f.check}] ${f.subject}: ${f.detail}`);
if (show.length > 40) console.log(`  … ${show.length - 40} more`);
process.exit(s.failures ? 1 : 0);
