// strava api → neon sync. pulls activities newer than the latest stored one,
// rebuilds the track from the streams api, and runs it through the same
// trim/publish pipeline as uploads and the archive import. insert-only for new
// activities; strava edits (rename, description, type) patch existing rows.
// server-only.

import { desc, eq, inArray } from "drizzle-orm";
import { getDb, activities, type NewActivityRow } from "./db";
import {
  buildActivityValues,
  computePublished,
  dedupeKey,
  insertActivity,
  localDateTime,
  DEFAULT_PRIVACY_TRIM_M,
} from "./activities";
import { cumulativeDistances, type TrackRecord } from "./geo";
import type { ParsedTrackFile } from "./fit";
import { getAccessToken, isStravaApiEnabled } from "./strava";
import { invalidateCache } from "./cache";

const API = "https://www.strava.com/api/v3";
const FETCH_TIMEOUT_MS = 10000;
// each new activity costs 2 reads (detail + streams); strava's read limit is
// 100 per 15 min, so cap a single run and let the next one continue
const MAX_NEW_PER_RUN = 25;
// re-list a little before the newest stored activity to catch late uploads
const LOOKBACK_S = 2 * 24 * 60 * 60;

interface StravaDetail {
  id: number;
  name: string;
  sport_type: string;
  start_date: string; // utc iso
  utc_offset: number; // seconds
  distance: number;
  moving_time: number;
  elapsed_time: number;
  total_elevation_gain: number;
  average_speed: number;
  max_speed: number;
  has_heartrate: boolean;
  average_heartrate?: number;
  max_heartrate?: number;
  average_cadence?: number;
  average_watts?: number;
  max_watts?: number;
  kilojoules?: number;
  suffer_score?: number | null;
  description?: string | null;
  private?: boolean;
  gear?: { name?: string } | null;
  map?: { summary_polyline?: string | null } | null;
}

type Streams = Partial<Record<
  "time" | "latlng" | "altitude" | "distance" | "heartrate" | "cadence" | "watts" | "velocity_smooth",
  { data: unknown[] }
>>;

async function stravaGet<T>(token: string, pathAndQuery: string): Promise<T> {
  const response = await fetch(`${API}${pathAndQuery}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`strava ${pathAndQuery.split("?")[0]}: ${response.status} ${response.statusText} — ${body}`);
  }
  return response.json() as Promise<T>;
}

async function listSince(token: string, after: number): Promise<{ id: number; start_date: string }[]> {
  const all: { id: number; start_date: string }[] = [];
  for (let page = 1; ; page++) {
    const batch = await stravaGet<{ id: number; start_date: string }[]>(
      token,
      `/athlete/activities?after=${after}&per_page=200&page=${page}`
    );
    all.push(...batch);
    if (batch.length < 200) break;
  }
  // oldest first, so a capped run advances the watermark without leaving gaps
  return all.sort((a, b) => a.start_date.localeCompare(b.start_date));
}

function streamsToTrack(detail: StravaDetail, streams: Streams): ParsedTrackFile | null {
  const time = streams.time?.data as number[] | undefined;
  const latlng = streams.latlng?.data as [number, number][] | undefined;
  if (!time || !latlng || latlng.length < 2) return null;

  const at = <T>(key: keyof Streams, i: number): T | null =>
    ((streams[key]?.data[i] as T | undefined) ?? null);

  const records: TrackRecord[] = time.map((t, i) => ({
    lat: latlng[i]?.[0] ?? null,
    lng: latlng[i]?.[1] ?? null,
    t,
    ele: at<number>("altitude", i),
    hr: at<number>("heartrate", i),
    cadence: at<number>("cadence", i),
    watts: at<number>("watts", i),
    speed: at<number>("velocity_smooth", i),
  }));
  const distance = streams.distance?.data as number[] | undefined;

  return {
    // no original file exists for api-sourced activities; fileType is nulled on the row
    fileType: "fit",
    sportType: detail.sport_type,
    startDateUtc: new Date(detail.start_date),
    utcOffsetMin: Math.round(detail.utc_offset / 60),
    hasLocalTime: true,
    records,
    cumDist: distance && distance.length === records.length ? distance : cumulativeDistances(records),
    sessionStats: summaryStats(detail),
    kilojoules: detail.kilojoules ?? null,
    suggestedName: detail.name,
  };
}

function summaryStats(d: StravaDetail) {
  return {
    distanceM: d.distance || 0,
    movingTimeS: d.moving_time || 0,
    elapsedTimeS: d.elapsed_time || 0,
    elevGainM: d.total_elevation_gain || 0,
    avgSpeedMs: d.average_speed || 0,
    maxSpeedMs: d.max_speed || 0,
    avgHr: d.has_heartrate ? d.average_heartrate ?? null : null,
    maxHr: d.has_heartrate ? d.max_heartrate ?? null : null,
    avgCadence: d.average_cadence ?? null,
    avgWatts: d.average_watts ?? null,
    maxWatts: d.max_watts ?? null,
  };
}

async function buildRow(token: string, detail: StravaDetail): Promise<NewActivityRow> {
  const meta = {
    name: detail.name || "workout",
    description: detail.description || null,
    gear: detail.gear?.name || null,
    sufferScore: detail.suffer_score ?? null,
    source: "strava-api",
    externalId: String(detail.id),
  };
  // "only you" activities on strava stay off the site
  const hidden = detail.private === true;

  if (detail.map?.summary_polyline) {
    const streams = await stravaGet<Streams>(
      token,
      `/activities/${detail.id}/streams?keys=time,latlng,altitude,distance,heartrate,cadence,watts,velocity_smooth&key_by_type=true`
    );
    const parsed = streamsToTrack(detail, streams);
    if (parsed) {
      const published = computePublished(parsed, DEFAULT_PRIVACY_TRIM_M, DEFAULT_PRIVACY_TRIM_M);
      return { ...buildActivityValues(parsed, published, meta), fileType: null, hidden };
    }
  }

  // no gps (gym, climbing, indoor): summary stats only
  const startDateUtc = new Date(detail.start_date);
  const utcOffsetMin = Math.round(detail.utc_offset / 60);
  const { localDate, localTime } = localDateTime(startDateUtc, utcOffsetMin);
  const s = summaryStats(detail);
  return {
    name: meta.name,
    description: meta.description,
    gear: meta.gear,
    sufferScore: meta.sufferScore,
    source: meta.source,
    externalId: meta.externalId,
    hidden,
    sportType: detail.sport_type,
    startDateUtc,
    localDate,
    localTime,
    utcOffsetMin,
    distanceM: s.distanceM,
    movingTimeS: s.movingTimeS,
    elapsedTimeS: s.elapsedTimeS,
    elevGainM: s.elevGainM,
    avgSpeedMs: s.avgSpeedMs,
    maxSpeedMs: s.maxSpeedMs,
    avgHr: s.avgHr,
    maxHr: s.maxHr,
    avgCadence: s.avgCadence,
    avgWatts: s.avgWatts,
    maxWatts: s.maxWatts,
    kilojoules: detail.kilojoules ?? null,
    fileType: null,
    dedupeKey: dedupeKey(startDateUtc.getTime() / 1000, s.elapsedTimeS),
  };
}

export interface SyncResult {
  inserted: number;
  skipped: number;
  failures: { id: number; error: string }[];
  more: boolean; // hit the per-run cap; run again to continue
  preview?: NewActivityRow[]; // dry runs only
}

// pull everything newer than the latest stored activity
export async function syncStravaActivities({ dryRun = false } = {}): Promise<SyncResult> {
  if (!isStravaApiEnabled()) {
    throw new Error("strava api is disabled (STRAVA_API_ENABLED)");
  }
  const db = getDb();
  const token = await getAccessToken();

  const latest = await db
    .select({ start: activities.startDateUtc })
    .from(activities)
    .orderBy(desc(activities.startDateUtc))
    .limit(1);
  const after = latest[0] ? Math.floor(latest[0].start.getTime() / 1000) - LOOKBACK_S : 0;

  const listed = await listSince(token, after);
  const known = listed.length
    ? await db
        .select({ externalId: activities.externalId })
        .from(activities)
        .where(inArray(activities.externalId, listed.map((a) => String(a.id))))
    : [];
  const knownIds = new Set(known.map((r) => r.externalId));
  const todo = listed.filter((a) => !knownIds.has(String(a.id)));

  const result: SyncResult = { inserted: 0, skipped: 0, failures: [], more: todo.length > MAX_NEW_PER_RUN };
  for (const { id } of todo.slice(0, MAX_NEW_PER_RUN)) {
    try {
      const detail = await stravaGet<StravaDetail>(token, `/activities/${id}`);
      const row = await buildRow(token, detail);
      if (dryRun) {
        (result.preview ??= []).push(row);
        continue;
      }
      const outcome = await insertActivity(row);
      if (outcome.inserted) result.inserted++;
      else result.skipped++;
    } catch (error) {
      result.failures.push({ id, error: (error as Error).message });
      // a failed early activity must not let later ones advance the watermark past it
      break;
    }
  }

  if (result.inserted > 0) {
    await invalidateCache("activities_list", "activities_latest");
  }
  return result;
}

// mirror owner edits made on strava (rename, description, type) onto an
// already-synced row. stats and route are left alone.
export async function applyStravaUpdate(stravaId: number): Promise<boolean> {
  const token = await getAccessToken();
  const detail = await stravaGet<StravaDetail>(token, `/activities/${stravaId}`);
  const rows = await getDb()
    .update(activities)
    .set({
      name: detail.name || "workout",
      description: detail.description || null,
      sportType: detail.sport_type,
      gear: detail.gear?.name || null,
      // made private on strava → hide; never auto-unhide (site-side hides stick)
      ...(detail.private ? { hidden: true } : {}),
      updatedAt: new Date(),
    })
    .where(eq(activities.externalId, String(stravaId)))
    .returning({ id: activities.id });
  if (rows.length > 0) {
    await invalidateCache("activities_list", "activities_latest");
  }
  return rows.length > 0;
}

// strava-side delete → hide, never delete (history is only ever soft-removed).
// the webhook is unauthenticated, so confirm with strava that it's really gone.
export async function hideStravaActivity(stravaId: number): Promise<boolean> {
  const token = await getAccessToken();
  const response = await fetch(`${API}/activities/${stravaId}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (response.status !== 404) return false;
  await getDb()
    .update(activities)
    .set({ hidden: true, updatedAt: new Date() })
    .where(eq(activities.externalId, String(stravaId)));
  await invalidateCache("activities_list", "activities_latest");
  return true;
}
