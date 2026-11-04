// copy legacy originals (device files + photos) from the public bucket into the
// private raw store, and link them: a device-file activity_sources row per
// original, activity_photos.original_sha256 per photo.
//
//   npx tsx --env-file=.env.local scripts/migrate-originals-private.mts \
//     [--apply] [--verify] [--limit N] [--verbose]
//
// dry run by default: HEADs the public copies (and with --verify downloads and
// hashes them), writes nothing. --apply copies + links, then re-reads every
// copied object from the raw store. public objects are never modified or
// deleted. idempotent: raw puts are write-once, source inserts are
// conflict-do-nothing, original_sha256 is only set when null.

import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { getDb } from "../src/lib/db";
import { activities, activityPhotos, activitySources } from "../src/lib/db/schema";
import { getRawStore, isRawStoreConfigured, sha256Hex } from "../src/lib/raw-store";
import { addActivitySource } from "../src/lib/activity-sources";
import { basename, legacyContentType, legacyProvider } from "../src/lib/legacy-sources";
import { r2Get, r2Head } from "../src/lib/r2";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const has = (name: string) => process.argv.includes(`--${name}`);

const apply = has("apply");
const verify = has("verify");
const verbose = has("verbose");
const limit = Number(arg("limit") ?? Infinity);

console.log(`migrate originals → private raw store${apply ? "" : " — dry run, nothing is written"}${verify ? " (verifying public copies)" : ""}`);

const db = getDb();
const tableRows = await db.execute(sql`
  select table_name from information_schema.tables
  where table_schema = 'public' and table_name in ('raw_objects', 'activity_sources')
`);
const tables = new Set((tableRows.rows as { table_name: string }[]).map((r) => r.table_name));
const colRows = await db.execute(sql`
  select 1 from information_schema.columns
  where table_schema = 'public' and table_name = 'activity_photos' and column_name = 'original_sha256'
`);
const sourcesTable = tables.has("activity_sources");
const rawTable = tables.has("raw_objects");
const photoShaCol = colRows.rows.length > 0;
if (!sourcesTable) console.log("note: activity_sources does not exist yet (migrations 0002/0003 unapplied) — treating it as empty");
if (!rawTable) console.log("note: raw_objects does not exist yet — treating the manifest as empty");
if (!photoShaCol) console.log("note: activity_photos.original_sha256 does not exist yet — treating it as null");

const rawConfigured = isRawStoreConfigured();
if (!rawConfigured) console.log("note: R2_RAW_BUCKET not set — every object would be copied");
if (apply) {
  if (!rawConfigured) throw new Error("R2_RAW_BUCKET is not set; refusing to apply");
  if (!sourcesTable || !rawTable || !photoShaCol) throw new Error("run migrations 0002/0003 before applying");
}
const store = rawConfigured ? getRawStore() : null;

// ---------------------------------------------------------------------------
// load

const originals = (
  await db
    .select({
      id: activities.id,
      source: activities.source,
      externalId: activities.externalId,
      pathname: activities.fitBlobPathname,
      sha256: activities.fitSha256,
      fileType: activities.fileType,
    })
    .from(activities)
    .where(isNotNull(activities.fitBlobPathname))
    .orderBy(activities.id)
).slice(0, limit);

const photos = (
  await db
    .select({ id: activityPhotos.id, activityId: activityPhotos.activityId, pathname: activityPhotos.blobPathname })
    .from(activityPhotos)
    .orderBy(activityPhotos.id)
).slice(0, limit);

const photoShas = new Map<number, string | null>();
if (photoShaCol) {
  const rows = await db.execute(sql`select id, original_sha256 from activity_photos`);
  for (const r of rows.rows as { id: number | string; original_sha256: string | null }[]) photoShas.set(Number(r.id), r.original_sha256);
}

const existingSources = new Set<string>();
if (sourcesTable) {
  const rows = await db
    .select({ activityId: activitySources.activityId, provider: activitySources.provider, rawSha256: activitySources.rawSha256 })
    .from(activitySources)
    .where(eq(activitySources.kind, "device-file"));
  for (const r of rows) existingSources.add(`${r.activityId}:${r.provider}:${r.rawSha256}`);
}

console.log(`originals: ${originals.length} activities with fit_blob_pathname; photos: ${photos.length} activity_photos rows`);

// ---------------------------------------------------------------------------
// per item

interface Outcome {
  label: string;
  publicMissing?: boolean;
  mismatch?: string;
  rawPresent?: boolean;
  rawCreated?: boolean;
  linkNeeded?: boolean;
  error?: string;
}

const copied = new Set<string>(); // shas put (or confirmed) this run, re-verified at the end
const outcomes: { originals: Outcome[]; photos: Outcome[] } = { originals: [], photos: [] };

async function rawPresent(sha: string | null): Promise<boolean> {
  if (!store || !sha || !rawTable) return false;
  return (await store.head(sha)).exists;
}

for (const o of originals) {
  const out: Outcome = { label: `activity ${o.id} ${o.pathname}` };
  outcomes.originals.push(out);
  try {
    if (!o.sha256) throw new Error("fit_blob_pathname without fit_sha256");
    const provider = legacyProvider(o.source);
    out.linkNeeded = !existingSources.has(`${o.id}:${provider}:${o.sha256}`);
    out.rawPresent = await rawPresent(o.sha256);

    if (!apply && !verify) {
      if (!out.rawPresent && !(await r2Head(o.pathname!))) out.publicMissing = true;
    } else {
      let bytes: Uint8Array | null = null;
      if (!(apply && out.rawPresent)) {
        try {
          bytes = await r2Get(o.pathname!);
        } catch {
          out.publicMissing = true;
        }
        if (bytes) {
          const actual = sha256Hex(bytes);
          if (actual !== o.sha256) out.mismatch = `hashes to ${actual}, expected ${o.sha256}`;
        }
      }
      if (apply && !out.mismatch && !out.publicMissing) {
        if (bytes) {
          const put = await store!.put(bytes, {
            kind: "device-file",
            contentType: legacyContentType(o.fileType),
            filename: basename(o.pathname!),
            metadata: { legacyPathname: o.pathname, activityId: o.id },
            expectedSha256: o.sha256,
          });
          out.rawCreated = put.created;
        }
        copied.add(o.sha256);
        if (out.linkNeeded) {
          await addActivitySource({ activityId: o.id, provider, externalId: o.externalId, kind: "device-file", rawSha256: o.sha256 });
        }
      }
    }
  } catch (error) {
    out.error = (error as Error).message;
  }
  if (verbose || out.mismatch || out.error || out.publicMissing) {
    const status = out.error ? `error: ${out.error}` : out.mismatch ? `MISMATCH ${out.mismatch} (skipped)` : out.publicMissing ? "public copy missing (skipped)"
      : `${out.rawPresent ? "raw present" : apply ? (out.rawCreated ? "copied" : "copied (already there)") : "would copy"}${out.linkNeeded ? (apply ? ", linked" : ", would link source") : ", source present"}`;
    console.log(`  ${o.id} ${o.source} ${o.pathname}: ${status}`);
  }
}

for (const p of photos) {
  const out: Outcome = { label: `photo ${p.id} ${p.pathname}` };
  outcomes.photos.push(out);
  try {
    const known = photoShas.get(p.id) ?? null;
    out.linkNeeded = known === null;
    out.rawPresent = await rawPresent(known);
    if (!apply && !verify) {
      if (!out.rawPresent && !(await r2Head(p.pathname))) out.publicMissing = true;
    } else {
      let bytes: Uint8Array | null = null;
      if (!(apply && out.rawPresent)) {
        try {
          bytes = await r2Get(p.pathname);
        } catch {
          out.publicMissing = true;
        }
        // a recorded sha must match; otherwise the content-addressed filename
        // (strava archive imports) is the expectation when it looks like one
        const nameSha = basename(p.pathname).replace(/\.[^.]+$/, "");
        const expected = known ?? (/^[0-9a-f]{64}$/.test(nameSha) ? nameSha : null);
        if (bytes && expected) {
          const actual = sha256Hex(bytes);
          if (actual !== expected) out.mismatch = `hashes to ${actual}, expected ${expected}`;
        }
      }
      if (apply && !out.mismatch && !out.publicMissing) {
        let sha = known;
        if (bytes) {
          const put = await store!.put(bytes, {
            kind: "photo-original",
            contentType: /\.png$/i.test(p.pathname) ? "image/png" : /\.webp$/i.test(p.pathname) ? "image/webp" : "image/jpeg",
            filename: basename(p.pathname),
            metadata: { legacyPathname: p.pathname, activityId: p.activityId, photoId: p.id },
            expectedSha256: known ?? undefined,
          });
          out.rawCreated = put.created;
          sha = put.sha256;
        }
        copied.add(sha!);
        if (out.linkNeeded) {
          await db
            .update(activityPhotos)
            .set({ originalSha256: sha })
            .where(and(eq(activityPhotos.id, p.id), isNull(activityPhotos.originalSha256)));
        }
      }
    }
  } catch (error) {
    out.error = (error as Error).message;
  }
  if (verbose || out.mismatch || out.error || out.publicMissing) {
    const status = out.error ? `error: ${out.error}` : out.mismatch ? `MISMATCH ${out.mismatch} (skipped)` : out.publicMissing ? "public copy missing (skipped)"
      : `${out.rawPresent ? "raw present" : apply ? (out.rawCreated ? "copied" : "copied (already there)") : "would copy"}${out.linkNeeded ? (apply ? ", original_sha256 set" : ", would set original_sha256") : ", original_sha256 present"}`;
    console.log(`  photo ${p.id} (activity ${p.activityId}) ${p.pathname}: ${status}`);
  }
}

// ---------------------------------------------------------------------------
// summary

function summarize(label: string, list: Outcome[], linkLabel: string) {
  const n = (f: (o: Outcome) => unknown) => list.filter((o) => Boolean(f(o))).length;
  const ok = list.filter((o) => !o.error && !o.mismatch && !o.publicMissing);
  console.log(
    `${label}: ${list.length} total — ${n((o) => o.rawPresent)} already in raw store, ` +
      `${ok.filter((o) => !o.rawPresent).length} ${apply ? "copied" : "to copy"}, ` +
      `${ok.filter((o) => o.linkNeeded).length} ${apply ? "" : "to "}${linkLabel}, ` +
      `${n((o) => o.mismatch)} hash mismatches, ${n((o) => o.publicMissing)} public copies missing, ${n((o) => o.error)} errors` +
      (!apply && !verify ? " (public copies HEAD-checked only; --verify hashes them)" : "")
  );
}
console.log("");
summarize("originals", outcomes.originals, "link device-file source");
summarize("photos", outcomes.photos, "set original_sha256");

if (!apply) {
  console.log("\ndry run complete. to write:");
  console.log("  npx tsx --env-file=.env.local scripts/migrate-originals-private.mts --apply");
  const failed = [...outcomes.originals, ...outcomes.photos].some((o) => o.mismatch || o.error);
  process.exit(failed ? 1 : 0);
}

// re-read every copied object from the raw store
let bad = 0;
for (const sha of copied) {
  const v = await store!.verify(sha);
  if (!v.ok) {
    bad++;
    console.error(`  ✗ ${sha}: ${v.reason}`);
  }
}
console.log(`verify: ${copied.size - bad}/${copied.size} raw objects read back ok`);
const failed = [...outcomes.originals, ...outcomes.photos].some((o) => o.mismatch || o.error || o.publicMissing);
process.exit(bad > 0 || failed ? 1 : 0);
