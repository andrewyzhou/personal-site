// read-only check of the garmin personal api, once a key exists: exchanges
// the key for a token, lists recent activities with how the site would type
// them and whether they are already here, then dry-runs the garmin import and
// prints every decision it would make. nothing is written (no rows, no raw
// objects, no cached token, no sync_events).
//
//   npx tsx --env-file=.env.local scripts/garmin-check.mts [--days 7]

import {
  findGarminRow,
  garminStart,
  garminUpstreamValues,
  isGarminConfigured,
  listGarminActivities,
} from "../src/lib/garmin";
import { syncActivitiesNow } from "../src/lib/activity-sync";
import { withSyncRun } from "../src/lib/sync-log";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const days = Number(arg("days") ?? 7);

if (!isGarminConfigured()) {
  console.error("GARMIN_PERSONAL_API_KEY is not set");
  process.exit(1);
}

const now = Date.now();
const startDate = new Date(now - (days + 1) * 86400000).toISOString().slice(0, 10);
const endDate = new Date(now + 86400000).toISOString().slice(0, 10);

await withSyncRun({ trigger: "script", source: "garmin", dryRun: true }, async () => {
  const listed = await listGarminActivities(startDate, endDate);
  console.log(`${listed.length} garmin activities ${startDate} … ${endDate}\n`);
  for (const a of listed) {
    const id = String(a.activityId);
    const up = garminUpstreamValues(a);
    const row = process.env.DATABASE_URL ? await findGarminRow(id) : null;
    console.log(
      [
        id.padEnd(12),
        garminStart(a)?.toISOString() ?? "no start",
        (up.sportType ?? "?").padEnd(16),
        row !== null ? `linked #${row}` : "new",
        JSON.stringify(up.name ?? null),
        up.description !== undefined ? "(has description field)" : "(no description field)",
      ].join("  ")
    );
  }
  if (listed[0]) {
    console.log("\nfirst summary as garmin sent it (field names for the owner's check):");
    console.log(JSON.stringify(listed[0], null, 2).slice(0, 4000));
  }
});

console.log("\nwhat a garmin import would do now:");
const result = await syncActivitiesNow({ trigger: "script", dryRun: true, sources: ["garmin"], days, metadataDays: days });
console.log(JSON.stringify(result.garmin, null, 2));
