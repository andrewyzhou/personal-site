// intervals.icu → neon pull. garmin pushes every activity to intervals.icu (an
// official garmin partner) within a minute or two of a watch sync, and its api
// serves the original .fit — so this is the garmin import path that doesn't
// depend on strava. originals go to r2, then the same trim/publish pipeline as
// uploads. never destructive: insert-only, plus upgrading strava-api rows (no
// original file) to the .fit route/stats while keeping their strava metadata.
// server-only.

import { eq } from "drizzle-orm";
import { getDb, activities } from "./db";
import {
  buildActivityValues,
  computePublished,
  dedupeKey,
  findSameActivity,
  fitBlobPathname,
  insertActivity,
  localDateTime,
  sha256Hex,
  DEFAULT_PRIVACY_TRIM_M,
} from "./activities";
import { parseTrackFile, unwrapTrackFile } from "./fit";
import { r2Head, r2Put, r2PublicUrl } from "./r2";
import { invalidateCache } from "./cache";

const API = "https://intervals.icu/api/v1";
const FETCH_TIMEOUT_MS = 15000;
// each new activity is a file download + parse + r2 put; keep a run well
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

// original file bytes, or null when the activity has none (manual entries)
async function downloadOriginal(id: string): Promise<Uint8Array | null> {
  const response = await intervalsFetch(`/activity/${id}/file`);
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`intervals.icu file ${id}: ${response.status} ${await response.text()}`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  return bytes.length > 0 ? bytes : null;
}

// parse an original + store it in r2; returns the publishable row values
async function fromOriginal(a: IntervalsActivity, bytes: Uint8Array) {
  const filename = `${a.id}.${a.file_type || "fit"}`;
  const parsed = parseTrackFile(bytes, filename);
  const inner = unwrapTrackFile(bytes, filename);
  const sha = sha256Hex(inner.bytes);
  const pathname = fitBlobPathname(sha, parsed.fileType, parsed.startDateUtc);
  if (!(await r2Head(pathname))) {
    await r2Put(pathname, inner.bytes, "application/octet-stream");
  }
  const hasGps = parsed.records.some((r) => r.lat !== null);
  const trim = hasGps ? DEFAULT_PRIVACY_TRIM_M : 0;
  const published = computePublished(parsed, trim, trim);
  return buildActivityValues(parsed, published, {
    name: a.name || parsed.suggestedName,
    description: a.description || null,
    sportType: a.type || undefined,
    source: "intervals-icu",
    externalId: a.id,
    fitBlobUrl: r2PublicUrl(pathname),
    fitBlobPathname: pathname,
    fitSha256: sha,
    utcOffsetMinFallback: offsetMin(a),
  });
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
      const existingById = await db
        .select({ id: activities.id })
        .from(activities)
        .where(eq(activities.externalId, a.id))
        .limit(1);
      if (existingById.length > 0) {
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
        // strava-api row: swap in the original's route + stats, keep strava's
        // name/description/type and the row's identity
        if (!bytes) {
          result.skipped++;
          continue;
        }
        const v = await fromOriginal(a, bytes);
        await db
          .update(activities)
          .set({
            distanceM: v.distanceM,
            movingTimeS: v.movingTimeS,
            elapsedTimeS: v.elapsedTimeS,
            elevGainM: v.elevGainM,
            avgSpeedMs: v.avgSpeedMs,
            maxSpeedMs: v.maxSpeedMs,
            avgHr: v.avgHr,
            maxHr: v.maxHr,
            avgCadence: v.avgCadence,
            avgWatts: v.avgWatts,
            maxWatts: v.maxWatts,
            kilojoules: v.kilojoules,
            polyline: v.polyline,
            cardPolyline: v.cardPolyline,
            bounds: v.bounds,
            trimStartM: v.trimStartM,
            trimEndM: v.trimEndM,
            fitBlobUrl: v.fitBlobUrl,
            fitBlobPathname: v.fitBlobPathname,
            fitSha256: v.fitSha256,
            fileType: v.fileType,
            updatedAt: new Date(),
          })
          .where(eq(activities.id, same.id));
        result.upgraded++;
        continue;
      }

      const values = bytes ? await fromOriginal(a, bytes) : fromSummary(a);
      const outcome = await insertActivity(values);
      if (outcome.inserted) result.inserted++;
      else result.skipped++;
    } catch (error) {
      result.failures.push({ id: a.id, error: (error as Error).message });
    }
  }

  if (result.inserted + result.upgraded > 0) {
    await invalidateCache("activities_list", "activities_latest");
  }
  return result;
}
