// staleness marking (server-only): zone/settings changes only flag activities;
// the rebuild job (rebuild.ts) republishes them and republish clears the flag.

import { and, eq, isNotNull, isNull, lt, or, sql, type SQL } from "drizzle-orm";
import { getDb, activities, type RouteBounds } from "../db";
import { PROCESSING_VERSION } from "../republish";
import { boundsIntersect, polygonBounds } from "./fog";

// ---------------------------------------------------------------------------
// pure

export function zoneBoundsList(polygons: number[][][][]): RouteBounds[] {
  return polygons.map(polygonBounds).filter((b): b is RouteBounds => b !== null);
}

export interface StaleCandidate {
  trackBbox: RouteBounds | null;
  polyline: string | null;
  fitSha256: string | null;
}

// js mirror of staleWhere: a known track bbox overlapping any zone, or a route
// whose track bbox isn't known yet (never republished since bboxes existed)
export function isStaleCandidate(row: StaleCandidate, bounds: RouteBounds[]): boolean {
  if (row.trackBbox) return bounds.some((b) => boundsIntersect(row.trackBbox!, b));
  return row.polyline !== null || row.fitSha256 !== null;
}

const bboxField = (k: keyof RouteBounds) => sql`(${activities.trackBbox}->>${k})::double precision`;

export function staleWhere(bounds: RouteBounds[]): SQL {
  const unknownBbox = and(isNull(activities.trackBbox), or(isNotNull(activities.polyline), isNotNull(activities.fitSha256)))!;
  const overlaps = bounds.map(
    (b) => sql`(${bboxField("minLat")} <= ${b.maxLat} and ${bboxField("maxLat")} >= ${b.minLat} and ${bboxField("minLng")} <= ${b.maxLng} and ${bboxField("maxLng")} >= ${b.minLng})`
  );
  const known = overlaps.length ? and(isNotNull(activities.trackBbox), or(...overlaps))! : null;
  return known ? or(known, unknownBbox)! : unknownBbox;
}

export const pendingWhere = (): SQL => or(eq(activities.needsRepublish, true), lt(activities.processingVersion, PROCESSING_VERSION))!;

// ---------------------------------------------------------------------------
// io

// pass old AND new geometry on edits; returns how many rows were newly flagged
export async function markStaleForZones(polygons: number[][][][]): Promise<number> {
  if (polygons.length === 0) return 0;
  const rows = await getDb()
    .update(activities)
    .set({ needsRepublish: true })
    .where(and(eq(activities.needsRepublish, false), staleWhere(zoneBoundsList(polygons))))
    .returning({ id: activities.id });
  return rows.length;
}

// settings apply to every activity
export async function markAllStale(): Promise<number> {
  const rows = await getDb()
    .update(activities)
    .set({ needsRepublish: true })
    .where(eq(activities.needsRepublish, false))
    .returning({ id: activities.id });
  return rows.length;
}

export async function countPending(): Promise<number> {
  const rows = await getDb()
    .select({ n: sql<number>`count(*)::int` })
    .from(activities)
    .where(pendingWhere());
  return Number(rows[0]?.n ?? 0);
}
