// idempotent import of strava archive photos into r2 + neon, attached to
// activities already imported by import-strava-archive.mts (matched on
// external_id = strava activity id).
//
//   npx tsx --env-file=.env.local scripts/import-strava-media.mts \
//     --dir ~/Desktop/export_161887324 [--dry-run] [--limit N]
//
// never destructive: blobs are content-addressed (sha of the original bytes,
// stable across runs), an activity that already has any photos is skipped
// wholesale, and re-runs are no-ops. archive photos are already ≤2000px jpegs
// with exif stripped by strava, so bytes are uploaded verbatim.

import fs from "node:fs";
import path from "node:path";
import { parse as parseCsv } from "csv-parse/sync";
import { inArray } from "drizzle-orm";
import { imageSize } from "image-size";
import { sha256Hex } from "../src/lib/activities";
import { r2Head, r2Put, r2PublicUrl } from "../src/lib/r2";
import { getDb } from "../src/lib/db";
import { activities, activityPhotos } from "../src/lib/db/schema";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const has = (name: string) => process.argv.includes(`--${name}`);

const dir = (arg("dir") ?? `${process.env.HOME}/Desktop/export_161887324`).replace(/^~/, process.env.HOME!);
const dryRun = has("dry-run");
const limit = Number(arg("limit") ?? Infinity);

interface CsvRow {
  "Activity ID": string;
  "Activity Name": string;
  Media: string;
}
interface MediaRow {
  "Media Filename": string;
  "Media Caption": string;
}

const rows: CsvRow[] = parseCsv(fs.readFileSync(path.join(dir, "activities.csv")), {
  columns: true,
  skip_empty_lines: true,
});
const withMedia = rows.filter((r) => r.Media?.trim());

const captions = new Map<string, string>();
const mediaCsvPath = path.join(dir, "media.csv");
if (fs.existsSync(mediaCsvPath)) {
  const mediaRows: MediaRow[] = parseCsv(fs.readFileSync(mediaCsvPath), { columns: true, skip_empty_lines: true });
  for (const m of mediaRows) {
    if (m["Media Caption"]?.trim()) captions.set(m["Media Filename"], m["Media Caption"].trim());
  }
}

console.log(`archive: ${dir} — ${withMedia.length}/${rows.length} csv rows carry media${dryRun ? " (dry run)" : ""}`);

const db = getDb();
const dbRows = await db
  .select({ id: activities.id, externalId: activities.externalId })
  .from(activities)
  .where(inArray(activities.externalId, withMedia.map((r) => r["Activity ID"])));
const byExternalId = new Map(dbRows.map((r) => [r.externalId, r.id]));

// wholesale skip for activities that already have photos: keeps re-runs no-op
// without having to reconcile positions against partial prior state
const alreadyPhotographed = new Set<number>();
if (dbRows.length > 0) {
  const existing = await db
    .select({ activityId: activityPhotos.activityId })
    .from(activityPhotos)
    .where(inArray(activityPhotos.activityId, dbRows.map((r) => r.id)));
  for (const e of existing) alreadyPhotographed.add(e.activityId);
}

let inserted = 0, uploaded = 0, skippedActivities = 0, processed = 0;
const failures: { id: string; error: string }[] = [];

for (const row of withMedia) {
  if (processed >= limit) break;
  processed++;
  const label = `${row["Activity ID"]} "${row["Activity Name"]}"`;

  try {
    const activityId = byExternalId.get(row["Activity ID"]);
    if (!activityId) throw new Error("no matching activity in db (never imported?)");
    if (alreadyPhotographed.has(activityId)) {
      skippedActivities++;
      continue;
    }

    const files = row.Media.split("|").map((s) => s.trim()).filter(Boolean);
    const values: (typeof activityPhotos.$inferInsert)[] = [];

    for (const [position, file] of files.entries()) {
      const filePath = path.join(dir, file);
      if (!fs.existsSync(filePath)) throw new Error(`missing file ${file}`);
      const bytes = new Uint8Array(fs.readFileSync(filePath));

      const dim = imageSize(bytes);
      const sha = sha256Hex(bytes);
      const pathname = `activities/photos/strava-archive/${sha}.jpg`;

      if (!dryRun && !(await r2Head(pathname))) {
        await r2Put(pathname, bytes, "image/jpeg");
        uploaded++;
      }

      values.push({
        activityId,
        blobUrl: r2PublicUrl(pathname),
        blobPathname: pathname,
        width: dim.width ?? null,
        height: dim.height ?? null,
        position,
        caption: captions.get(file) ?? null,
      });
    }

    if (dryRun) {
      console.log(`  ✓ ${label}: ${values.length} photo(s) → activity ${activityId} (dry)`);
      inserted += values.length;
      continue;
    }

    await db.insert(activityPhotos).values(values);
    inserted += values.length;
    console.log(`  + ${label}: ${values.length} photo(s) → activity ${activityId}`);
  } catch (error) {
    failures.push({ id: row["Activity ID"], error: (error as Error).message });
    console.error(`  ✗ ${label}: ${(error as Error).message}`);
  }
}

console.log(`\nsummary: photos inserted=${inserted} blobs uploaded=${uploaded} activities skipped(existing photos)=${skippedActivities} failed=${failures.length}`);
if (failures.length > 0) {
  for (const f of failures) console.log(`  failed ${f.id}: ${f.error}`);
  process.exit(1);
}
