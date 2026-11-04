import { describe, it, expect } from "vitest";
import { pointInPolygon, relevantZones, segmentTouchesPolygon } from "../privacy/fog";
import { DEFAULT_PRIVACY_SETTINGS } from "../privacy/settings";
import { decodeMultiPolyline, encodePolyline } from "../polyline";
import { computePublicColumns, fogStoredRoute, publishedFogEvents, republish, type RepublishDeps } from "../republish";
import { withheldRoute } from "../activities";
import { CANONICAL_FORMAT_VERSION, type CanonicalTrack } from "../canonical-track";
import type { ActivityRow } from "../db/schema";

const square = (lat: number, lng: number, h: number): number[][][] => [
  [[lng - h, lat - h], [lng + h, lat - h], [lng + h, lat + h], [lng - h, lat + h], [lng - h, lat - h]],
];
const settings = DEFAULT_PRIVACY_SETTINGS;
const lineEnc = encodePolyline(Array.from({ length: 101 }, (_, i) => [0, i * 0.0001] as [number, number]));
const lineRoute = { polyline: lineEnc, cardPolyline: lineEnc, bounds: { minLat: 0, minLng: 0, maxLat: 0, maxLng: 0.01 } };
const midZone = { id: 1, polygon: square(0, 0.005, 0.001) };

function trackOf(pts: { lat: number; lng: number }[]): CanonicalTrack {
  return {
    format: "canonical-track",
    v: CANONICAL_FORMAT_VERSION,
    source: { kind: "device-file", sha256: "a".repeat(64), detailSha256: null, fileType: "fit" },
    sportType: "Run",
    startEpochMs: 0,
    utcOffsetMin: 0,
    hasLocalTime: true,
    syntheticTime: false,
    session: null,
    kilojoules: null,
    suggestedName: "run",
    columns: {
      t: pts.map((_, i) => i),
      lat: pts.map((p) => p.lat),
      lng: pts.map((p) => p.lng),
      ele: pts.map(() => null),
      hr: pts.map(() => null),
      cadence: pts.map(() => null),
      watts: pts.map(() => null),
      speed: pts.map(() => null),
      dist: pts.map((_, i) => i * 15),
    },
  };
}

describe("fog hardening", () => {
  it("simplified chords never cut through a zone the raw route went around", () => {
    // a semicircle bulging around a zone inside the bend: the 100-point card
    // budget would otherwise chord straight across it
    const pts = Array.from({ length: 2001 }, (_, i) => {
      const a = Math.PI * (i / 2000);
      return { lat: 0.01 * Math.sin(a), lng: 0.01 * Math.cos(a) };
    });
    const z = { id: 1, polygon: square(0.0085, 0, 0.0012) };
    const cols = computePublicColumns(trackOf(pts), [{ id: 1, kind: "trim", params: { startM: 0, endM: 0 } }], { zones: [z], settings });
    for (const enc of [cols.polyline!, cols.cardPolyline!]) {
      for (const seg of decodeMultiPolyline(enc)) {
        for (let i = 1; i < seg.length; i++) expect(segmentTouchesPolygon(seg[i - 1], seg[i], z.polygon)).toBe(false);
      }
    }
  });

  it("zones just beyond the track bounds still count (pins snap 75 m out)", () => {
    const bbox = { minLat: 0, minLng: 0, maxLat: 0.001, maxLng: 0.001 };
    expect(relevantZones([{ id: 1, polygon: square(0.0016, 0.0005, 0.0001) }], bbox)).toHaveLength(1);
    expect(relevantZones([{ id: 2, polygon: square(0.01, 0.01, 0.0001) }], bbox)).toHaveLength(0);
  });

  it("stored routes get fogged, and come back unchanged without zones", () => {
    const f = fogStoredRoute(lineRoute, [midZone]);
    expect(f.fogged).toBe(true);
    for (const [lat, lng] of decodeMultiPolyline(f.polyline!).flat()) expect(pointInPolygon(lat, lng, midZone.polygon)).toBe(false);
    expect(fogStoredRoute(lineRoute, [])).toEqual({ ...lineRoute, fogged: false });
  });

  it("fog is published as one 5-minute-step total", () => {
    expect(publishedFogEvents([])).toBeNull();
    expect(publishedFogEvents([{ entry: [1, 2], exit: [3, 4], durationS: 420 }, { entry: null, exit: null, durationS: 60 }])).toEqual([
      { entry: null, exit: null, durationS: 600 },
    ]);
  });

  it("new rows never insert a public route", () => {
    const b = { minLat: 0, minLng: 0, maxLat: 1, maxLng: 1 };
    const v = withheldRoute({ polyline: "abc", cardPolyline: "a", bounds: b } as never);
    expect([v.polyline, v.cardPolyline, v.bounds]).toEqual([null, null, null]);
    expect(v.legacyRoute).toEqual({ polyline: "abc", cardPolyline: "a", bounds: b });
  });
});

// ---------------------------------------------------------------------------
// republish io: fail-closed branches and the stale-flag race

function row(over: Partial<ActivityRow> = {}): ActivityRow {
  return {
    id: 7, name: "run", sportType: "Run", startDateUtc: new Date("2026-01-01T08:00:00Z"), localDate: "2026-01-01", localTime: "08:00",
    utcOffsetMin: 0, distanceM: 1000, movingTimeS: 600, elapsedTimeS: 600, elevGainM: 0, avgSpeedMs: 1, maxSpeedMs: 1,
    avgHr: null, maxHr: null, avgCadence: null, avgWatts: null, maxWatts: null, kilojoules: null, description: null,
    sufferScore: null, gear: null, polyline: lineEnc, cardPolyline: lineEnc, bounds: lineRoute.bounds, trimStartM: 0, trimEndM: 0,
    fitBlobUrl: null, fitBlobPathname: null, fitSha256: null, fileType: null, source: "strava-api", externalId: "1",
    dedupeKey: "k", hidden: false, processingVersion: 0, publishedInputsHash: null, canonicalTrackKey: null,
    mapHidden: false, hrHidden: false, publishedLocalTime: null, publishedStartUtc: null, fogEvents: null, fogShapes: null,
    trackBbox: null, needsRepublish: true, staleMarkedAt: null, legacyRoute: null, rawStats: null, hrZonesS: null, splitFromId: null, republishAttemptedAt: null,
    createdAt: new Date(), updatedAt: new Date(), ...over,
  };
}

function deps(r: ActivityRow, sources: { id: number; kind: string; rawSha256: string | null }[], zones = [midZone]) {
  const writes: { values: Record<string, unknown>; startedAt?: Date }[] = [];
  const d: RepublishDeps = {
    loadActivity: async () => r,
    loadSources: async () => sources.map((s) => ({ ...s, provider: "strava", externalId: "1" })),
    loadEdits: async () => [],
    loadZones: async () => zones,
    loadRaw: async () => null,
    storeDerived: async () => false,
    writeColumns: async (_id, values, startedAt) => {
      writes.push({ values, startedAt });
      Object.assign(r, values);
    },
  };
  return { d, writes };
}

describe("republish fail-closed", () => {
  it("trackless rows publish their stored route with zones applied, keeping the original privately", async () => {
    const r = row();
    const { d, writes } = deps(r, [{ id: 1, kind: "summary", rawSha256: null }]);
    expect((await republish(7, { deps: d })).status).toBe("no-source");
    expect(writes[0].values.legacyRoute).toEqual(lineRoute);
    for (const [lat, lng] of decodeMultiPolyline(r.polyline!).flat()) expect(pointInPolygon(lat, lng, midZone.polygon)).toBe(false);
    // zone removed → the stored route comes back
    const { d: d2 } = deps(r, [{ id: 1, kind: "summary", rawSha256: null }], []);
    await republish(7, { deps: d2 });
    expect(r.polyline).toBe(lineEnc);
  });

  it("an unreadable source still fogs the current route and leaves the row pending", async () => {
    const r = row();
    const { d, writes } = deps(r, [{ id: 1, kind: "device-file", rawSha256: "b".repeat(64) }]);
    expect((await republish(7, { deps: d })).status).toBe("source-unavailable");
    expect(writes).toHaveLength(1);
    expect(writes[0].values).not.toHaveProperty("needsRepublish");
    for (const [lat, lng] of decodeMultiPolyline(r.polyline!).flat()) expect(pointInPolygon(lat, lng, midZone.polygon)).toBe(false);
  });

  it("a thrown error still fogs the current route before propagating", async () => {
    const r = row();
    const { d } = deps(r, [{ id: 1, kind: "device-file", rawSha256: "b".repeat(64) }]);
    d.loadRaw = async () => {
      throw new Error("r2 down");
    };
    await expect(republish(7, { deps: d })).rejects.toThrow("r2 down");
    for (const [lat, lng] of decodeMultiPolyline(r.polyline!).flat()) expect(pointInPolygon(lat, lng, midZone.polygon)).toBe(false);
  });

  it("clearing the stale flag carries the republish start (so a racing edit keeps it set)", async () => {
    const r = row();
    const { d, writes } = deps(r, [{ id: 1, kind: "summary", rawSha256: null }]);
    const before = Date.now();
    await republish(7, { deps: d });
    const clear = writes.find((w) => w.values.needsRepublish === false)!;
    expect(clear.startedAt!.getTime()).toBeGreaterThanOrEqual(before);
  });
});
