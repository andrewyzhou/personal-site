// idempotent bulk import of a strava account archive into r2 + neon.
//
//   npx tsx --env-file=.env.local scripts/import-strava-archive.mts \
//     --dir ~/Desktop/export_161887324 [--dry-run] [--limit N] \
//     [--tz America/Los_Angeles] [--no-trim]
//
// never destructive: inserts are conflict-do-nothing on dedupe_key, originals go
// to content-addressed r2 paths, and re-runs skip everything already present.

import fs from "node:fs";
import path from "node:path";
import { parse as parseCsv } from "csv-parse/sync";
import { parseTrackFile } from "../src/lib/fit";
import {
  buildActivityValues,
  computePublished,
  dedupeKey,
  fitBlobPathname,
  insertActivity,
  localDateTime,
  sha256Hex,
  DEFAULT_PRIVACY_TRIM_M,
} from "../src/lib/activities";
import { r2Head, r2Put, r2PublicUrl } from "../src/lib/r2";
import type { NewActivityRow } from "../src/lib/db";

// ---------------------------------------------------------------------------
// args

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const has = (name: string) => process.argv.includes(`--${name}`);

const dir = (arg("dir") ?? `${process.env.HOME}/Desktop/export_161887324`).replace(/^~/, process.env.HOME!);
const dryRun = has("dry-run");
const limit = Number(arg("limit") ?? Infinity);
const tz = arg("tz") ?? "America/Los_Angeles";
const noTrim = has("no-trim");

// ---------------------------------------------------------------------------
// helpers

function tzOffsetMin(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "shortOffset" }).formatToParts(date);
  const name = parts.find((p) => p.type === "timeZoneName")?.value ?? "GMT+0";
  const m = name.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
  if (!m) return 0;
  return (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] ?? 0));
}

// strava csv dates are utc, e.g. "Jul 1, 2026, 5:45:37 AM"
function parseCsvDate(s: string): Date {
  const d = new Date(`${s} UTC`);
  if (Number.isNaN(d.getTime())) throw new Error(`unparseable date: ${s}`);
  return d;
}

const CSV_TYPE_MAP: Record<string, string> = {
  Run: "Run", Ride: "Ride", Walk: "Walk", Hike: "Hike", Swim: "Swim", Yoga: "Yoga",
  Workout: "Workout", "Weight Training": "WeightTraining", "Rock Climb": "RockClimbing",
  "Football (Soccer)": "Soccer", Tennis: "Tennis", "Trail Run": "TrailRun",
  "Virtual Run": "VirtualRun", "Virtual Ride": "VirtualRide",
  "Mountain Bike Ride": "MountainBikeRide", "Gravel Ride": "GravelRide",
};

const num = (s: string | undefined): number | null => {
  if (s === undefined || s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

// ---------------------------------------------------------------------------

interface CsvRow {
  "Activity ID": string;
  "Activity Date": string;
  "Activity Name": string;
  "Activity Type": string;
  "Activity Description": string;
  "Elapsed Time": string;
  Distance: string;
  "Max Heart Rate": string;
  "Relative Effort": string;
  "Activity Gear": string;
  Filename: string;
  "Moving Time": string;
  "Max Speed": string;
  "Average Speed": string;
  "Elevation Gain": string;
}

const rows: CsvRow[] = parseCsv(fs.readFileSync(path.join(dir, "activities.csv")), {
  columns: true,
  skip_empty_lines: true,
});

console.log(`archive: ${dir} — ${rows.length} csv rows${dryRun ? " (dry run)" : ""}, tz fallback ${tz}, trim ${noTrim ? "off" : `${DEFAULT_PRIVACY_TRIM_M}m`}`);

let inserted = 0, skipped = 0, csvOnly = 0;
const failures: { id: string; error: string }[] = [];
let processed = 0;

for (const row of rows) {
  if (processed >= limit) break;
  processed++;
  const label = `${row["Activity ID"]} "${row["Activity Name"]}"`;

  try {
    let values: NewActivityRow;

    // strava exports indoor/manual activities as empty gpx shells (0 trkpt) —
    // those rows carry their stats only in the csv
    let parsedOk = false;
    let parsed: ReturnType<typeof parseTrackFile> | null = null;
    let fileBytes: Uint8Array | null = null;
    if (row.Filename) {
      const filePath = path.join(dir, row.Filename);
      if (!fs.existsSync(filePath)) throw new Error(`missing file ${row.Filename}`);
      fileBytes = new Uint8Array(fs.readFileSync(filePath));
      try {
        parsed = parseTrackFile(fileBytes, row.Filename);
        parsedOk = true;
      } catch (error) {
        if (!(error as Error).message.includes("could not extract a timed track")) throw error;
        console.warn(`  ~ ${label}: file has no track points, importing from csv row`);
      }
    }

    if (parsedOk && parsed && fileBytes) {
      const bytes = fileBytes;

      const hasGps = parsed.records.some((r) => r.lat !== null);
      const trim = hasGps && !noTrim ? DEFAULT_PRIVACY_TRIM_M : 0;
      const published = computePublished(parsed, trim, trim);

      // sanity: csv distance (meters) vs file distance, warn > 5% off
      const csvDist = num(row.Distance) ?? 0;
      const fileDist = parsed.sessionStats?.distanceM ?? parsed.cumDist[parsed.cumDist.length - 1] ?? 0;
      if (csvDist > 100 && fileDist > 0 && Math.abs(csvDist - fileDist) / csvDist > 0.05) {
        console.warn(`  ~ ${label}: csv ${csvDist}m vs file ${Math.round(fileDist)}m — review manually`);
      }

      // store the original (content-addressed; skip if already there)
      const { unwrapTrackFile } = await import("../src/lib/fit");
      const inner = unwrapTrackFile(bytes, row.Filename);
      const sha = sha256Hex(inner.bytes);
      const pathname = fitBlobPathname(sha, parsed.fileType, parsed.startDateUtc);
      if (!dryRun && !(await r2Head(pathname))) {
        await r2Put(pathname, inner.bytes, "application/octet-stream");
      }

      values = buildActivityValues(parsed, published, {
        name: row["Activity Name"] || parsed.suggestedName,
        // csv type wins: it carries the owner's corrected categorization on
        // strava (e.g. soccer recorded with the watch's run profile)
        sportType: CSV_TYPE_MAP[row["Activity Type"]] ?? parsed.sportType,
        description: row["Activity Description"] || null,
        gear: row["Activity Gear"] || null,
        sufferScore: num(row["Relative Effort"]),
        source: "strava-archive",
        externalId: row["Activity ID"],
        fitBlobUrl: r2PublicUrl(pathname),
        fitBlobPathname: pathname,
        fitSha256: sha,
        utcOffsetMinFallback: tzOffsetMin(parsed.startDateUtc, tz),
      });
    } else {
      // csv-only manual entry (gym sessions etc.)
      csvOnly++;
      const startDateUtc = parseCsvDate(row["Activity Date"]);
      const utcOffsetMin = tzOffsetMin(startDateUtc, tz);
      const { localDate, localTime } = localDateTime(startDateUtc, utcOffsetMin);
      const elapsed = Math.round(num(row["Elapsed Time"]) ?? 0);
      values = {
        name: row["Activity Name"] || "workout",
        sportType: CSV_TYPE_MAP[row["Activity Type"]] ?? "Workout",
        startDateUtc,
        localDate,
        localTime,
        utcOffsetMin,
        distanceM: num(row.Distance) ?? 0,
        movingTimeS: Math.round(num(row["Moving Time"]) ?? elapsed),
        elapsedTimeS: elapsed,
        elevGainM: num(row["Elevation Gain"]) ?? 0,
        avgSpeedMs: num(row["Average Speed"]) ?? 0,
        maxSpeedMs: num(row["Max Speed"]) ?? 0,
        maxHr: num(row["Max Heart Rate"]),
        description: row["Activity Description"] || null,
        sufferScore: num(row["Relative Effort"]),
        gear: row["Activity Gear"] || null,
        source: "manual",
        externalId: row["Activity ID"],
        fileType: null,
        dedupeKey: dedupeKey(startDateUtc.getTime() / 1000, elapsed),
      };
    }

    if (dryRun) {
      console.log(`  ✓ ${label}: ${values.sportType} ${values.localDate} ${values.localTime} ${Math.round(values.distanceM ?? 0)}m (dry)`);
      inserted++;
      continue;
    }

    const outcome = await insertActivity(values);
    if (outcome.inserted) {
      inserted++;
      console.log(`  + ${label}: id ${outcome.id} (${values.sportType} ${values.localDate})`);
    } else {
      skipped++;
    }
  } catch (error) {
    failures.push({ id: row["Activity ID"], error: (error as Error).message });
    console.error(`  ✗ ${label}: ${(error as Error).message}`);
  }
}

console.log(`\nsummary: inserted=${inserted} skipped(duplicate)=${skipped} csvOnly=${csvOnly} failed=${failures.length}`);
if (failures.length > 0) {
  for (const f of failures) console.log(`  failed ${f.id}: ${f.error}`);
  process.exit(1);
}
