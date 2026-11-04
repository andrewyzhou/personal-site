import { describe, it, expect, vi, beforeEach } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

// fake db for the io half: records each update's set + where
const { updates } = vi.hoisted(() => ({ updates: [] as { set: Record<string, unknown>; where: unknown }[] }));
vi.mock("../db", async (orig) => ({
  ...(await orig<typeof import("../db")>()),
  getDb: () => ({
    update: () => {
      const u = { set: {} as Record<string, unknown>, where: undefined as unknown };
      updates.push(u);
      const c = {
        set: (v: Record<string, unknown>) => ((u.set = v), c),
        where: (w: unknown) => ((u.where = w), c),
        returning: async () => [{ id: 1 }, { id: 2 }],
      };
      return c;
    },
  }),
}));

import { isStaleCandidate, markAllStale, markStaleForZones, pendingWhere, relevanceBounds, staleWhere, zoneBoundsList } from "../privacy/stale";
import { RELEVANCE_MARGIN_M } from "../privacy/fog";
import { PROCESSING_VERSION } from "../republish";

const sq = (lat: number, lng: number, h: number) => [[[lng - h, lat - h], [lng + h, lat - h], [lng + h, lat + h], [lng - h, lat + h], [lng - h, lat - h]]];
const bbox = (minLat: number, minLng: number, maxLat: number, maxLng: number) => ({ minLat, minLng, maxLat, maxLng });
const M_PER_DEG_LAT = 110540;

beforeEach(() => {
  updates.length = 0;
});

describe("stale selection", () => {
  const zones = zoneBoundsList([sq(10, 20, 0.01), sq(-5, -5, 0.01)]);

  it("zone bounds from [lng, lat] rings", () => {
    expect(zones[0]).toEqual(bbox(9.99, 19.99, 10.01, 20.01));
    expect(zoneBoundsList([[]])).toEqual([]);
  });

  it("known track bbox: only activities overlapping the zone or within the margin", () => {
    const base = { polyline: "x", fitSha256: null };
    expect(isStaleCandidate({ ...base, trackBbox: bbox(10, 20, 10.5, 20.5) }, zones)).toBe(true);
    expect(isStaleCandidate({ ...base, trackBbox: bbox(-5.5, -5.5, -5, -5) }, zones)).toBe(true); // touches the corner
    expect(isStaleCandidate({ ...base, trackBbox: bbox(11, 21, 12, 22) }, zones)).toBe(false);
    expect(isStaleCandidate({ ...base, trackBbox: bbox(11, 21, 12, 22) }, [])).toBe(false);
  });

  it("a track bbox just outside a zone (pin snap, edge buffer) still counts; one past the margin doesn't", () => {
    const base = { polyline: "x", fitSha256: null };
    const near = 10.01 + 80 / M_PER_DEG_LAT; // 80 m north of the zone's top edge
    const far = 10.01 + (RELEVANCE_MARGIN_M + 20) / M_PER_DEG_LAT;
    expect(isStaleCandidate({ ...base, trackBbox: bbox(near, 20, near + 0.01, 20.005) }, zones)).toBe(true);
    expect(isStaleCandidate({ ...base, trackBbox: bbox(far, 20, far + 0.01, 20.005) }, zones)).toBe(false);
  });

  it("unknown track bbox: anything with a route or an original file", () => {
    expect(isStaleCandidate({ trackBbox: null, polyline: "x", fitSha256: null }, zones)).toBe(true);
    expect(isStaleCandidate({ trackBbox: null, polyline: null, fitSha256: "f" }, [])).toBe(true);
    expect(isStaleCandidate({ trackBbox: null, polyline: null, fitSha256: null }, zones)).toBe(false);
  });

  it("sql compares each track_bbox field against every zone's bounds grown by the margin", () => {
    const q = new PgDialect().sqlToQuery(staleWhere(zones));
    expect(q.sql).toContain(`"track_bbox"->>`);
    expect(q.sql).toContain(`"track_bbox" is null`);
    expect(q.sql).toContain(`"polyline" is not null`);
    expect(q.sql).toContain(`"fit_sha256" is not null`);
    // 2 zones × 4 comparisons (field name + bound each)
    const grown = relevanceBounds(zones);
    expect(grown[0].maxLat).toBeCloseTo(10.01 + RELEVANCE_MARGIN_M / M_PER_DEG_LAT, 9);
    expect(grown[0].minLng).toBeLessThan(19.99 - RELEVANCE_MARGIN_M / 111320);
    expect(q.params.filter((p) => typeof p === "number")).toEqual(
      grown.flatMap((b) => [b.maxLat, b.minLat, b.maxLng, b.minLng])
    );
    expect(new PgDialect().sqlToQuery(staleWhere([])).sql).not.toContain("->>");
  });

  it("pending = flagged or built by an older processing version", () => {
    const q = new PgDialect().sqlToQuery(pendingWhere());
    expect(q.sql).toContain(`"needs_republish"`);
    expect(q.sql).toContain(`"processing_version" <`);
    expect(q.params).toContain(PROCESSING_VERSION);
  });
});

describe("marking", () => {
  const where = (w: unknown) => new PgDialect().sqlToQuery(w as SQL).sql;

  it("zone marks flag and stamp stale_marked_at, re-stamping rows already flagged", async () => {
    const before = Date.now();
    expect(await markStaleForZones([sq(10, 20, 0.01)])).toBe(2);
    expect(updates).toHaveLength(1);
    expect(updates[0].set.needsRepublish).toBe(true);
    expect((updates[0].set.staleMarkedAt as Date).getTime()).toBeGreaterThanOrEqual(before);
    // no "needs_republish = false" filter: an in-flight republish must see the new stamp
    expect(where(updates[0].where)).not.toContain(`"needs_republish"`);
    expect(where(updates[0].where)).toContain(`"track_bbox"->>`);
  });

  it("nothing to mark for no geometry", async () => {
    expect(await markStaleForZones([])).toBe(0);
    expect(await markStaleForZones([[]])).toBe(0);
    expect(updates).toHaveLength(0);
  });

  it("settings marks stamp every row", async () => {
    expect(await markAllStale()).toBe(2);
    expect(updates[0].set).toMatchObject({ needsRepublish: true, staleMarkedAt: expect.any(Date) });
    expect(where(updates[0].where)).not.toContain(`"needs_republish"`);
  });
});
