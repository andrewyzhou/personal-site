// privacy zones ("fog"): pure geometry, applied only inside republish. points
// inside a zone never reach published output; the route is broken wherever it
// enters a zone or a straight segment between two published points would cross
// one, and each hidden stretch becomes a fog event anchored at the zone edge.
//
// zone polygons are geojson-style rings of [lng, lat]; track points are
// [lat, lng] like everywhere else in the activity code.

import type { FogEvent, RouteBounds } from "../db/schema";
import { haversineM } from "../geo";

export interface ZoneInput {
  id: number;
  polygon: number[][][];
}

export interface FogSample {
  lat: number;
  lng: number;
  t: number; // seconds
}

// even-odd over every ring, so inner rings act as holes. a point exactly on
// any ring edge counts as inside (the conservative side for privacy).
export function pointInPolygon(lat: number, lng: number, polygon: number[][][]): boolean {
  let inside = false;
  for (const ring of polygon) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if (onEdge(lng, lat, xi, yi, xj, yj)) return true;
      if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

function onEdge(x: number, y: number, x1: number, y1: number, x2: number, y2: number): boolean {
  const cross = (x2 - x1) * (y - y1) - (y2 - y1) * (x - x1);
  const scale = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1), 1e-12);
  if (Math.abs(cross) > 1e-12 * scale) return false;
  return Math.min(x1, x2) - 1e-12 <= x && x <= Math.max(x1, x2) + 1e-12 && Math.min(y1, y2) - 1e-12 <= y && y <= Math.max(y1, y2) + 1e-12;
}

// published coordinates are rounded (polyline precision ~1 m, pins ~10 m), so
// anything this close to a zone edge is treated as inside: a rounded copy of a
// point just outside can never land inside
export const ZONE_EDGE_BUFFER_M = 15;

// distance in metres from a point to a polygon's edges (equirectangular, fine
// at zone scale)
export function distanceToPolygonEdgeM(lat: number, lng: number, polygon: number[][][]): number {
  const kx = 111320 * Math.cos((lat * Math.PI) / 180);
  const ky = 110540;
  let best = Infinity;
  for (const ring of polygon) {
    for (let i = 0; i < ring.length; i++) {
      const [ax, ay] = ring[i];
      const [bx, by] = ring[(i + 1) % ring.length];
      const x1 = (ax - lng) * kx, y1 = (ay - lat) * ky, x2 = (bx - lng) * kx, y2 = (by - lat) * ky;
      const dx = x2 - x1, dy = y2 - y1;
      const len = dx * dx + dy * dy;
      const u = len === 0 ? 0 : Math.max(0, Math.min(1, -(x1 * dx + y1 * dy) / len));
      best = Math.min(best, Math.hypot(x1 + u * dx, y1 + u * dy));
    }
  }
  return best;
}

export function zonesContaining(lat: number, lng: number, zones: ZoneInput[], bufferM = ZONE_EDGE_BUFFER_M): ZoneInput[] {
  return zones.filter(
    (z) => pointInPolygon(lat, lng, z.polygon) || (bufferM > 0 && distanceToPolygonEdgeM(lat, lng, z.polygon) <= bufferM)
  );
}

// proper or touching intersection of segments p1p2 and p3p4 (x = lng, y = lat)
function segmentsIntersect(p1: number[], p2: number[], p3: number[], p4: number[]): boolean {
  const d = (a: number[], b: number[], c: number[]) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const onSeg = (a: number[], b: number[], c: number[]) =>
    Math.min(a[0], b[0]) <= c[0] && c[0] <= Math.max(a[0], b[0]) && Math.min(a[1], b[1]) <= c[1] && c[1] <= Math.max(a[1], b[1]);
  const d1 = d(p3, p4, p1);
  const d2 = d(p3, p4, p2);
  const d3 = d(p1, p2, p3);
  const d4 = d(p1, p2, p4);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
  if (d1 === 0 && onSeg(p3, p4, p1)) return true;
  if (d2 === 0 && onSeg(p3, p4, p2)) return true;
  if (d3 === 0 && onSeg(p1, p2, p3)) return true;
  if (d4 === 0 && onSeg(p1, p2, p4)) return true;
  return false;
}

// would drawing a straight line between two points show anything inside the zone
export function segmentTouchesPolygon(a: [number, number], b: [number, number], polygon: number[][][]): boolean {
  if (pointInPolygon(a[0], a[1], polygon) || pointInPolygon(b[0], b[1], polygon)) return true;
  const p1 = [a[1], a[0]];
  const p2 = [b[1], b[0]];
  for (const ring of polygon) {
    for (let i = 0; i < ring.length; i++) {
      if (segmentsIntersect(p1, p2, ring[i], ring[(i + 1) % ring.length])) return true;
    }
  }
  return false;
}

export function polygonBounds(polygon: number[][][]): RouteBounds | null {
  let minLat = Infinity, minLng = Infinity, maxLat = -Infinity, maxLng = -Infinity;
  for (const ring of polygon) {
    for (const [lng, lat] of ring) {
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
    }
  }
  return Number.isFinite(minLat) ? { minLat, minLng, maxLat, maxLng } : null;
}

export function boundsIntersect(a: RouteBounds, b: RouteBounds): boolean {
  return a.minLat <= b.maxLat && b.minLat <= a.maxLat && a.minLng <= b.maxLng && b.minLng <= a.maxLng;
}

// zones whose bounds overlap the track's: the only ones that can affect it
export function relevantZones(zones: ZoneInput[], trackBbox: RouteBounds | null): ZoneInput[] {
  if (!trackBbox) return zones;
  return zones.filter((z) => {
    const zb = polygonBounds(z.polygon);
    return zb !== null && boundsIntersect(zb, trackBbox);
  });
}

export function isValidPolygon(polygon: unknown): polygon is number[][][] {
  if (!Array.isArray(polygon) || polygon.length === 0) return false;
  return polygon.every(
    (ring) =>
      Array.isArray(ring) &&
      ring.length >= 3 &&
      ring.every(
        (p) =>
          Array.isArray(p) &&
          p.length >= 2 &&
          typeof p[0] === "number" && typeof p[1] === "number" &&
          Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 90
      )
  );
}

export interface FogResult {
  segments: FogSample[][]; // visible runs, in order (each ≥ 1 point)
  events: FogEvent[];
  touchedZoneIds: number[];
  visibleDistanceM: number;
}

const roundMinute = (s: number) => Math.max(60, Math.round(s / 60) * 60);

// split a (trimmed) gps track into visible runs around the zones
export function applyFog(samples: FogSample[], zones: ZoneInput[]): FogResult {
  const segments: FogSample[][] = [];
  const events: FogEvent[] = [];
  const touched = new Set<number>();
  if (zones.length === 0) {
    return { segments: samples.length ? [samples.slice()] : [], events, touchedZoneIds: [], visibleDistanceM: runDistance(samples) };
  }

  let current: FogSample[] = [];
  let lastVisible: FogSample | null = null;
  // set while inside the fog: the time the hidden stretch started
  let fogFrom: { t: number; entry: FogSample | null } | null = null;
  const firstT = samples[0]?.t ?? 0;

  const closeRun = () => {
    if (current.length > 0) segments.push(current);
    current = [];
  };

  for (const s of samples) {
    const inZones = zonesContaining(s.lat, s.lng, zones);
    if (inZones.length > 0) {
      for (const z of inZones) touched.add(z.id);
      if (!fogFrom) {
        closeRun();
        fogFrom = { t: lastVisible?.t ?? firstT, entry: lastVisible };
      }
      continue;
    }
    if (fogFrom) {
      events.push({
        entry: fogFrom.entry ? [fogFrom.entry.lat, fogFrom.entry.lng] : null,
        exit: [s.lat, s.lng],
        durationS: roundMinute(s.t - fogFrom.t),
      });
      fogFrom = null;
    } else if (lastVisible) {
      // both ends outside, but the straight line between them crosses a zone
      const crossed = zones.filter((z) => segmentTouchesPolygon([lastVisible!.lat, lastVisible!.lng], [s.lat, s.lng], z.polygon));
      if (crossed.length > 0) {
        for (const z of crossed) touched.add(z.id);
        closeRun();
        events.push({
          entry: [lastVisible.lat, lastVisible.lng],
          exit: [s.lat, s.lng],
          durationS: roundMinute(s.t - lastVisible.t),
        });
      }
    }
    current.push(s);
    lastVisible = s;
  }
  if (fogFrom) {
    const lastT = samples[samples.length - 1].t;
    events.push({ entry: fogFrom.entry ? [fogFrom.entry.lat, fogFrom.entry.lng] : null, exit: null, durationS: roundMinute(lastT - fogFrom.t) });
  }
  closeRun();

  return {
    segments,
    events,
    touchedZoneIds: [...touched].sort((a, b) => a - b),
    visibleDistanceM: segments.reduce((sum, seg) => sum + runDistance(seg), 0),
  };
}

function runDistance(run: FogSample[]): number {
  let d = 0;
  for (let i = 1; i < run.length; i++) d += haversineM(run[i - 1].lat, run[i - 1].lng, run[i].lat, run[i].lng);
  return d;
}

// the public shape of a zone: outer ring only (holes would describe the inside),
// vertices rounded to ~10 m
export function publicZoneShape(polygon: number[][][]): number[][][] {
  const r = (v: number) => Math.round(v * 1e4) / 1e4;
  return polygon.length ? [polygon[0].map(([lng, lat]) => [r(lng), r(lat)])] : [];
}
