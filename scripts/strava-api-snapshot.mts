// snapshot every strava activity's api responses into the private raw store:
// detail (all efforts), streams, laps and photos, stored as the exact response
// bytes and linked to the activity as activity_sources rows. dry run by default
// (plans only: no strava requests, no token refresh, no writes).
//
//   npx tsx --env-file=.env.local scripts/strava-api-snapshot.mts \
//     [--ids-from-csv ~/Desktop/export_161887324/activities.csv] \
//     [--kinds strava-detail,strava-streams] [--limit N] [--retry-gone] \
//     [--checkpoint <file>] [--wait-daily] [--apply]
//
// rate limits: strava allows 100 reads / 15 min and 1000 / day (200 / 2000
// overall). every response's X-RateLimit-* / X-ReadRateLimit-* headers drive the
// pacing: sleep to the next utc quarter hour near the 15-min limit, stop cleanly
// near the daily one (or --wait-daily to sleep until utc midnight). resumable:
// pairs that already have a source row are skipped, and a local checkpoint
// remembers finished and 404 pairs.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parse as parseCsv } from "csv-parse/sync";
import { neon } from "@neondatabase/serverless";
import {
  DEFAULT_LIMITS,
  DEFAULT_MARGIN,
  backoffAfter429,
  decideBudget,
  estimateSchedule,
  formatDuration,
  parseRateLimitHeaders,
  type RateLimitState,
} from "../src/lib/strava-rate-limit";
import {
  SNAPSHOT_KINDS,
  STRAVA_ID_SOURCES,
  buildPlan,
  collectStravaTargets,
  idsFromCsvRows,
  markCheckpoint,
  pairKey,
  parseCheckpoint,
  storedPairs,
  type Checkpoint,
  type SnapshotKind,
} from "../src/lib/strava-snapshot";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const has = (name: string) => process.argv.includes(`--${name}`);
const home = process.env.HOME ?? process.env.USERPROFILE ?? "";

const apply = has("apply");
const csvPath = arg("ids-from-csv")?.replace(/^~/, home);
const limit = Number(arg("limit") ?? Infinity);
const retryGone = has("retry-gone");
const waitDaily = has("wait-daily");
const checkpointPath = arg("checkpoint") ?? path.join(os.tmpdir(), "strava-api-snapshot.checkpoint.json");
const kinds = (arg("kinds")?.split(",").map((s) => s.trim()) ?? [...SNAPSHOT_KINDS]) as SnapshotKind[];
for (const k of kinds) {
  if (!(SNAPSHOT_KINDS as readonly string[]).includes(k)) {
    console.error(`unknown kind ${k} (expected ${SNAPSHOT_KINDS.join(", ")})`);
    process.exit(1);
  }
}

const API = "https://www.strava.com/api/v3";
const FETCH_TIMEOUT_MS = 30_000;
// assumed per-request time (request + raw put + source insert) for estimates
const REQUEST_MS = 700;

// ---------------------------------------------------------------------------
// inputs (read-only)

const sql = neon(process.env.DATABASE_URL!);
const tables = new Set(
  (await sql`
    select table_name from information_schema.tables
    where table_schema = 'public' and table_name in ('activity_sources', 'raw_objects')`).map((r) => r.table_name as string)
);
const migrated = tables.has("activity_sources") && tables.has("raw_objects");

const legacy = (await sql`
  select id, external_id, source from activities
  where external_id is not null and source = any(${[...STRAVA_ID_SOURCES]})`).map((r) => ({
  id: Number(r.id),
  externalId: r.external_id as string | null,
  source: r.source as string,
}));

let sourceRows: { activityId: number; externalId: string | null; kind: string; rawSha256: string | null }[] = [];
if (migrated) {
  sourceRows = (await sql`
    select activity_id, external_id, kind, raw_sha256 from activity_sources where provider = 'strava'`).map((r) => ({
    activityId: Number(r.activity_id),
    externalId: r.external_id as string | null,
    kind: r.kind as string,
    rawSha256: r.raw_sha256 as string | null,
  }));
}

let csvIds: string[] | undefined;
if (csvPath) {
  const rows: Record<string, string>[] = parseCsv(fs.readFileSync(csvPath), { columns: true, skip_empty_lines: true, bom: true });
  csvIds = idsFromCsvRows(rows);
}

let checkpoint: Checkpoint = parseCheckpoint(fs.existsSync(checkpointPath) ? fs.readFileSync(checkpointPath, "utf8") : null);
const saveCheckpoint = () => fs.writeFileSync(checkpointPath, JSON.stringify(checkpoint));

const collected = collectStravaTargets({ sources: sourceRows, legacy, csvIds });
const stored = storedPairs(sourceRows);
const plan = buildPlan(collected.targets, { stored, checkpoint, kinds, retryGone });
const requests = plan.requests.slice(0, Number.isFinite(limit) ? limit : undefined);

// ---------------------------------------------------------------------------
// plan report

console.log(`strava-api-snapshot — ${apply ? "APPLY" : "dry run (plan only, no strava requests)"}`);
if (!migrated) console.log("  schema: activity_sources/raw_objects missing (migrations 0002/0003 not applied) — no stored snapshots to skip");
console.log(`  raw store: ${process.env.R2_RAW_BUCKET ? `R2_RAW_BUCKET=${process.env.R2_RAW_BUCKET}` : "R2_RAW_BUCKET not set"}`);
console.log(`  checkpoint: ${checkpointPath} (${checkpoint.done.length} done, ${checkpoint.gone.length} gone)`);
console.log(
  `  strava ids: ${collected.targets.length} linked to activities` +
    ` (${legacy.length} legacy external ids, ${sourceRows.length} strava source rows` +
    `${csvIds ? `, ${csvIds.length} csv ids` : ""})`
);
if (collected.unmatched.length) {
  console.log(`  csv ids with no activity (skipped, nothing to link to): ${collected.unmatched.length} — e.g. ${collected.unmatched.slice(0, 5).join(", ")}`);
}
for (const c of collected.conflicts) console.log(`  warning: strava id ${c.stravaId} is on activities ${c.activityIds.join(", ")} (using ${c.activityIds[0]})`);
const perKind = Object.fromEntries(kinds.map((k) => [k, requests.filter((r) => r.kind === k).length]));
console.log(`  kinds: ${kinds.join(", ")}`);
console.log(
  `  planned requests: ${requests.length}` +
    ` (${Object.entries(perKind).map(([k, v]) => `${k} ${v}`).join(", ")})` +
    `; skipped ${plan.skippedStored} already stored, ${plan.skippedCheckpoint} checkpointed` +
    `${requests.length < plan.requests.length ? `; --limit cut ${plan.requests.length - requests.length}` : ""}`
);

const perQuarter = DEFAULT_LIMITS.read.short - DEFAULT_MARGIN.short;
const perDay = DEFAULT_LIMITS.read.daily - DEFAULT_MARGIN.daily;
const now = Date.now();
const est = estimateSchedule(requests.length, { now, requestMs: REQUEST_MS, perQuarter, perDay });
console.log(
  `  limits: reads ${DEFAULT_LIMITS.read.short}/15min, ${DEFAULT_LIMITS.read.daily}/day` +
    ` (overall ${DEFAULT_LIMITS.overall.short}/${DEFAULT_LIMITS.overall.daily}); keeping a margin of` +
    ` ${DEFAULT_MARGIN.short}/${DEFAULT_MARGIN.daily} → ${perQuarter} per quarter hour, ${perDay} per utc day`
);
console.log(
  `  estimate (starting now, zero prior usage): ${est.quarters} quarter-hour windows over ${est.days} utc day(s),` +
    ` wall time ≈ ${formatDuration(est.wallMs)}, done ≈ ${new Date(est.finishAtMs).toISOString()}` +
    `${est.days > 1 && !waitDaily ? ` — without --wait-daily the run stops at the daily budget; re-run after utc midnight (${est.days} runs)` : ""}`
);

if (!apply) {
  const flags = [csvPath ? `--ids-from-csv ${arg("ids-from-csv")}` : "", arg("kinds") ? `--kinds ${arg("kinds")}` : "", arg("limit") ? `--limit ${arg("limit")}` : "", "--wait-daily"].filter(Boolean).join(" ");
  console.log(
    `\ndry run: nothing fetched or written.${!migrated || !process.env.R2_RAW_BUCKET ? " apply needs migrations 0002/0003 and R2_RAW_BUCKET first." : ""}` +
      `\napply with:\n  npx tsx --env-file=.env.local scripts/strava-api-snapshot.mts ${flags} --apply`
  );
  process.exit(0);
}

// ---------------------------------------------------------------------------
// apply

if (!migrated) {
  console.error("\n--apply needs migrations 0002/0003 (activity_sources, raw_objects). run `npm run db:migrate` first.");
  process.exit(1);
}
if (!process.env.R2_RAW_BUCKET) {
  console.error("\n--apply needs R2_RAW_BUCKET (the private raw bucket).");
  process.exit(1);
}
if (!process.env.STRAVA_REFRESH_TOKEN) {
  console.error("\n--apply needs STRAVA_CLIENT_ID / STRAVA_CLIENT_SECRET / STRAVA_REFRESH_TOKEN.");
  process.exit(1);
}

// loaded only on apply: these modules read env at import and talk to strava/r2
const { getAccessToken } = await import("../src/lib/strava");
const { addActivitySource, storeRawPayload } = await import("../src/lib/activity-sources");

// access tokens last 6 h; refresh well before that on long (multi-day) runs
const TOKEN_TTL_MS = 5 * 60 * 60 * 1000;
let token = "";
let tokenAt = 0;
async function accessToken(forceRefresh = false): Promise<string> {
  if (forceRefresh || !token || Date.now() - tokenAt > TOKEN_TTL_MS) {
    token = await getAccessToken();
    tokenAt = Date.now();
  }
  return token;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, Math.max(0, ms)));
async function sleepUntil(untilMs: number, reason: string) {
  console.log(`  ${reason}; sleeping until ${new Date(untilMs).toISOString()} (${formatDuration(untilMs - Date.now())})`);
  await sleep(untilMs - Date.now());
}

let rate: RateLimitState | null = null;
const counts = { stored: 0, gone: 0, failed: 0 };
const failures: { key: string; error: string }[] = [];
let stoppedEarly: string | null = null;

console.log("");
outer: for (const [i, req] of requests.entries()) {
  const key = pairKey(req.stravaId, req.kind);
  for (let attempt = 1; ; attempt++) {
    const decision = decideBudget(rate, Date.now(), { stopOnDaily: !waitDaily });
    if (decision.action === "stop") {
      stoppedEarly = `${decision.reason}; resume after ${new Date(decision.resumeAfterMs).toISOString()}`;
      break outer;
    }
    if (decision.action === "wait") {
      await sleepUntil(decision.untilMs, decision.reason);
      continue;
    }

    let res: Response;
    try {
      res = await fetch(`${API}${req.path}`, {
        headers: { Authorization: `Bearer ${await accessToken()}` },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
    } catch (error) {
      if (attempt < 4) {
        await sleep(2 ** attempt * 5_000);
        continue;
      }
      counts.failed++;
      failures.push({ key, error: (error as Error).message });
      break;
    }
    const observed = parseRateLimitHeaders(res.headers);
    if (observed.overall || observed.read) rate = observed;

    if (res.status === 429) {
      await res.arrayBuffer();
      if (attempt >= 6) {
        stoppedEarly = "repeated 429s; another client may be using the budget";
        break outer;
      }
      await sleepUntil(backoffAfter429(attempt, Date.now()), `429 (attempt ${attempt})`);
      continue;
    }
    if (res.status === 401 && attempt === 1) {
      await res.arrayBuffer();
      await accessToken(true);
      continue;
    }
    if (res.status === 401 || res.status === 403) {
      // 403 "Application Inactive" means the api is off for this app entirely
      stoppedEarly = `strava ${res.status}: ${(await res.text()).slice(0, 200)}`;
      break outer;
    }
    if (res.status === 404) {
      await res.arrayBuffer();
      counts.gone++;
      checkpoint = markCheckpoint(checkpoint, key, "gone");
      saveCheckpoint();
      console.log(`  [${i + 1}/${requests.length}] ${key} → 404 (deleted or not visible), recorded as gone`);
      break;
    }
    if (res.status >= 500 && attempt < 4) {
      await res.arrayBuffer();
      await sleep(2 ** attempt * 5_000);
      continue;
    }
    if (!res.ok) {
      counts.failed++;
      failures.push({ key, error: `${res.status} ${(await res.text()).slice(0, 200)}` });
      break;
    }

    // exact response bytes, never re-serialized
    const bytes = new Uint8Array(await res.arrayBuffer());
    const sha = await storeRawPayload(bytes, req.kind, {
      stravaId: req.stravaId,
      endpoint: req.path,
      fetchedAt: new Date().toISOString(),
    });
    if (!sha) throw new Error("raw store not configured");
    await addActivitySource({ activityId: req.activityId, provider: "strava", externalId: req.stravaId, kind: req.kind, rawSha256: sha });
    counts.stored++;
    checkpoint = markCheckpoint(checkpoint, key, "done");
    saveCheckpoint();
    const usage = rate?.read ? ` reads ${rate.read.usage.short}/${rate.read.limit.short}, ${rate.read.usage.daily}/${rate.read.limit.daily}` : "";
    console.log(`  [${i + 1}/${requests.length}] ${key} → ${bytes.length} bytes ${sha.slice(0, 12)}${usage}`);
    break;
  }
}

console.log(`\nstored ${counts.stored}, gone ${counts.gone}, failed ${counts.failed}, remaining ${requests.length - counts.stored - counts.gone - counts.failed}`);
for (const f of failures.slice(0, 20)) console.log(`  failed ${f.key}: ${f.error}`);
if (stoppedEarly) console.log(`stopped: ${stoppedEarly}. re-run the same command to resume.`);
process.exit(failures.length || (stoppedEarly && !stoppedEarly.includes("budget")) ? 1 : 0);
