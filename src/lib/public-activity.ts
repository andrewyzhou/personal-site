// the one place an activity row becomes public data. every public surface
// (pages, /api/activities*, caches, thumbnails) goes through here, so the
// per-activity visibility switches apply everywhere and are always reversible:
//   private  → hidden (never served)
//   hide map → no route, bounds, fog shapes/points or photo pins
//   hide hr  → no heart rate (or the hr-derived effort score)
// the published start time is the (possibly coarsened) one written by republish.
// private columns (track_bbox, raw start time, fit_* paths, sources) never leave.

import type { ActivityRow, FogEvent, RouteBounds } from "./db/schema";
import type { CalendarActivity } from "./strava";

export type Visibility = "public" | "hide-map" | "private";

export function visibilityOf(row: Pick<ActivityRow, "hidden" | "mapHidden">): Visibility {
  if (row.hidden) return "private";
  return row.mapHidden ? "hide-map" : "public";
}

// the columns behind a visibility choice (hr is a separate switch)
export function visibilityColumns(v: Visibility): { hidden: boolean; mapHidden: boolean } {
  return { hidden: v === "private", mapHidden: v === "hide-map" };
}

export function isPublic(row: Pick<ActivityRow, "hidden">): boolean {
  return !row.hidden;
}

export function publicStartUtc(row: Pick<ActivityRow, "publishedStartUtc" | "startDateUtc">): Date {
  return row.publishedStartUtc ?? row.startDateUtc;
}

export function publicLocalTime(row: Pick<ActivityRow, "publishedLocalTime" | "localTime">): string {
  return row.publishedLocalTime ?? row.localTime;
}

export function publicCalendarActivity(row: ActivityRow): CalendarActivity {
  const hr = !row.hrHidden;
  return {
    id: row.id,
    name: row.name,
    type: row.sportType,
    date: row.localDate,
    startTime: publicLocalTime(row),
    distance: row.distanceM,
    duration: row.movingTimeS,
    elapsedTime: row.elapsedTimeS,
    totalElevationGain: row.elevGainM,
    averageSpeed: row.avgSpeedMs,
    maxSpeed: row.maxSpeedMs,
    averageHeartrate: hr ? row.avgHr : null,
    maxHeartrate: hr ? row.maxHr : null,
    averageCadence: row.avgCadence,
    averageWatts: row.avgWatts,
    maxWatts: row.maxWatts,
    kilojoules: row.kilojoules,
    description: row.description,
    sufferScore: hr ? row.sufferScore : null,
  };
}

export interface PublicRoute {
  polyline: string | null; // multi-segment (space-separated) encoded polyline
  cardPolyline: string | null;
  bounds: RouteBounds | null;
  fogEvents: FogEvent[] | null;
  fogShapes: number[][][][] | null;
}

export function publicRoute(row: ActivityRow): PublicRoute {
  if (row.mapHidden) return { polyline: null, cardPolyline: null, bounds: null, fogEvents: null, fogShapes: null };
  return {
    polyline: row.polyline,
    cardPolyline: row.cardPolyline,
    bounds: row.bounds,
    fogEvents: row.fogEvents,
    fogShapes: row.fogShapes,
  };
}

// fog events without their edge points (for when the map is hidden but the
// "in the fog · 14 min" line can still be shown)
// (map hidden: nothing about fog at all — not even that a zone was entered)
export function publicFogDurations(row: ActivityRow): number[] {
  if (row.mapHidden) return [];
  return (row.fogEvents ?? []).map((e) => e.durationS);
}

export interface PublicPhotoInput {
  blobUrl: string;
  width: number | null;
  height: number | null;
  caption: string | null;
  pinLat: number | null;
  pinLng: number | null;
}

export interface PublicPhoto {
  url: string;
  width: number | null;
  height: number | null;
  caption: string | null;
  pin: [number, number] | null; // [lat, lng]
}

export function publicPhotos(row: Pick<ActivityRow, "mapHidden">, photos: PublicPhotoInput[]): PublicPhoto[] {
  return photos.map((p) => ({
    url: p.blobUrl,
    width: p.width,
    height: p.height,
    caption: p.caption,
    pin: !row.mapHidden && p.pinLat !== null && p.pinLng !== null ? [p.pinLat, p.pinLng] : null,
  }));
}

export function publicActivityDetail(row: ActivityRow, photos: PublicPhotoInput[]) {
  return {
    ...publicCalendarActivity(row),
    ...publicRoute(row),
    fogDurationsS: publicFogDurations(row),
    gear: row.gear,
    photos: publicPhotos(row, photos),
  };
}
