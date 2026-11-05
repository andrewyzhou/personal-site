// run the listening collector locally.
//
//   npx tsx --env-file=.env.local scripts/collect-spotify.mts [--apply] [--lookups N]
//
// dry run by default: calls spotify (read-only), hashes what it would store,
// reads neon when the listening tables exist, writes nothing. --apply is the
// same run the cron does (raw store + neon).

import { runListeningCollect } from "../src/lib/listening/service";

const apply = process.argv.includes("--apply");
const i = process.argv.indexOf("--lookups");
const maxLookups = i >= 0 ? Number(process.argv[i + 1]) : undefined;

const r = await runListeningCollect({ dryRun: !apply, maxLookups });
console.log(JSON.stringify(r, null, 2));
if (!r.ok) process.exit(1);
