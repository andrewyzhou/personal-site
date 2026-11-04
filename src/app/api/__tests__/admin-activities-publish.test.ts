import { describe, it, expect, vi, beforeEach } from "vitest";

const { insert, photoInserts, order, sources, edits, republish, rawGet, rawConfigured, r2Get, revalidate, invalidate } = vi.hoisted(() => ({
  insert: vi.fn(),
  photoInserts: [] as Record<string, unknown>[],
  order: [] as string[],
  sources: [] as Record<string, unknown>[],
  edits: [] as unknown[][],
  republish: vi.fn(),
  rawGet: vi.fn(),
  rawConfigured: { value: true },
  r2Get: vi.fn(),
  revalidate: vi.fn(),
  invalidate: vi.fn(),
}));

vi.mock("@/lib/admin-auth", () => ({ requireAdmin: async () => null }));
vi.mock("next/cache", () => ({ revalidatePath: (p: string) => revalidate(p) }));
vi.mock("@/lib/cache", () => ({ invalidateCache: (...a: unknown[]) => invalidate(...a) }));
vi.mock("@/lib/db", () => ({
  getDb: () => ({
    insert: () => ({
      values: async (v: Record<string, unknown>[]) => {
        order.push("photos");
        photoInserts.push(...v);
      },
    }),
  }),
  activityPhotos: {},
}));

vi.mock("@/lib/activities", async (orig) => ({
  ...(await orig<typeof import("@/lib/activities")>()),
  insertActivity: (v: unknown) => insert(v),
}));

vi.mock("@/lib/activity-sources", () => ({
  addActivitySource: async (s: Record<string, unknown>) => void sources.push(s),
  addActivityEdit: async (...a: unknown[]) => {
    edits.push(a);
    return 11;
  },
}));

vi.mock("@/lib/raw-store", () => ({
  isRawStoreConfigured: () => rawConfigured.value,
  isSha256: (s: string) => /^[0-9a-f]{64}$/.test(s),
  getRawStore: () => ({
    get: (sha: string) => rawGet(sha),
    manifestRow: async () => ({ originalFilename: "morning.fit" }),
  }),
}));

vi.mock("@/lib/republish", () => ({
  republish: (id: number) => {
    order.push("republish");
    return republish(id);
  },
}));

vi.mock("@/lib/r2", () => ({
  r2Get: (p: string) => r2Get(p),
  r2PublicUrl: (p: string) => `https://r2.test/${p}`,
}));

vi.mock("@/lib/fit", () => ({
  parseTrackFile: () => ({
    fileType: "fit",
    sportType: "Run",
    startDateUtc: new Date("2026-10-03T15:02:52Z"),
    utcOffsetMin: -420,
    hasLocalTime: true,
    records: [
      { lat: 37.87, lng: -122.26, t: 0, ele: 50, hr: 120, cadence: 80, watts: null, speed: 3 },
      { lat: 37.88, lng: -122.25, t: 600, ele: 60, hr: 150, cadence: 82, watts: null, speed: 3 },
    ],
    cumDist: [0, 1400],
    sessionStats: null,
    kilojoules: null,
    suggestedName: "Morning Run",
  }),
}));

import { POST } from "@/app/api/admin/activities/route";
import { sha256Hex } from "@/lib/activities";

const SHA = "c".repeat(64);
const BYTES = new Uint8Array([9, 9, 9]);
const LEGACY_PATH = "activities/fit/2026/abc.fit";

function publish(body: Record<string, unknown>) {
  return POST(new Request("http://localhost/api/admin/activities", { method: "POST", body: JSON.stringify(body) }));
}

beforeEach(() => {
  vi.clearAllMocks();
  sources.length = 0;
  photoInserts.length = 0;
  order.length = 0;
  edits.length = 0;
  rawConfigured.value = true;
  rawGet.mockResolvedValue(BYTES);
  r2Get.mockResolvedValue(BYTES);
  insert.mockResolvedValue({ inserted: true, id: 42 });
  republish.mockResolvedValue({ status: "published" });
});

describe("POST /api/admin/activities", () => {
  it("publishes from the raw store by sha: source, trim edit, republish", async () => {
    const res = await publish({ rawSha256: SHA, name: " Morning Run ", trimStartM: 150, trimEndM: 300 });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ ok: true, id: 42, url: "/activities/42" });

    expect(rawGet).toHaveBeenCalledWith(SHA);
    expect(r2Get).not.toHaveBeenCalled();
    const row = insert.mock.calls[0][0];
    expect(row).toMatchObject({ name: "Morning Run", source: "upload", fitBlobPathname: null, fitBlobUrl: null, fitSha256: null });

    expect(sources).toEqual([{ activityId: 42, provider: "upload", kind: "device-file", rawSha256: SHA }]);
    expect(edits).toEqual([[42, "trim", { startM: 150, endM: 300 }]]);
    expect(republish).toHaveBeenCalledWith(42);
    expect(invalidate).toHaveBeenCalledWith("activities_list", "activities_latest");
    expect(revalidate).toHaveBeenCalledWith("/activities/42");
  });

  it("records a 0/0 trim edit when no trim is given", async () => {
    await publish({ rawSha256: SHA, name: "run" });
    expect(edits).toEqual([[42, "trim", { startM: 0, endM: 0 }]]);
  });

  it("publishes a legacy draft from its public path, keeping the fit columns", async () => {
    rawConfigured.value = false;
    const res = await publish({ rawSha256: sha256Hex(BYTES), fitBlobPathname: LEGACY_PATH, name: "run", trimStartM: 200, trimEndM: 200 });
    expect(res.status).toBe(201);
    expect(r2Get).toHaveBeenCalledWith(LEGACY_PATH);
    expect(rawGet).not.toHaveBeenCalled();
    expect(insert.mock.calls[0][0]).toMatchObject({
      fitBlobPathname: LEGACY_PATH,
      fitBlobUrl: `https://r2.test/${LEGACY_PATH}`,
      fitSha256: sha256Hex(BYTES),
    });
    expect(sources).toEqual([{ activityId: 42, provider: "upload", kind: "device-file", rawSha256: sha256Hex(BYTES) }]);
    expect(republish).toHaveBeenCalledWith(42);
  });

  it("accepts a legacy body with only fitBlobPathname", async () => {
    const res = await publish({ fitBlobPathname: LEGACY_PATH, name: "run" });
    expect(res.status).toBe(201);
    expect(r2Get).toHaveBeenCalledWith(LEGACY_PATH);
  });

  it("returns 409 on a duplicate without recording a source or edit", async () => {
    insert.mockResolvedValue({ inserted: false, id: 7 });
    const res = await publish({ rawSha256: SHA, name: "run" });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ ok: false, error: "duplicate activity", id: 7 });
    expect(sources).toHaveLength(0);
    expect(edits).toHaveLength(0);
    expect(republish).not.toHaveBeenCalled();
  });

  it("requires an original reference and a name", async () => {
    expect((await publish({ name: "run" })).status).toBe(400);
    expect((await publish({ rawSha256: SHA })).status).toBe(400);
    expect((await publish({ fitBlobPathname: "elsewhere/x.fit", name: "run" })).status).toBe(400);
  });

  it("returns 502 when the original can't be read", async () => {
    rawGet.mockRejectedValue(new Error("missing"));
    expect((await publish({ rawSha256: SHA, name: "run" })).status).toBe(502);
    expect(insert).not.toHaveBeenCalled();
  });

  it("stores each photo's private fields, before republish computes the pins", async () => {
    const res = await publish({
      rawSha256: SHA,
      name: "run",
      photos: [
        {
          pathname: "activities/photos/2026/a.jpg",
          url: "https://cdn.test/a.jpg",
          width: 2000,
          height: 1500,
          originalSha256: "e".repeat(64),
          takenAt: "2026-10-03T15:10:00.000Z",
          gpsLat: 37.8712345,
          gpsLng: -122.2598765,
        },
        { pathname: "activities/photos/2026/b.jpg", url: "https://cdn.test/b.jpg", originalSha256: null, takenAt: null, gpsLat: null, gpsLng: null },
      ],
    });
    expect(res.status).toBe(201);
    expect(order).toEqual(["photos", "republish"]);
    expect(photoInserts).toEqual([
      {
        activityId: 42,
        blobUrl: "https://cdn.test/a.jpg",
        blobPathname: "activities/photos/2026/a.jpg",
        width: 2000,
        height: 1500,
        position: 0,
        caption: null,
        originalSha256: "e".repeat(64),
        takenAt: new Date("2026-10-03T15:10:00.000Z"),
        gpsLat: 37.8712345,
        gpsLng: -122.2598765,
      },
      expect.objectContaining({ position: 1, originalSha256: null, takenAt: null, gpsLat: null, gpsLng: null }),
    ]);
    // the public pin columns are republish's alone
    for (const p of photoInserts) expect(p).not.toHaveProperty("pinLat");
  });

  it("rejects invalid private photo fields before publishing anything", async () => {
    const base = { pathname: "activities/photos/a.jpg", url: "u" };
    for (const bad of [
      { ...base, originalSha256: "xyz" },
      { ...base, takenAt: "yesterday" },
      { ...base, takenAt: "2026-13-45T99:00:00Z" },
      { ...base, gpsLat: 91, gpsLng: 0 },
      { ...base, gpsLat: 10 },
      { ...base, gpsLat: Number.NaN, gpsLng: 1 },
      { url: "u" },
    ]) {
      const res = await publish({ rawSha256: SHA, name: "run", photos: [bad] });
      expect(res.status).toBe(400);
    }
    expect((await publish({ rawSha256: SHA, name: "run", photos: "nope" })).status).toBe(400);
    expect(insert).not.toHaveBeenCalled();
    expect(photoInserts).toHaveLength(0);
  });
});
