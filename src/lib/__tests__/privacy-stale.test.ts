import { describe, it, expect } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { isStaleCandidate, pendingWhere, staleWhere, zoneBoundsList } from "../privacy/stale";
import { PROCESSING_VERSION } from "../republish";

const sq = (lat: number, lng: number, h: number) => [[[lng - h, lat - h], [lng + h, lat - h], [lng + h, lat + h], [lng - h, lat + h], [lng - h, lat - h]]];
const bbox = (minLat: number, minLng: number, maxLat: number, maxLng: number) => ({ minLat, minLng, maxLat, maxLng });

describe("stale selection", () => {
  const zones = zoneBoundsList([sq(10, 20, 0.01), sq(-5, -5, 0.01)]);

  it("zone bounds from [lng, lat] rings", () => {
    expect(zones[0]).toEqual(bbox(9.99, 19.99, 10.01, 20.01));
    expect(zoneBoundsList([[]])).toEqual([]);
  });

  it("known track bbox: only overlapping activities", () => {
    const base = { polyline: "x", fitSha256: null };
    expect(isStaleCandidate({ ...base, trackBbox: bbox(10, 20, 10.5, 20.5) }, zones)).toBe(true);
    expect(isStaleCandidate({ ...base, trackBbox: bbox(-5.5, -5.5, -5, -5) }, zones)).toBe(true); // touches the corner
    expect(isStaleCandidate({ ...base, trackBbox: bbox(11, 21, 12, 22) }, zones)).toBe(false);
    expect(isStaleCandidate({ ...base, trackBbox: bbox(11, 21, 12, 22) }, [])).toBe(false);
  });

  it("unknown track bbox: anything with a route or an original file", () => {
    expect(isStaleCandidate({ trackBbox: null, polyline: "x", fitSha256: null }, zones)).toBe(true);
    expect(isStaleCandidate({ trackBbox: null, polyline: null, fitSha256: "f" }, [])).toBe(true);
    expect(isStaleCandidate({ trackBbox: null, polyline: null, fitSha256: null }, zones)).toBe(false);
  });

  it("sql compares each track_bbox field against every zone's bounds", () => {
    const q = new PgDialect().sqlToQuery(staleWhere(zones));
    expect(q.sql).toContain(`"track_bbox"->>`);
    expect(q.sql).toContain(`"track_bbox" is null`);
    expect(q.sql).toContain(`"polyline" is not null`);
    expect(q.sql).toContain(`"fit_sha256" is not null`);
    // 2 zones × 4 comparisons (field name + bound each)
    expect(q.params.filter((p) => typeof p === "number")).toEqual([10.01, 9.99, 20.01, 19.99, -4.99, -5.01, -4.99, -5.01]);
    expect(new PgDialect().sqlToQuery(staleWhere([])).sql).not.toContain("->>");
  });

  it("pending = flagged or built by an older processing version", () => {
    const q = new PgDialect().sqlToQuery(pendingWhere());
    expect(q.sql).toContain(`"needs_republish"`);
    expect(q.sql).toContain(`"processing_version" <`);
    expect(q.params).toContain(PROCESSING_VERSION);
  });
});
