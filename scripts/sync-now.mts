// one activity sync from the command line: every configured source (garmin
// personal api, intervals.icu) over the frequent window. a dry run by
// default: it reads the apis and the database, prints every decision and api
// call it would log, and writes nothing (no rows, no raw objects, no kv, no
// sync_events).
//
//   npx tsx --env-file=.env.local scripts/sync-now.mts [--source garmin|intervals] [--days 3] [--apply]
//
// --apply runs it for real (the same as the 10-minute poll, trigger "script").

import { syncActivitiesNow } from "../src/lib/activity-sync";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const apply = process.argv.includes("--apply");
const source = arg("source");
if (source && source !== "garmin" && source !== "intervals") {
  console.error("--source must be garmin or intervals");
  process.exit(1);
}
const days = arg("days") ? Number(arg("days")) : undefined;
if (days !== undefined && !(days > 0)) {
  console.error("--days must be a positive number");
  process.exit(1);
}

console.log(apply ? "applying: this run writes" : "dry run: nothing is written (pass --apply to write)");
const result = await syncActivitiesNow({
  trigger: "script",
  dryRun: !apply,
  ...(days ? { days, metadataDays: days } : {}),
  ...(source ? { sources: [source as "garmin" | "intervals"] } : {}),
});
console.log(JSON.stringify(result, null, 2));
