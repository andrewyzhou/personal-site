// shared activity pipeline: trim + stat recompute + polylines + row mapping +
// idempotent insert. used by the parse/publish/edit routes, the archive import
// script, and the future intervals.icu pull. server-only (node crypto).

import { createHash } from "crypto";
import { eq } from "drizzle-orm";
import { getDb, activities, type ActivityRow, type NewActivityRow, type RouteBounds } from "./db";
import { encodePolyline } from "./polyline";
import {
  boundsOf,
  computeStats,
  rdpReduce,
  trimByDistance,
  type ComputedStats,
} from "./geo";
import type { ParsedTrackFile } from "./fit";
import type { CalendarActivity } from "./strava";

export const DETAIL_POLYLINE_MAX_POINTS = 1500;
export const CARD_POLYLINE_MAX_POINTS = 100;
export const DEFAULT_PRIVACY_TRIM_M = 200;

// stable across trim changes and re-parses: pre-trim start epoch + elapsed seconds
export function dedupeKey(startEpochSec: number, elapsedTimeS: number): string {
  return createHash("sha256").update(`${Math.round(startEpochSec)}:${Math.round(elapsedTimeS)}`).digest("hex");
}

export function fitBlobPathname(sha256: string, fileType: string, startDateUtc: Date): string {
  return `activities/fit/${startDateUtc.getUTCFullYear()}/${sha256}.${fileType}`;
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

// local wall-clock date/time strings from utc start + offset
export function localDateTime(startDateUtc: Date, utcOffsetMin: number): { localDate: string; localTime: string } {
  const shifted = new Date(startDateUtc.getTime() + utcOffsetMin * 60000);
  const iso = shifted.toISOString();
  return { localDate: iso.slice(0, 10), localTime: iso.slice(11, 16) };
}

export interface PublishedComputation {
  stats: ComputedStats;
  polyline: string | null;
  cardPolyline: string | null;
  bounds: RouteBounds | null;
  trimStartM: number;
  trimEndM: number;
}

// apply trim to a parsed track and compute everything that gets published.
// zero trim uses the device session totals verbatim (no recompute drift).
export function computePublished(
  parsed: ParsedTrackFile,
  trimStartM: number,
  trimEndM: number
): PublishedComputation {
  const start = Math.max(0, trimStartM);
  const end = Math.max(0, trimEndM);
  const zeroTrim = start === 0 && end === 0;

  const { kept, keptCum } = zeroTrim
    ? { kept: parsed.records, keptCum: parsed.cumDist }
    : trimByDistance(parsed.records, parsed.cumDist, start, end);

  const stats: ComputedStats =
    zeroTrim && parsed.sessionStats ? parsed.sessionStats : computeStats(kept, keptCum);

  const gpsPoints: [number, number][] = [];
  for (const r of kept) {
    if (r.lat !== null && r.lng !== null) gpsPoints.push([r.lat, r.lng]);
  }

  if (gpsPoints.length < 2) {
    return { stats, polyline: null, cardPolyline: null, bounds: null, trimStartM: start, trimEndM: end };
  }

  const detail = rdpReduce(gpsPoints, DETAIL_POLYLINE_MAX_POINTS);
  const card = rdpReduce(gpsPoints, CARD_POLYLINE_MAX_POINTS);
  return {
    stats,
    polyline: encodePolyline(detail),
    cardPolyline: encodePolyline(card),
    bounds: boundsOf(detail),
    trimStartM: start,
    trimEndM: end,
  };
}

export interface ActivityMeta {
  name: string;
  description?: string | null;
  sportType?: string; // overrides the parsed sport when set
  gear?: string | null;
  source?: string;
  externalId?: string | null;
  sufferScore?: number | null;
  fitBlobUrl?: string | null;
  fitBlobPathname?: string | null;
  fitSha256?: string | null;
  // when the file lacks local-time info (gpx/tcx), callers supply an offset
  utcOffsetMinFallback?: number;
}

// assemble the full insert row from a parsed file + published computation + meta
export function buildActivityValues(
  parsed: ParsedTrackFile,
  published: PublishedComputation,
  meta: ActivityMeta
): NewActivityRow {
  const utcOffsetMin = parsed.hasLocalTime
    ? parsed.utcOffsetMin
    : meta.utcOffsetMinFallback ?? parsed.utcOffsetMin;
  const { localDate, localTime } = localDateTime(parsed.startDateUtc, utcOffsetMin);

  // dedupe over PRE-trim values so re-uploads collide regardless of trim
  const preTrimElapsed = parsed.sessionStats?.elapsedTimeS
    ?? (parsed.records.length > 0 ? Math.round(parsed.records[parsed.records.length - 1].t) : 0);

  return {
    name: meta.name,
    sportType: meta.sportType ?? parsed.sportType,
    startDateUtc: parsed.startDateUtc,
    localDate,
    localTime,
    utcOffsetMin,
    distanceM: published.stats.distanceM,
    movingTimeS: published.stats.movingTimeS,
    elapsedTimeS: published.stats.elapsedTimeS,
    elevGainM: published.stats.elevGainM,
    avgSpeedMs: published.stats.avgSpeedMs,
    maxSpeedMs: published.stats.maxSpeedMs,
    avgHr: published.stats.avgHr,
    maxHr: published.stats.maxHr,
    avgCadence: published.stats.avgCadence,
    avgWatts: published.stats.avgWatts,
    maxWatts: published.stats.maxWatts,
    kilojoules: parsed.kilojoules,
    description: meta.description ?? null,
    sufferScore: meta.sufferScore ?? null,
    gear: meta.gear ?? null,
    polyline: published.polyline,
    cardPolyline: published.cardPolyline,
    bounds: published.bounds,
    trimStartM: published.trimStartM,
    trimEndM: published.trimEndM,
    fitBlobUrl: meta.fitBlobUrl ?? null,
    fitBlobPathname: meta.fitBlobPathname ?? null,
    fitSha256: meta.fitSha256 ?? null,
    fileType: parsed.fileType,
    source: meta.source ?? "upload",
    externalId: meta.externalId ?? null,
    dedupeKey: dedupeKey(parsed.startDateUtc.getTime() / 1000, preTrimElapsed),
  };
}

export type InsertOutcome =
  | { inserted: true; id: number }
  | { inserted: false; id: number } // dedupe conflict — existing row
  | { inserted: false; id: null }; // conflict but existing row unreadable

// insert-only, conflict-do-nothing: the ws0 lesson enforced at the write path
export async function insertActivity(values: NewActivityRow): Promise<InsertOutcome> {
  const db = getDb();
  const rows = await db
    .insert(activities)
    .values(values)
    .onConflictDoNothing({ target: activities.dedupeKey })
    .returning({ id: activities.id });
  if (rows.length > 0) {
    return { inserted: true, id: rows[0].id };
  }
  const existing = await db
    .select({ id: activities.id })
    .from(activities)
    .where(eq(activities.dedupeKey, values.dedupeKey))
    .limit(1);
  return { inserted: false, id: existing[0]?.id ?? null };
}

export async function findByDedupeKey(key: string): Promise<{ id: number; name: string; localDate: string } | null> {
  const db = getDb();
  const rows = await db
    .select({ id: activities.id, name: activities.name, localDate: activities.localDate })
    .from(activities)
    .where(eq(activities.dedupeKey, key))
    .limit(1);
  return rows[0] ?? null;
}

// map a db row onto the CalendarActivity interface ActivityCalendar already consumes
export function rowToCalendarActivity(row: ActivityRow): CalendarActivity {
  return {
    id: row.id,
    name: row.name,
    type: row.sportType,
    date: row.localDate,
    startTime: row.localTime,
    distance: row.distanceM,
    duration: row.movingTimeS,
    elapsedTime: row.elapsedTimeS,
    totalElevationGain: row.elevGainM,
    averageSpeed: row.avgSpeedMs,
    maxSpeed: row.maxSpeedMs,
    averageHeartrate: row.avgHr,
    maxHeartrate: row.maxHr,
    averageCadence: row.avgCadence,
    averageWatts: row.avgWatts,
    maxWatts: row.maxWatts,
    kilojoules: row.kilojoules,
    description: row.description,
    sufferScore: row.sufferScore,
  };
}
