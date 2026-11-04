// staleness marking (server-only): zone/settings changes only flag activities;
// the rebuild job (rebuild.ts) republishes them and republish clears the flag.
// every mark also stamps stale_marked_at, so a republish that started before
// the mark (and so read the old zones) leaves the flag set.

import { and, eq, isNotNull, isNull, lt, or, sql, type SQL } from "drizzle-orm";
import { getDb, activities, type RouteBounds } from "../db";
import { PROCESSING_VERSION } from "../republish";
import { RELEVANCE_MARGIN_M, boundsIntersect, expandBounds, polygonBounds } from "./fog";

// ---------------------------------------------------------------------------
// pure

export function zoneBoundsList(polygons: number[][][][]): RouteBounds[] {
  return polygons.map(polygonBounds).filter((b): b is RouteBounds => b !== null);
}

// zone bounds grown by the relevance margin: pins snap up to 75 m and the edge
// buffer is 15 m, so a zone just outside a track's bbox can still change it
export const relevanceBounds = (bounds: RouteBounds[]): RouteBounds[] =>
  bounds.map((b) => expandBounds(b, RELEVANCE_MARGIN_M));

export interface StaleCandidate {
  trackBbox: RouteBounds | null;
  polyline: string | null;
  fitSha256: string | null;
}

// js mirror of staleWhere: a known track bbox within the margin of any zone, or
// a route whose track bbox isn't known yet (never republished since bboxes existed)
export function isStaleCandidate(row: StaleCandidate, bounds: RouteBounds[]): boolean {
  if (row.trackBbox) return relevanceBounds(bounds).some((b) => boundsIntersect(row.trackBbox!, b));
  return row.polyline !== null || row.fitSha256 !== null;
}

const bboxField = (k: keyof RouteBounds) => sql`(${activities.trackBbox}->>${k})::double precision`;

export function staleWhere(bounds: RouteBounds[]): SQL {
  const unknownBbox = and(isNull(activities.trackBbox), or(isNotNull(activities.polyline), isNotNull(activities.fitSha256)))!;
  const overlaps = relevanceBounds(bounds).map(
    (b) => sql`(${bboxField("minLat")} <= ${b.maxLat} and ${bboxField("maxLat")} >= ${b.minLat} and ${bboxField("minLng")} <= ${b.maxLng} and ${bboxField("maxLng")} >= ${b.minLng})`
  );
  const known = overlaps.length ? and(isNotNull(activities.trackBbox), or(...overlaps))! : null;
  return known ? or(known, unknownBbox)! : unknownBbox;
}

export const pendingWhere = (): SQL => or(eq(activities.needsRepublish, true), lt(activities.processingVersion, PROCESSING_VERSION))!;

// the columns every mark writes. rows already flagged are stamped again: a
// republish in flight must not clear a flag set after it started
export const staleMark = () => ({ needsRepublish: true, staleMarkedAt: new Date() });

// ---------------------------------------------------------------------------
// io

// pass old AND new geometry on edits; returns how many rows were marked
export async function markStaleForZones(polygons: number[][][][]): Promise<number> {
  const bounds = zoneBoundsList(polygons);
  if (bounds.length === 0) return 0;
  const rows = await getDb()
    .update(activities)
    .set(staleMark())
    .where(staleWhere(bounds))
    .returning({ id: activities.id });
  return rows.length;
}

// settings apply to every activity
export async function markAllStale(): Promise<number> {
  const rows = await getDb()
    .update(activities)
    .set(staleMark())
    .where(sql`true`)
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
