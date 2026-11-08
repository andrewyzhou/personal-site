// attach garmin originals from intervals.icu to activities that have no device
// file (route/stats from imported streams or summary-only). idempotent; dry run
// by default.
//
//   npx tsx --env-file=.env.local scripts/backfill-intervals-files.mts            # dry run: read-only
//   npx tsx --env-file=.env.local scripts/backfill-intervals-files.mts --apply    # writes (owner-approved only)
//
// matching: an intervals activity starting within SAME_ACTIVITY_WINDOW_S of
// the row (the same rule every import uses). --apply runs the regular import
// (importIntervalsActivity), which for a file-less row stores the original
// privately, links it as the row's best track source and republishes; the
// row's name, description and sport type stay. rows with no match keep their
// stored data untouched.

import { sql } from "drizzle-orm";
import { getDb } from "../src/lib/db";
import { SAME_ACTIVITY_WINDOW_S, findSameActivity } from "../src/lib/activities";
import { parseTrackFile } from "../src/lib/fit";
import { downloadOriginal, importIntervalsActivity, listActivities, type IntervalsActivity } from "../src/lib/intervals";

const apply = process.argv.includes("--apply");
if (!process.env.INTERVALS_ICU_API_KEY) {
  console.error("INTERVALS_ICU_API_KEY is not set");
  process.exit(1);
}

const db = getDb();
const rows = (
  await db.execute(sql`
    select a.id, a.name, a.source, a.sport_type, a.start_date_utc, a.polyline is not null as has_route
    from activities a
    where a.fit_blob_pathname is null
      and a.split_from_id is null
      and not exists (select 1 from activity_sources s where s.activity_id = a.id and s.kind = 'device-file')
    order by a.start_date_utc`)
).rows as { id: number; name: string; source: string; sport_type: string; start_date_utc: string; has_route: boolean }[];

const bySource = new Map<string, { total: number; route: number }>();
for (const r of rows) {
  const b = bySource.get(r.source) ?? { total: 0, route: 0 };
  b.total++;
  if (r.has_route) b.route++;
  bySource.set(r.source, b);
}
console.log(`${rows.length} activities without a device file:`);
for (const [s, b] of bySource) console.log(`  ${s}: ${b.total} (${b.route} with a stored route)`);
if (rows.length === 0) process.exit(0);

const first = new Date(rows[0].start_date_utc);
const oldest = new Date(first.getTime() - 86400000).toISOString().slice(0, 10);
const listed = await listActivities(oldest);
const coverage = listed.length ? `${listed[0].start_date} … ${listed[listed.length - 1].start_date}` : "nothing";
console.log(`intervals.icu has ${listed.length} activities since ${oldest} (${coverage})`);

const windowMs = SAME_ACTIVITY_WINDOW_S * 1000;
const matchOf = (r: (typeof rows)[number]): IntervalsActivity | undefined => {
  const t = new Date(r.start_date_utc).getTime();
  return listed.find((a) => Math.abs(new Date(a.start_date!).getTime() - t) <= windowMs);
};

let matched = 0;
let withFile = 0;
let applied = 0;
const failures: string[] = [];
for (const r of rows) {
  const a = matchOf(r);
  if (!a) continue;
  matched++;
  const bytes = await downloadOriginal(a.id);
  if (!bytes) {
    console.log(`  #${r.id} ${r.start_date_utc} "${r.name}" ↔ ${a.id}: no original file on intervals`);
    continue;
  }
  let summary = "";
  try {
    const parsed = parseTrackFile(bytes, `${a.id}.${a.file_type || "fit"}`);
    const gps = parsed.records.filter((p) => p.lat !== null).length;
    summary = `${parsed.fileType}, ${parsed.records.length} samples, ${gps} with gps, file sport ${parsed.fitSport ?? "?"}/${parsed.fitSubSport ?? "?"}`;
  } catch (error) {
    console.log(`  #${r.id} ↔ ${a.id}: original unreadable (${(error as Error).message})`);
    continue;
  }
  withFile++;
  console.log(`  #${r.id} ${r.start_date_utc} [${r.source}] "${r.name}" (${r.sport_type}) ↔ ${a.id} "${a.name}": ${summary}`);
  if (!apply) continue;
  // the import attaches to whatever row it finds in the window: only proceed
  // when that is this row
  const same = await findSameActivity(new Date(a.start_date!));
  if (same?.id !== r.id) {
    console.log(`    skipped: the import would match row #${same?.id ?? "none"}`);
    continue;
  }
  try {
    const outcome = await importIntervalsActivity(a);
    console.log(`    ${outcome}`);
    if (outcome === "upgraded") applied++;
  } catch (error) {
    failures.push(`#${r.id}: ${(error as Error).message}`);
  }
}

console.log(`\n${matched} of ${rows.length} have an intervals.icu activity; ${withFile} of those have an original file.`);
console.log(`${rows.length - withFile} keep their stored data (no alternative).`);
if (apply) console.log(`applied: ${applied} upgraded${failures.length ? `, ${failures.length} failed:\n  ${failures.join("\n  ")}` : ""}`);
else console.log("dry run: nothing written. re-run with --apply to attach the files.");
