// privacy zone crud (server-only). geometry is never edited in place: a shape
// change inserts a new row (replaces_id = old id) and archives the old one, so
// every earlier shape stays restorable. name/enabled change in place. nothing
// is ever deleted. callers mark the returned `touched` polygons stale.
//
// neon-http has no transactions, so every multi-step change orders its writes
// so a partial failure leaves extra fog active (two versions), never none.

import { asc, eq, inArray } from "drizzle-orm";
import { getDb, privacyZones, type PrivacyZoneRow } from "../db";
import { isValidPolygon } from "./fog";

export const MAX_ZONE_RINGS = 10;
export const MAX_RING_VERTICES = 500;
export const MAX_ZONE_NAME = 100;

export class ZoneError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export type ZoneRow = Pick<
  PrivacyZoneRow,
  "id" | "name" | "polygon" | "enabled" | "replacesId" | "archivedAt" | "createdAt" | "updatedAt"
>;

// every version of one zone, newest first; `active` is the version in effect
// (null when the whole zone is archived)
export interface ZoneGroup {
  rootId: number;
  active: ZoneRow | null;
  versions: ZoneRow[];
}

// ---------------------------------------------------------------------------
// pure

const round7 = (v: number) => Math.round(v * 1e7) / 1e7;

function cross(o: number[], a: number[], b: number[]) {
  return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
}

function segmentsCross(p1: number[], p2: number[], p3: number[], p4: number[]): boolean {
  const d1 = cross(p3, p4, p1), d2 = cross(p3, p4, p2), d3 = cross(p1, p2, p3), d4 = cross(p1, p2, p4);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
  const on = (a: number[], b: number[], c: number[]) =>
    Math.min(a[0], b[0]) <= c[0] && c[0] <= Math.max(a[0], b[0]) && Math.min(a[1], b[1]) <= c[1] && c[1] <= Math.max(a[1], b[1]);
  return (d1 === 0 && on(p3, p4, p1)) || (d2 === 0 && on(p3, p4, p2)) || (d3 === 0 && on(p1, p2, p3)) || (d4 === 0 && on(p1, p2, p4));
}

// a ring (open, no closing vertex) whose edges cross itself: even-odd would
// leave parts of the drawn shape outside the zone
export function ringSelfIntersects(ring: number[][]): boolean {
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (j === i + 1 || (i === 0 && j === n - 1)) continue; // neighbours share a vertex
      if (segmentsCross(ring[i], ring[(i + 1) % n], ring[j], ring[(j + 1) % n])) return true;
    }
  }
  return false;
}

function ringArea(ring: number[][]): number {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % ring.length];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a) / 2;
}

// anything posted → a clean closed polygon, or an error message
export function normalizePolygon(raw: unknown): { polygon: number[][][] } | { error: string } {
  if (!isValidPolygon(raw)) return { error: "polygon must be rings of [lng, lat] with at least 3 points" };
  if (raw.length > MAX_ZONE_RINGS) return { error: `at most ${MAX_ZONE_RINGS} rings` };
  const out: number[][][] = [];
  for (const ring of raw) {
    const pts: number[][] = [];
    for (const p of ring) {
      const q = [round7(p[0]), round7(p[1])];
      const prev = pts[pts.length - 1];
      if (!prev || prev[0] !== q[0] || prev[1] !== q[1]) pts.push(q);
    }
    while (pts.length > 1 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1]) pts.pop();
    if (pts.length < 3) return { error: "each ring needs at least 3 distinct points" };
    if (pts.length > MAX_RING_VERTICES) return { error: `at most ${MAX_RING_VERTICES} points per ring` };
    if (ringArea(pts) < 1e-12) return { error: "ring has no area" };
    if (ringSelfIntersects(pts)) return { error: "ring crosses itself" };
    out.push([...pts, [...pts[0]]]);
  }
  return { polygon: out };
}

export function normalizeName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  return raw.trim().slice(0, MAX_ZONE_NAME);
}

const samePolygon = (a: number[][][], b: number[][][]) => JSON.stringify(a) === JSON.stringify(b);

export interface ZonePatch {
  name?: string;
  enabled?: boolean;
  polygon?: number[][][]; // already normalized
}

export interface UpdatePlan {
  set: { name?: string; enabled?: boolean } | null; // in place on the current row
  insert: { name: string; polygon: number[][][]; enabled: boolean; replacesId: number } | null;
  archiveId: number | null;
}

// a shape change → new version + archive the old; otherwise in place
export function planUpdate(current: ZoneRow, patch: ZonePatch): UpdatePlan {
  if (current.archivedAt) throw new ZoneError(409, "zone is archived — restore it first");
  const name = patch.name ?? current.name;
  const enabled = patch.enabled ?? current.enabled;
  if (patch.polygon && !samePolygon(patch.polygon, current.polygon)) {
    return { set: null, insert: { name, polygon: patch.polygon, enabled, replacesId: current.id }, archiveId: current.id };
  }
  const set: UpdatePlan["set"] = {};
  if (name !== current.name) set.name = name;
  if (enabled !== current.enabled) set.enabled = enabled;
  return { set: Object.keys(set).length ? set : null, insert: null, archiveId: null };
}

// rows connected through replaces_id, keyed by the oldest id in the chain
export function lineageRoots(rows: Pick<ZoneRow, "id" | "replacesId">[]): Map<number, number> {
  const parent = new Map<number, number>();
  for (const r of rows) parent.set(r.id, r.id);
  const find = (x: number): number => {
    let p = parent.get(x)!;
    while (p !== parent.get(p)) p = parent.get(p)!;
    parent.set(x, p);
    return p;
  };
  for (const r of rows) {
    if (r.replacesId === null || !parent.has(r.replacesId)) continue;
    const a = find(r.id), b = find(r.replacesId);
    if (a !== b) {
      const lo = Math.min(a, b);
      parent.set(a, lo);
      parent.set(b, lo);
    }
  }
  const out = new Map<number, number>();
  for (const r of rows) out.set(r.id, find(r.id));
  return out;
}

export function groupZones(rows: ZoneRow[]): ZoneGroup[] {
  const roots = lineageRoots(rows);
  const byRoot = new Map<number, ZoneRow[]>();
  for (const r of rows) {
    const root = roots.get(r.id)!;
    byRoot.set(root, [...(byRoot.get(root) ?? []), r]);
  }
  return [...byRoot.entries()]
    .map(([rootId, versions]) => {
      versions.sort((a, b) => b.id - a.id);
      return { rootId, active: versions.find((v) => !v.archivedAt) ?? null, versions };
    })
    .sort((a, b) => a.rootId - b.rootId);
}

export interface RestorePlan {
  unarchiveId: number;
  archiveIds: number[]; // other active versions of the same zone
}

// unarchive the target; any other active version of the same zone (e.g. the
// row that replaced it) is archived so only one version is in effect
export function planRestore(target: ZoneRow, rows: ZoneRow[]): RestorePlan {
  if (!target.archivedAt) throw new ZoneError(409, "zone is not archived");
  const roots = lineageRoots(rows);
  const root = roots.get(target.id) ?? target.id;
  const archiveIds = rows.filter((r) => r.id !== target.id && !r.archivedAt && roots.get(r.id) === root).map((r) => r.id);
  return { unarchiveId: target.id, archiveIds };
}

// ---------------------------------------------------------------------------
// io

const columns = {
  id: privacyZones.id,
  name: privacyZones.name,
  polygon: privacyZones.polygon,
  enabled: privacyZones.enabled,
  replacesId: privacyZones.replacesId,
  archivedAt: privacyZones.archivedAt,
  createdAt: privacyZones.createdAt,
  updatedAt: privacyZones.updatedAt,
};

async function allRows(): Promise<ZoneRow[]> {
  return getDb().select(columns).from(privacyZones).orderBy(asc(privacyZones.id));
}

async function loadZone(id: number): Promise<ZoneRow> {
  const rows = await getDb().select(columns).from(privacyZones).where(eq(privacyZones.id, id)).limit(1);
  if (!rows[0]) throw new ZoneError(404, "zone not found");
  return rows[0];
}

export interface ZoneMutation {
  zone: ZoneRow;
  touched: number[][][][]; // every geometry whose fog may have changed
}

export async function listZones(): Promise<ZoneGroup[]> {
  return groupZones(await allRows());
}

export async function createZone(name: string, polygon: number[][][]): Promise<ZoneMutation> {
  const rows = await getDb().insert(privacyZones).values({ name, polygon, enabled: true }).returning(columns);
  return { zone: rows[0], touched: [polygon] };
}

export async function updateZone(id: number, patch: ZonePatch): Promise<ZoneMutation> {
  const db = getDb();
  const current = await loadZone(id);
  const plan = planUpdate(current, patch);
  const now = new Date();
  if (plan.insert) {
    // new version first: if archiving the old one fails, both stay active
    const rows = await db.insert(privacyZones).values(plan.insert).returning(columns);
    await db.update(privacyZones).set({ archivedAt: now, updatedAt: now }).where(eq(privacyZones.id, plan.archiveId!));
    return { zone: rows[0], touched: [current.polygon, plan.insert.polygon] };
  }
  if (plan.set) {
    const rows = await db
      .update(privacyZones)
      .set({ ...plan.set, updatedAt: now })
      .where(eq(privacyZones.id, id))
      .returning(columns);
    return { zone: rows[0], touched: [current.polygon] };
  }
  return { zone: current, touched: [] };
}

export async function archiveZone(id: number): Promise<ZoneMutation> {
  const current = await loadZone(id);
  if (current.archivedAt) return { zone: current, touched: [] };
  const now = new Date();
  const rows = await getDb()
    .update(privacyZones)
    .set({ archivedAt: now, updatedAt: now })
    .where(eq(privacyZones.id, id))
    .returning(columns);
  return { zone: rows[0], touched: [current.polygon] };
}

export async function restoreZone(id: number): Promise<ZoneMutation> {
  const db = getDb();
  const all = await allRows();
  const target = all.find((r) => r.id === id);
  if (!target) throw new ZoneError(404, "zone not found");
  const plan = planRestore(target, all);
  const now = new Date();
  // unarchive first: a failure in between leaves two versions active, not none
  const rows = await db
    .update(privacyZones)
    .set({ archivedAt: null, updatedAt: now })
    .where(eq(privacyZones.id, plan.unarchiveId))
    .returning(columns);
  if (plan.archiveIds.length) {
    await db.update(privacyZones).set({ archivedAt: now, updatedAt: now }).where(inArray(privacyZones.id, plan.archiveIds));
  }
  const archived = all.filter((r) => plan.archiveIds.includes(r.id)).map((r) => r.polygon);
  return { zone: rows[0], touched: [target.polygon, ...archived] };
}
