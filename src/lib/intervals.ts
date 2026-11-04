// intervals.icu → neon pull. garmin pushes every activity to intervals.icu (an
// official garmin partner) within a minute or two of a watch sync, and its api
// serves the original file — so this is the garmin import path that doesn't
// depend on strava. the original and the activity json are kept as raw objects,
// linked as sources, and republish() builds the published route/stats. never
// destructive: insert-only, plus attaching the original to strava-api rows (no
// file) while keeping their strava metadata. server-only.

import { eq } from "drizzle-orm";
import { getDb, activities } from "./db";
import {
  buildActivityValues,
  computePublished,
  dedupeKey,
  findSameActivity,
  insertActivity,
  localDateTime,
  DEFAULT_PRIVACY_TRIM_M,
} from "./activities";
import { parseTrackFile } from "./fit";
import {
  addActivitySource,
  findActivityIdBySource,
  storeOriginal,
  storeRawPayload,
  type StoredOriginal,
} from "./activity-sources";
import { republish } from "./republish";
import { invalidateCache } from "./cache";

const API = "https://intervals.icu/api/v1";
const FETCH_TIMEOUT_MS = 15000;
// each new activity is a file download + parse + raw put; keep a run well
// inside the 60s function limit and let the next run continue
const MAX_NEW_PER_RUN = 10;
const DEFAULT_LOOKBACK_DAYS = 7;

interface IntervalsActivity {
  id: string; // "i123456"
  name?: string | null;
  type?: string | null; // strava-style keys (Run, Ride, WeightTraining…)
  source?: string | null; // GARMIN_CONNECT, UPLOAD, MANUAL, STRAVA…
  start_date?: string | null; // utc
  start_date_local?: string | null;
  description?: string | null;
  distance?: number | null;
  moving_time?: number | null;
  elapsed_time?: number | null;
  total_elevation_gain?: number | null;
  average_speed?: number | null;
  max_speed?: number | null;
  average_heartrate?: number | null;
  max_heartrate?: number | null;
  average_cadence?: number | null;
  icu_average_watts?: number | null;
  icu_joules?: number | null;
  file_type?: string | null;
}

export function isIntervalsConfigured(): boolean {
  return Boolean(process.env.INTERVALS_ICU_API_KEY);
}

function authHeader(): string {
  const key = process.env.INTERVALS_ICU_API_KEY;
  if (!key) throw new Error("INTERVALS_ICU_API_KEY is not set");
  return `Basic ${Buffer.from(`API_KEY:${key}`).toString("base64")}`;
}

async function intervalsFetch(path: string): Promise<Response> {
  const response = await fetch(`${API}${path}`, {
    headers: { Authorization: authHeader() },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (response.status === 401 || response.status === 403) {
    throw new Error("intervals.icu rejected the api key");
  }
  return response;
}

// the activity's utc offset in minutes, from its utc and local start strings
function offsetMin(a: IntervalsActivity): number {
  if (!a.start_date || !a.start_date_local) return 0;
  const utc = new Date(a.start_date).getTime();
  const local = new Date(`${a.start_date_local.replace(/Z$/, "")}Z`).getTime();
  return Math.round((local - utc) / 60000);
}

async function listActivities(oldest: string): Promise<IntervalsActivity[]> {
  const athlete = process.env.INTERVALS_ICU_ATHLETE_ID || "0"; // 0 = the key's own athlete
  const response = await intervalsFetch(`/athlete/${athlete}/activities?oldest=${oldest}`);
  if (!response.ok) {
    throw new Error(`intervals.icu list: ${response.status} ${await response.text()}`);
  }
  const list = (await response.json()) as IntervalsActivity[];
  return list
    // strava-sourced entries are empty stubs (strava's api terms); the strava sync covers those
    .filter((a) => a.source !== "STRAVA" && a.start_date)
    .sort((a, b) => a.start_date!.localeCompare(b.start_date!));
}

// original file bytes as served, or null when the activity has none (manual
// entries). always /file (the original upload), never /fit-file (a re-encode).
async function downloadOriginal(id: string): Promise<Uint8Array | null> {
  const response = await intervalsFetch(`/activity/${id}/file`);
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`intervals.icu file ${id}: ${response.status} ${await response.text()}`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  return bytes.length > 0 ? bytes : null;
}

// the activity json, kept as the exact bytes received; null when not stored
async function storeActivityJson(id: string): Promise<string | null> {
  const response = await intervalsFetch(`/activity/${id}`);
  if (!response.ok) {
    throw new Error(`intervals.icu activity ${id}: ${response.status} ${await response.text()}`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  return storeRawPayload(bytes, "intervals-activity", { provider: "intervals-icu", externalId: id });
}

// parse an original + keep its bytes. the insert row carries the default trim;
// republish then owns the published columns.
async function fromOriginal(a: IntervalsActivity, bytes: Uint8Array) {
  const filename = `${a.id}.${a.file_type || "fit"}`;
  const parsed = parseTrackFile(bytes, filename);
  const stored = await storeOriginal(bytes, filename, parsed.startDateUtc, {
    provider: "intervals-icu",
    externalId: a.id,
    url: `${API}/activity/${a.id}/file`,
  });
  const hasGps = parsed.records.some((r) => r.lat !== null);
  const trim = hasGps ? DEFAULT_PRIVACY_TRIM_M : 0;
  const published = computePublished(parsed, trim, trim);
  const values = buildActivityValues(parsed, published, {
    name: a.name || parsed.suggestedName,
    description: a.description || null,
    sportType: a.type || undefined,
    source: "intervals-icu",
    externalId: a.id,
    // legacy public copy, only before the private store exists
    fitBlobUrl: stored.legacy?.url ?? null,
    fitBlobPathname: stored.legacy?.pathname ?? null,
    fitSha256: stored.legacy?.sha256 ?? null,
    utcOffsetMinFallback: offsetMin(a),
  });
  return { values, stored };
}

// no file: summary stats only
function fromSummary(a: IntervalsActivity) {
  const startDateUtc = new Date(a.start_date!);
  const utcOffsetMin = offsetMin(a);
  const { localDate, localTime } = localDateTime(startDateUtc, utcOffsetMin);
  const elapsed = Math.round(a.elapsed_time ?? a.moving_time ?? 0);
  return {
    name: a.name || "workout",
    sportType: a.type || "Workout",
    startDateUtc,
    localDate,
    localTime,
    utcOffsetMin,
    distanceM: a.distance ?? 0,
    movingTimeS: Math.round(a.moving_time ?? elapsed),
    elapsedTimeS: elapsed,
    elevGainM: a.total_elevation_gain ?? 0,
    avgSpeedMs: a.average_speed ?? 0,
    maxSpeedMs: a.max_speed ?? 0,
    avgHr: a.average_heartrate ?? null,
    maxHr: a.max_heartrate ?? null,
    avgCadence: a.average_cadence ?? null,
    avgWatts: a.icu_average_watts ?? null,
    kilojoules: a.icu_joules ? a.icu_joules / 1000 : null,
    description: a.description || null,
    source: "intervals-icu",
    externalId: a.id,
    fileType: null,
    dedupeKey: dedupeKey(startDateUtc.getTime() / 1000, elapsed),
  };
}

// link what we kept to the row: the original (or a summary marker) + the json
async function attachSources(
  activityId: number,
  externalId: string,
  stored: StoredOriginal | null,
  jsonSha: string | null
): Promise<void> {
  const base = { activityId, provider: "intervals-icu" as const, externalId };
  if (stored) await addActivitySource({ ...base, kind: "device-file", rawSha256: stored.rawSha256 });
  else await addActivitySource({ ...base, kind: "summary" });
  if (jsonSha) await addActivitySource({ ...base, kind: "intervals-activity", rawSha256: jsonSha });
}

export interface PullResult {
  inserted: number;
  upgraded: number; // strava-api row given the original file's route + stats
  skipped: number;
  failures: { id: string; error: string }[];
  more: boolean;
}

export async function pullIntervalsActivities({ days = DEFAULT_LOOKBACK_DAYS } = {}): Promise<PullResult> {
  const oldest = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const listed = await listActivities(oldest);
  const db = getDb();
  const result: PullResult = { inserted: 0, upgraded: 0, skipped: 0, failures: [], more: false };

  let work = 0;
  for (const a of listed) {
    if (work >= MAX_NEW_PER_RUN) {
      result.more = true;
      break;
    }
    try {
      // pulled before: either its own row, or attached to another row as a source
      const existingById = await db
        .select({ id: activities.id })
        .from(activities)
        .where(eq(activities.externalId, a.id))
        .limit(1);
      if (existingById.length > 0 || (await findActivityIdBySource("intervals-icu", a.id)) !== null) {
        result.skipped++;
        continue;
      }

      const same = await findSameActivity(new Date(a.start_date!));
      // already have it with an original file (upload / archive / earlier pull)
      // or as a file-less entry from another source with nothing better to offer
      if (same && (same.fitBlobPathname || same.source !== "strava-api")) {
        result.skipped++;
        continue;
      }

      work++;
      const bytes = await downloadOriginal(a.id);

      if (same) {
        // strava-api row: attach the original as its best track source and let
        // republish rebuild route + stats. strava's name/description/type and
        // the row's identity stay.
        if (!bytes) {
          result.skipped++;
          continue;
        }
        const { values, stored } = await fromOriginal(a, bytes);
        const jsonSha = await storeActivityJson(a.id);
        if (stored.legacy) {
          // pre-cutover: republish finds the original through these columns
          await db
            .update(activities)
            .set({
              fitBlobUrl: stored.legacy.url,
              fitBlobPathname: stored.legacy.pathname,
              fitSha256: stored.legacy.sha256,
              fileType: values.fileType,
              updatedAt: new Date(),
            })
            .where(eq(activities.id, same.id));
        }
        await attachSources(same.id, a.id, stored, jsonSha);
        await republish(same.id);
        result.upgraded++;
        continue;
      }

      const jsonSha = await storeActivityJson(a.id);
      const built = bytes ? await fromOriginal(a, bytes) : null;
      const outcome = await insertActivity(built ? built.values : fromSummary(a));
      if (!outcome.inserted) {
        result.skipped++;
        continue;
      }
      await attachSources(outcome.id, a.id, built?.stored ?? null, jsonSha);
      if (built) await republish(outcome.id);
      result.inserted++;
    } catch (error) {
      result.failures.push({ id: a.id, error: (error as Error).message });
    }
  }

  if (result.inserted + result.upgraded > 0) {
    await invalidateCache("activities_list", "activities_latest");
  }
  return result;
}
