import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ActivityPhotoRow, ActivityRow } from "@/lib/db/schema";
import { encodeMultiPolyline } from "@/lib/polyline";
import {
  publicActivityDetail,
  publicCalendarActivity,
  publicPhotos,
  publicRoute,
  type PublicPhotoInput,
} from "@/lib/public-activity";
import { findPrivateKeys } from "@/lib/privacy/leak-audit";
import { isLatestActivity } from "@/lib/validate";

// thenable query-chain stub: every builder method returns the chain; awaiting
// it resolves the next queued result. select() args are recorded so tests can
// assert which columns a route asks for.
const { queue, selects, mockDb } = vi.hoisted(() => {
  const queue: unknown[] = [];
  const selects: unknown[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = {};
  for (const m of ["from", "where", "orderBy", "limit"]) chain[m] = () => chain;
  chain.select = (fields?: unknown) => {
    selects.push(fields);
    return chain;
  };
  chain.then = (resolve: (v: unknown) => void, reject: (e: unknown) => void) => {
    const next = queue.shift();
    if (next instanceof Error) reject(next);
    else resolve(next ?? []);
  };
  return { queue, selects, mockDb: chain };
});

vi.mock("@/lib/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/db")>()),
  getDb: () => mockDb,
}));

// the cache runs the real fetch function (no redis)
vi.mock("@/lib/cache", () => ({
  getCachedData: async (_key: string, fn: () => Promise<unknown>) => ({
    data: await fn(),
    fetchedAt: 1751830000000,
    previousFetchedAt: null,
  }),
}));

import { GET as getList } from "@/app/api/activities/route";
import { GET as getLatest } from "@/app/api/activities/latest/route";
import { GET as getDetail } from "@/app/api/activities/[id]/route";

// every private column carries a sentinel, so a leak shows up in the raw json
const SECRET = "PRIVATE-SENTINEL";
const RAW_START = new Date("2026-07-06T14:13:27.000Z");
const PUBLISHED_START = new Date("2026-07-06T14:00:00.000Z");

const route = encodeMultiPolyline([
  [[37.87, -122.26], [37.871, -122.259], [37.872, -122.258]],
  [[37.876, -122.254], [37.877, -122.253]],
]);

function row(over: Partial<ActivityRow> = {}): ActivityRow {
  return {
    id: 1,
    name: "morning run",
    sportType: "Run",
    startDateUtc: RAW_START,
    localDate: "2026-07-06",
    localTime: "07:13",
    utcOffsetMin: -420,
    distanceM: 8368.2,
    movingTimeS: 2400,
    elapsedTimeS: 2520,
    elevGainM: 40,
    avgSpeedMs: 3.4,
    maxSpeedMs: 5,
    avgHr: 151,
    maxHr: 172,
    avgCadence: 84,
    avgWatts: null,
    maxWatts: null,
    kilojoules: null,
    description: "easy",
    sufferScore: 61,
    gear: "pegasus 41",
    polyline: route,
    cardPolyline: route,
    bounds: { minLat: 37.87, minLng: -122.26, maxLat: 37.877, maxLng: -122.253 },
    trimStartM: 200,
    trimEndM: 200,
    fitBlobUrl: `https://cdn.example/${SECRET}.fit`,
    fitBlobPathname: `activities/fit/2026/${SECRET}.fit`,
    fitSha256: `${SECRET}-sha`,
    fileType: "fit",
    source: `${SECRET}-source`,
    externalId: `${SECRET}-ext`,
    dedupeKey: `${SECRET}-dedupe`,
    hidden: false,
    processingVersion: 2,
    publishedInputsHash: `${SECRET}-hash`,
    canonicalTrackKey: `${SECRET}-key`,
    mapHidden: false,
    hrHidden: false,
    publishedLocalTime: "07:00",
    publishedStartUtc: PUBLISHED_START,
    fogEvents: [{ entry: [37.872, -122.258], exit: [37.876, -122.254], durationS: 840 }],
    fogShapes: [[[[-122.257, 37.873], [-122.255, 37.873], [-122.255, 37.875], [-122.257, 37.873]]]],
    trackBbox: { minLat: 37.0, minLng: -123, maxLat: 38, maxLng: -122 },
    needsRepublish: false,
    republishAttemptedAt: null, metaEditedAt: null, upstreamMeta: null,
    staleMarkedAt: null,
    legacyRoute: null, rawStats: null, hrZonesS: null, splitFromId: null,
    createdAt: new Date("2026-07-06T15:00:00Z"),
    updatedAt: new Date("2026-07-06T15:00:00Z"),
    ...over,
  };
}

// a full photo row: the private exif columns must be dropped by the serializer
// even when a caller hands it everything
function photoRow(over: Partial<ActivityPhotoRow> = {}): ActivityPhotoRow {
  return {
    id: 9,
    activityId: 1,
    blobUrl: "https://cdn.example/activities/photos/a.jpg",
    blobPathname: `activities/photos/${SECRET}.jpg`,
    width: 1200,
    height: 800,
    position: 0,
    caption: "summit",
    originalSha256: `${SECRET}-orig`,
    takenAt: new Date("2026-07-06T14:31:00Z"),
    gpsLat: 37.8731234,
    gpsLng: -122.2561234,
    pinLat: 37.8712,
    pinLng: -122.2591,
    createdAt: new Date("2026-07-06T15:00:00Z"),
    ...over,
  };
}

const RAW_ISO = RAW_START.toISOString();

function expectNoPrivate(value: unknown) {
  expect(findPrivateKeys(value)).toEqual([]);
  const json = JSON.stringify(value);
  expect(json).not.toContain(SECRET);
  expect(json).not.toContain(RAW_ISO);
  expect(json).not.toContain("trackBbox");
  // exif gps never leaves, at any precision
  expect(json).not.toContain("37.8731234");
  expect(json).not.toContain("-122.2561234");
}

const combos = [false, true].flatMap((hidden) =>
  [false, true].flatMap((mapHidden) => [false, true].map((hrHidden) => ({ hidden, mapHidden, hrHidden })))
);

describe("public serializer: private keys never leave", () => {
  for (const vis of combos) {
    const label = `hidden=${vis.hidden} map=${vis.mapHidden ? "hidden" : "shown"} hr=${vis.hrHidden ? "hidden" : "shown"}`;
    it(label, () => {
      const r = row(vis);
      const photos = [photoRow()] as unknown as PublicPhotoInput[];
      for (const out of [publicCalendarActivity(r), publicRoute(r), publicPhotos(r, photos), publicActivityDetail(r, photos)]) {
        expectNoPrivate(out);
      }
      const detail = publicActivityDetail(r, photos);
      // coarsened start: the published time, never the raw one
      expect(detail.startTime).toBe("07:00");
      expect(JSON.stringify(detail)).not.toContain("07:13");
      if (vis.mapHidden) {
        expect(detail.polyline).toBeNull();
        expect(detail.cardPolyline).toBeNull();
        expect(detail.bounds).toBeNull();
        expect(detail.fogShapes).toBeNull();
        expect(detail.fogEvents).toBeNull();
        expect(detail.photos.every((p) => p.pin === null)).toBe(true);
      } else {
        expect(detail.polyline).toBe(route);
        expect(detail.fogShapes).toHaveLength(1);
        expect(detail.photos[0].pin).toEqual([37.8712, -122.2591]);
      }
      if (vis.hrHidden) {
        expect(detail.averageHeartrate).toBeNull();
        expect(detail.maxHeartrate).toBeNull();
        expect(detail.sufferScore).toBeNull();
      } else {
        expect(detail.averageHeartrate).toBe(151);
        expect(detail.sufferScore).toBe(61);
      }
    });
  }

  it("falls back to the raw start only when there is no published one", () => {
    const r = row({ publishedLocalTime: null, publishedStartUtc: null });
    expect(publicCalendarActivity(r).startTime).toBe("07:13");
  });

  it("photo output keeps exactly the public fields", () => {
    const [p] = publicPhotos(row(), [photoRow()] as unknown as PublicPhotoInput[]);
    expect(Object.keys(p).sort()).toEqual(["caption", "height", "pin", "url", "width"]);
  });
});

// ---------------------------------------------------------------------------
// route contracts

const params = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  queue.length = 0;
  selects.length = 0;
});

describe("GET /api/activities", () => {
  it("serves only public rows, through the serializer", async () => {
    queue.push([
      row({ id: 1 }),
      row({ id: 2, mapHidden: true }),
      row({ id: 3, hrHidden: true }),
      row({ id: 4, hidden: true }),
    ]);
    const res = await getList();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.lastFetchedAt).toBe(1751830000000);
    const ids = body.activities.map((a: { id: number }) => a.id);
    expect(ids).toEqual([1, 2, 3]);
    expectNoPrivate(body);
    const byId = new Map(body.activities.map((a: { id: number }) => [a.id, a]));
    expect(byId.get(3)).toMatchObject({ averageHeartrate: null, maxHeartrate: null, sufferScore: null });
    expect(byId.get(1)).toMatchObject({ averageHeartrate: 151, startTime: "07:00" });
    // list stays polyline-free
    expect(JSON.stringify(body)).not.toContain(route);
  });
});

describe("GET /api/activities/latest", () => {
  it("serves the published (coarsened) start and passes isLatestActivity", async () => {
    queue.push([row()]);
    const res = await getLatest();
    const body = await res.json();
    expect(isLatestActivity(body)).toBe(true);
    expect(body.startDate).toBe(PUBLISHED_START.toISOString());
    expect(body.latestActivityId).toBe(1);
    expectNoPrivate(body);
  });

  it("never serves a private row", async () => {
    queue.push([row({ hidden: true })]);
    const res = await getLatest();
    expect(await res.json()).toBeNull();
  });
});

describe("GET /api/activities/[id]", () => {
  it("serves the serializer's detail; photos select names no private column", async () => {
    queue.push([row()], [{ blobUrl: "https://cdn.example/a.jpg", width: 1, height: 1, caption: null, pinLat: 37.8712, pinLng: -122.2591 }]);
    const res = await getDetail(new Request("http://x/api/activities/1"), params("1"));
    const body = await res.json();
    expect(res.status).toBe(200);
    expectNoPrivate(body);
    expect(body.activity.polyline).toBe(route);
    expect(body.activity.fogShapes).toHaveLength(1);
    expect(body.activity.startTime).toBe("07:00");
    expect(body.activity.photos[0]).toEqual({ url: "https://cdn.example/a.jpg", width: 1, height: 1, caption: null, pin: [37.8712, -122.2591] });
    const photoSelect = Object.keys(selects[1] as object);
    expect(photoSelect).toEqual(expect.arrayContaining(["pinLat", "pinLng"]));
    for (const k of ["takenAt", "gpsLat", "gpsLng", "blobPathname", "originalSha256"]) expect(photoSelect).not.toContain(k);
  });

  it("map hidden: no route, bounds, fog or pins", async () => {
    queue.push([row({ mapHidden: true })], [{ blobUrl: "u", width: 1, height: 1, caption: null, pinLat: 37.8712, pinLng: -122.2591 }]);
    const body = await (await getDetail(new Request("http://x"), params("1"))).json();
    expect(body.activity).toMatchObject({ polyline: null, cardPolyline: null, bounds: null, fogShapes: null, fogEvents: null });
    expect(body.activity.photos[0].pin).toBeNull();
    expect(JSON.stringify(body)).not.toContain("37.8712");
  });

  it("hr hidden: no heart rate or effort", async () => {
    queue.push([row({ hrHidden: true })], []);
    const body = await (await getDetail(new Request("http://x"), params("1"))).json();
    expect(body.activity).toMatchObject({ averageHeartrate: null, maxHeartrate: null, sufferScore: null });
  });

  it("private: 404 with no data", async () => {
    queue.push([row({ hidden: true })], []);
    const res = await getDetail(new Request("http://x"), params("1"));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ activity: null });
  });

  it("unknown / malformed ids 404", async () => {
    queue.push([]);
    expect((await getDetail(new Request("http://x"), params("77"))).status).toBe(404);
    expect((await getDetail(new Request("http://x"), params("abc"))).status).toBe(404);
  });
});
