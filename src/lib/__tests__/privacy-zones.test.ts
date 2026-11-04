import { describe, it, expect, vi, beforeEach } from "vitest";

// fake db: every chain resolves to the next queued result; ops are recorded in order
const { ops, results } = vi.hoisted(() => ({
  ops: [] as { op: string; values?: unknown }[],
  results: [] as unknown[],
}));

vi.mock("../db", () => {
  const chain = (op: string, values?: unknown) => {
    ops.push({ op, values });
    const next = () => Promise.resolve(results.shift() ?? []);
    const c: Record<string, unknown> = {};
    for (const k of ["from", "where", "orderBy", "limit", "returning"]) c[k] = () => c;
    c.set = (v: unknown) => {
      ops[ops.length - 1].values = v;
      return c;
    };
    c.values = (v: unknown) => {
      ops[ops.length - 1].values = v;
      return c;
    };
    c.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => next().then(res, rej);
    return c;
  };
  return {
    privacyZones: { id: "id", name: "name", polygon: "polygon", enabled: "enabled", replacesId: "replacesId", archivedAt: "archivedAt", createdAt: "createdAt", updatedAt: "updatedAt" },
    getDb: () => ({
      select: () => chain("select"),
      insert: () => chain("insert"),
      update: () => chain("update"),
    }),
  };
});

import {
  MAX_RING_VERTICES,
  ZoneError,
  groupZones,
  lineageRoots,
  normalizeName,
  normalizePolygon,
  planRestore,
  planUpdate,
  restoreZone,
  ringSelfIntersects,
  updateZone,
  archiveZone,
  alreadyApplied,
  activeInLineage,
  createZone,
  type ZoneRow,
} from "../privacy/zones";

const sq = (h = 0.01, x = 0, y = 0) => [[[x - h, y - h], [x + h, y - h], [x + h, y + h], [x - h, y + h], [x - h, y - h]]];
const t0 = new Date("2026-01-01T00:00:00Z");
const row = (id: number, over: Partial<ZoneRow> = {}): ZoneRow => ({
  id,
  name: `z${id}`,
  polygon: sq(),
  enabled: true,
  replacesId: null,
  archivedAt: null,
  createdAt: t0,
  updatedAt: t0,
  ...over,
});

beforeEach(() => {
  ops.length = 0;
  results.length = 0;
});

describe("normalizePolygon", () => {
  it("closes open rings, drops duplicate points and extra coordinates", () => {
    const r = normalizePolygon([[[0, 0, 5], [1, 0], [1, 0], [1, 1], [0, 1]]]);
    expect(r).toEqual({ polygon: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] });
  });

  it("keeps an already closed ring closed once", () => {
    const r = normalizePolygon(sq(1));
    expect("polygon" in r && r.polygon[0]).toHaveLength(5);
  });

  it("rejects garbage, too few points, no area, self-crossing and oversized rings", () => {
    expect(normalizePolygon("x")).toHaveProperty("error");
    expect(normalizePolygon([[[0, 0], [1, 1]]])).toHaveProperty("error");
    expect(normalizePolygon([[[0, 0], [0, 0], [0, 0], [1, 1]]])).toHaveProperty("error");
    expect(normalizePolygon([[[0, 0], [1, 1], [2, 2]]])).toEqual({ error: "ring has no area" });
    // bowtie
    expect(normalizePolygon([[[0, 0], [3, 1], [3, 0], [0, 2]]])).toEqual({ error: "ring crosses itself" });
    expect(normalizePolygon([[[200, 0], [1, 1], [1, 0]]])).toHaveProperty("error");
    const big = Array.from({ length: MAX_RING_VERTICES + 1 }, (_, i) => {
      const a = (i / (MAX_RING_VERTICES + 1)) * 2 * Math.PI;
      return [Math.cos(a), Math.sin(a)];
    });
    expect(normalizePolygon([big])).toHaveProperty("error");
    expect(normalizePolygon(Array.from({ length: 11 }, () => sq()[0]))).toHaveProperty("error");
  });

  it("accepts exactly one ring: holes and extra parts are a clear error", () => {
    expect(normalizePolygon([sq(1)[0], sq(0.5)[0]])).toEqual({ error: "a zone must be a single ring (no holes or extra parts)" });
    expect(normalizePolygon([sq(1)[0], sq(1, 5, 5)[0]])).toHaveProperty("error");
    expect(normalizePolygon([])).toHaveProperty("error");
    expect(normalizePolygon(sq(1))).toHaveProperty("polygon");
  });

  it("detects self intersection only for non-adjacent edges", () => {
    expect(ringSelfIntersects([[0, 0], [1, 0], [1, 1], [0, 1]])).toBe(false);
    expect(ringSelfIntersects([[0, 0], [1, 1], [1, 0], [0, 1]])).toBe(true);
  });

  it("names are trimmed strings", () => {
    expect(normalizeName("  home ")).toBe("home");
    expect(normalizeName(3)).toBeNull();
    expect(normalizeName("x".repeat(500))).toHaveLength(100);
  });
});

describe("planUpdate", () => {
  it("a shape change inserts a new version replacing the old and archives it", () => {
    const plan = planUpdate(row(4), { polygon: sq(0.02), name: "new" });
    expect(plan).toEqual({
      set: null,
      insert: { name: "new", polygon: sq(0.02), enabled: true, replacesId: 4 },
      archiveId: 4,
    });
  });

  it("name/enabled change in place; same polygon is not a shape change", () => {
    expect(planUpdate(row(4), { polygon: sq(), enabled: false })).toEqual({ set: { enabled: false }, insert: null, archiveId: null });
    expect(planUpdate(row(4), { name: "z4" })).toEqual({ set: null, insert: null, archiveId: null });
  });

  it("refuses to edit an archived version", () => {
    expect(() => planUpdate(row(4, { archivedAt: t0 }), { name: "x" })).toThrow(ZoneError);
  });
});

describe("lineage / history", () => {
  const rows = [
    row(1, { archivedAt: t0 }),
    row(2, { replacesId: 1, archivedAt: t0 }),
    row(3),
    row(5, { replacesId: 2 }),
    row(7, { archivedAt: t0 }),
  ];

  it("groups versions by chain, newest first, with the active one", () => {
    const g = groupZones(rows);
    expect(g.map((x) => [x.rootId, x.active?.id ?? null, x.versions.map((v) => v.id)])).toEqual([
      [1, 5, [5, 2, 1]],
      [3, 3, [3]],
      [7, null, [7]],
    ]);
    expect(lineageRoots(rows).get(5)).toBe(1);
  });

  it("restoring an old version archives whichever version replaced it", () => {
    expect(planRestore(rows[0], rows)).toEqual({ unarchiveId: 1, archiveIds: [5] });
    expect(planRestore(rows[4], rows)).toEqual({ unarchiveId: 7, archiveIds: [] });
    expect(() => planRestore(rows[2], rows)).toThrow(/not archived/);
  });
});

describe("io ordering", () => {
  it("shape edit: insert the new version before archiving the old; both geometries touched", async () => {
    results.push([row(4)], [row(9, { polygon: sq(0.02), replacesId: 4 })], []);
    const r = await updateZone(4, { polygon: sq(0.02) });
    expect(ops.map((o) => o.op)).toEqual(["select", "insert", "update"]);
    expect(ops[1].values).toMatchObject({ replacesId: 4, polygon: sq(0.02) });
    expect(ops[2].values).toMatchObject({ archivedAt: expect.any(Date) });
    expect(r.zone.id).toBe(9);
    expect(r.touched).toEqual([sq(), sq(0.02)]);
  });

  it("rename updates in place, never inserting", async () => {
    results.push([row(4)], [row(4, { name: "home-ish" })]);
    const r = await updateZone(4, { name: "home-ish" });
    expect(ops.map((o) => o.op)).toEqual(["select", "update"]);
    expect(ops[1].values).toMatchObject({ name: "home-ish" });
    expect(ops[1].values).not.toHaveProperty("polygon");
    expect(r.touched).toEqual([sq()]);
  });

  it("marks every affected geometry stale before the first write", async () => {
    const seen: number[] = [];
    const markStale = vi.fn(async () => void seen.push(ops.length));
    results.push([row(4)], [row(9, { polygon: sq(0.02), replacesId: 4 })], []);
    await updateZone(4, { polygon: sq(0.02) }, { markStale });
    // only the read happened before the mark
    expect(seen).toEqual([1]);
    expect(markStale).toHaveBeenCalledWith([sq(), sq(0.02)]);

    ops.length = 0;
    seen.length = 0;
    markStale.mockClear();
    results.push([row(5)]);
    await createZone("n", sq(0.03), { markStale });
    expect(markStale).toHaveBeenCalledWith([sq(0.03)]);
    expect(seen).toEqual([0]);

    ops.length = 0;
    seen.length = 0;
    markStale.mockClear();
    results.push([row(4)], [row(4, { archivedAt: t0 })]);
    await archiveZone(4, { markStale });
    expect(markStale).toHaveBeenCalledWith([sq()]);
    expect(seen).toEqual([1]);

    ops.length = 0;
    seen.length = 0;
    markStale.mockClear();
    results.push([row(1, { archivedAt: t0 }), row(2, { replacesId: 1, polygon: sq(0.05) })], [row(1)], []);
    await restoreZone(1, { markStale });
    expect(markStale).toHaveBeenCalledWith([sq(), sq(0.05)]);
    expect(seen).toEqual([1]);
  });

  it("a failing pre-mark aborts before anything is written", async () => {
    results.push([row(4)]);
    const markStale = vi.fn(async () => {
      throw new Error("db down");
    });
    await expect(updateZone(4, { polygon: sq(0.02) }, { markStale })).rejects.toThrow("db down");
    expect(ops.map((o) => o.op)).toEqual(["select"]);
  });

  it("a retried shape edit returns the version it already made instead of forking", async () => {
    // first attempt fully succeeded: 4 archived, 9 active with the new shape
    results.push([row(4, { archivedAt: t0 }), row(9, { polygon: sq(0.02), replacesId: 4 })]);
    const r = await updateZone(4, { polygon: sq(0.02) });
    expect(r.zone.id).toBe(9);
    expect(ops.map((o) => o.op)).toEqual(["select"]);
    expect(r.touched).toEqual([sq(0.02)]);
  });

  it("a retry after a failed archive step finishes it and never inserts", async () => {
    // first attempt inserted 9 but failed archiving 4: both active
    results.push([row(4), row(9, { polygon: sq(0.02), replacesId: 4 })], []);
    const markStale = vi.fn(async () => undefined);
    const r = await updateZone(4, { polygon: sq(0.02) }, { markStale });
    expect(r.zone.id).toBe(9);
    expect(ops.map((o) => o.op)).toEqual(["select", "update"]);
    expect(ops[1].values).toMatchObject({ archivedAt: expect.any(Date) });
    expect(markStale).toHaveBeenCalledWith([sq(0.02), sq()]);
  });

  it("a real edit while two versions are active archives both old ones", async () => {
    results.push([row(4), row(9, { polygon: sq(0.02), replacesId: 4 })], [row(10, { polygon: sq(0.03), replacesId: 9 })], []);
    const r = await updateZone(9, { polygon: sq(0.03) });
    expect(r.zone.id).toBe(10);
    expect(ops.map((o) => o.op)).toEqual(["select", "insert", "update"]);
    expect(r.touched).toEqual([sq(0.02), sq(0.03), sq()]);
  });

  it("lineage helpers", () => {
    const rows = [row(4), row(9, { polygon: sq(0.02), replacesId: 4 }), row(11)];
    expect(activeInLineage(rows, 4).map((x) => x.id)).toEqual([9, 4]);
    expect(alreadyApplied(rows, 4, sq(0.02))?.id).toBe(9);
    expect(alreadyApplied(rows, 4, sq(0.05))).toBeNull();
    expect(alreadyApplied(rows, 9, sq(0.02))).toBeNull(); // the newest itself: not a retry
  });

  it("missing zone → 404", async () => {
    results.push([]);
    await expect(updateZone(4, { name: "x" })).rejects.toMatchObject({ status: 404 });
  });

  it("archive sets archived_at only; already archived is a no-op", async () => {
    results.push([row(4)], [row(4, { archivedAt: t0 })]);
    const r = await archiveZone(4);
    expect(ops[1]).toMatchObject({ op: "update", values: { archivedAt: expect.any(Date) } });
    expect(r.touched).toEqual([sq()]);

    ops.length = 0;
    results.push([row(4, { archivedAt: t0 })]);
    expect((await archiveZone(4)).touched).toEqual([]);
    expect(ops.map((o) => o.op)).toEqual(["select"]);
  });

  it("restore unarchives the target first, then archives the replacing version", async () => {
    const all = [row(1, { archivedAt: t0 }), row(2, { replacesId: 1, polygon: sq(0.05) })];
    results.push(all, [row(1)], []);
    const r = await restoreZone(1);
    expect(ops.map((o) => o.op)).toEqual(["select", "update", "update"]);
    expect(ops[1].values).toMatchObject({ archivedAt: null });
    expect(ops[2].values).toMatchObject({ archivedAt: expect.any(Date) });
    expect(r.touched).toEqual([sq(), sq(0.05)]);
  });
});
