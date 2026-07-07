// pure geo math for track processing: haversine, cumulative distance, trim,
// stat recompute, douglas-peucker, bounds. no deps, runs in routes and scripts.

import type { RouteBounds } from "./db/schema";

// one normalized sample from a fit/gpx/tcx file. t = seconds since first record.
export interface TrackRecord {
  lat: number | null;
  lng: number | null;
  t: number;
  ele: number | null;
  hr: number | null;
  cadence: number | null;
  watts: number | null;
  speed: number | null; // m/s, device-reported when available
}

export interface ComputedStats {
  distanceM: number;
  movingTimeS: number;
  elapsedTimeS: number;
  elevGainM: number;
  avgSpeedMs: number;
  maxSpeedMs: number;
  avgHr: number | null;
  maxHr: number | null;
  avgCadence: number | null;
  avgWatts: number | null;
  maxWatts: number | null;
}

const EARTH_RADIUS_M = 6371008.8;

export function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLng = (lng2 - lng1) * toRad;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a));
}

// cumulative distance per record; records without gps carry the previous value
export function cumulativeDistances(records: TrackRecord[]): number[] {
  const out = new Array<number>(records.length);
  let cum = 0;
  let prev: { lat: number; lng: number } | null = null;
  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    if (r.lat !== null && r.lng !== null) {
      if (prev) {
        cum += haversineM(prev.lat, prev.lng, r.lat, r.lng);
      }
      prev = { lat: r.lat, lng: r.lng };
    }
    out[i] = cum;
  }
  return out;
}

// keep records whose cumulative distance falls inside [trimStartM, total - trimEndM].
// returns the kept slice (same array objects, not copies).
export function trimByDistance(
  records: TrackRecord[],
  cumDist: number[],
  trimStartM: number,
  trimEndM: number
): { kept: TrackRecord[]; keptCum: number[] } {
  if (records.length === 0) return { kept: [], keptCum: [] };
  const total = cumDist[cumDist.length - 1];
  // clamp: never trim away more than the whole track
  const start = Math.max(0, Math.min(trimStartM, total));
  const end = Math.max(0, Math.min(trimEndM, total - start));
  const lo = start;
  const hi = total - end;
  const kept: TrackRecord[] = [];
  const keptCum: number[] = [];
  for (let i = 0; i < records.length; i++) {
    if (cumDist[i] >= lo && cumDist[i] <= hi) {
      kept.push(records[i]);
      keptCum.push(cumDist[i]);
    }
  }
  return { kept, keptCum };
}

// moving time: sum of consecutive time deltas ≤ 10 s (larger gaps are pauses)
const MOVING_GAP_MAX_S = 10;

// elevation gain: 5-sample moving average, then sum of positive deltas
function elevationGain(records: TrackRecord[]): number {
  const eles = records.map((r) => r.ele).filter((e): e is number => e !== null);
  if (eles.length < 2) return 0;
  const smoothed: number[] = [];
  for (let i = 0; i < eles.length; i++) {
    const lo = Math.max(0, i - 2);
    const hi = Math.min(eles.length - 1, i + 2);
    let sum = 0;
    for (let j = lo; j <= hi; j++) sum += eles[j];
    smoothed.push(sum / (hi - lo + 1));
  }
  let gain = 0;
  for (let i = 1; i < smoothed.length; i++) {
    const d = smoothed[i] - smoothed[i - 1];
    if (d > 0) gain += d;
  }
  return gain;
}

function meanOf(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function computeStats(records: TrackRecord[], cumDist: number[]): ComputedStats {
  if (records.length === 0) {
    return {
      distanceM: 0, movingTimeS: 0, elapsedTimeS: 0, elevGainM: 0,
      avgSpeedMs: 0, maxSpeedMs: 0, avgHr: null, maxHr: null,
      avgCadence: null, avgWatts: null, maxWatts: null,
    };
  }
  const distanceM = cumDist[cumDist.length - 1] - cumDist[0];
  const elapsedTimeS = records[records.length - 1].t - records[0].t;

  let movingTimeS = 0;
  for (let i = 1; i < records.length; i++) {
    const dt = records[i].t - records[i - 1].t;
    if (dt > 0 && dt <= MOVING_GAP_MAX_S) movingTimeS += dt;
  }

  const hrs = records.map((r) => r.hr).filter((v): v is number => v !== null);
  const cads = records.map((r) => r.cadence).filter((v): v is number => v !== null);
  const watts = records.map((r) => r.watts).filter((v): v is number => v !== null);
  const speeds = records.map((r) => r.speed).filter((v): v is number => v !== null);

  const avgSpeedMs = movingTimeS > 0 ? distanceM / movingTimeS : 0;
  const maxSpeedMs = speeds.length > 0 ? Math.max(...speeds) : 0;

  return {
    distanceM,
    movingTimeS: Math.round(movingTimeS),
    elapsedTimeS: Math.round(elapsedTimeS),
    elevGainM: elevationGain(records),
    avgSpeedMs,
    maxSpeedMs,
    avgHr: meanOf(hrs),
    maxHr: hrs.length > 0 ? Math.max(...hrs) : null,
    avgCadence: meanOf(cads),
    avgWatts: meanOf(watts),
    maxWatts: watts.length > 0 ? Math.max(...watts) : null,
  };
}

// perpendicular distance from point to segment, in the same lat/lng-degree space
// used only for rdp shape comparison (equirectangular-ish is fine at track scale)
function perpDist(p: [number, number], a: [number, number], b: [number, number]): number {
  const [px, py] = [p[1], p[0]];
  const [ax, ay] = [a[1], a[0]];
  const [bx, by] = [b[1], b[0]];
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - ax, py - ay);
  let u = ((px - ax) * dx + (py - ay) * dy) / lenSq;
  u = Math.max(0, Math.min(1, u));
  return Math.hypot(px - (ax + u * dx), py - (ay + u * dy));
}

function rdpWithEpsilon(points: [number, number][], epsilon: number): [number, number][] {
  if (points.length <= 2) return points.slice();
  const keep = new Array<boolean>(points.length).fill(false);
  keep[0] = keep[points.length - 1] = true;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [lo, hi] = stack.pop()!;
    let maxD = 0;
    let maxI = -1;
    for (let i = lo + 1; i < hi; i++) {
      const d = perpDist(points[i], points[lo], points[hi]);
      if (d > maxD) {
        maxD = d;
        maxI = i;
      }
    }
    if (maxD > epsilon && maxI !== -1) {
      keep[maxI] = true;
      stack.push([lo, maxI], [maxI, hi]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

// douglas-peucker reduced to ≤ maxPoints via binary search on epsilon
export function rdpReduce(points: [number, number][], maxPoints: number): [number, number][] {
  if (points.length <= maxPoints) return points.slice();
  let lo = 1e-7; // ~1 cm in degrees
  let hi = 1; // ~110 km — collapses anything
  let best = rdpWithEpsilon(points, hi);
  for (let iter = 0; iter < 30; iter++) {
    const mid = (lo + hi) / 2;
    const reduced = rdpWithEpsilon(points, mid);
    if (reduced.length > maxPoints) {
      lo = mid;
    } else {
      best = reduced;
      hi = mid;
    }
    if (reduced.length === maxPoints) break;
  }
  return best;
}

export function boundsOf(points: [number, number][]): RouteBounds | null {
  if (points.length === 0) return null;
  let minLat = Infinity, minLng = Infinity, maxLat = -Infinity, maxLng = -Infinity;
  for (const [lat, lng] of points) {
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
  }
  return { minLat, minLng, maxLat, maxLng };
}
