import { describe, it, expect, vi, beforeEach } from "vitest";

const { row, photoRows, inserted, updates, edits, reverted, republish, revalidate, invalidate } = vi.hoisted(() => ({
  row: { value: null as Record<string, unknown> | null },
  photoRows: { value: [] as Record<string, unknown>[] },
  inserted: [] as Record<string, unknown>[],
  updates: [] as Record<string, unknown>[],
  edits: [] as unknown[][],
  reverted: [] as number[],
  republish: vi.fn(),
  revalidate: vi.fn(),
  invalidate: vi.fn(),
}));

vi.mock("@/lib/admin-auth", () => ({ requireAdmin: async () => null }));
vi.mock("next/cache", () => ({ revalidatePath: (p: string) => revalidate(p) }));
vi.mock("@/lib/cache", () => ({ invalidateCache: (...a: unknown[]) => invalidate(...a) }));
vi.mock("@/lib/r2", () => ({ r2Delete: vi.fn() }));

vi.mock("@/lib/db", () => ({
  activities: {},
  activityPhotos: {},
  getDb: () => ({
    // awaited directly → existing photo rows; .limit() → the activity row
    select: () => ({
      from: () => ({
        where: () => Object.assign(Promise.resolve(photoRows.value), { limit: async () => (row.value ? [row.value] : []) }),
      }),
    }),
    update: () => ({ set: (v: Record<string, unknown>) => ({ where: async () => updates.push(v) }) }),
    delete: () => ({ where: async () => undefined }),
    insert: () => ({ values: async (v: Record<string, unknown>[]) => void inserted.push(...v) }),
  }),
}));

vi.mock("@/lib/activity-sources", () => ({
  addActivityEdit: async (...a: unknown[]) => {
    edits.push(a);
    return 31;
  },
  revertActivityEdit: async (id: number) => void reverted.push(id),
}));

vi.mock("@/lib/republish", () => ({ republish: (id: number) => republish(id) }));

import { PATCH } from "@/app/api/admin/activities/[id]/route";

function patch(body: Record<string, unknown>, id = "5") {
  return PATCH(new Request(`http://localhost/api/admin/activities/${id}`, { method: "PATCH", body: JSON.stringify(body) }), {
    params: Promise.resolve({ id }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  updates.length = 0;
  edits.length = 0;
  reverted.length = 0;
  inserted.length = 0;
  photoRows.value = [];
  row.value = { id: 5, name: "run", trimStartM: 200, trimEndM: 200, fitBlobPathname: null };
  republish.mockResolvedValue({ status: "published" });
});

describe("PATCH /api/admin/activities/[id]", () => {
  it("records a trim edit and republishes; no stat columns written by the route", async () => {
    const res = await patch({ trimStartM: 50 });
    expect(res.status).toBe(200);
    expect(edits).toEqual([[5, "trim", { startM: 50, endM: 200 }]]);
    expect(republish).toHaveBeenCalledWith(5);
    expect(reverted).toHaveLength(0);
    for (const u of updates) {
      for (const k of ["distanceM", "polyline", "trimStartM", "trimEndM", "movingTimeS"]) expect(u).not.toHaveProperty(k);
    }
    expect(invalidate).toHaveBeenCalledWith("activities_list", "activities_latest");
    expect(revalidate).toHaveBeenCalledWith("/activities/5");
  });

  it("reverts the edit and returns 422 when there is nothing to rebuild from", async () => {
    republish.mockResolvedValue({ status: "no-source", id: 5, hash: "h" });
    const res = await patch({ trimStartM: 0, trimEndM: 0, name: "renamed" });
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ ok: false, error: "no original file stored — trim is not editable" });
    expect(reverted).toEqual([31]);
    expect(updates).toHaveLength(0);
  });

  it("reverts the edit and returns 503 when the original can't be read", async () => {
    republish.mockResolvedValue({ status: "source-unavailable", id: 5, hash: "h", track: {} });
    const res = await patch({ trimStartM: 10 });
    expect(res.status).toBe(503);
    expect(reverted).toEqual([31]);
    expect(updates).toHaveLength(0);
  });

  it("photo replacement keeps each photo's private original link", async () => {
    photoRows.value = [{ pathname: "activities/photos/a.jpg", originalSha256: "f".repeat(64) }];
    const res = await patch({
      photos: [
        { pathname: "activities/photos/new.jpg", url: "u2" },
        { pathname: "activities/photos/a.jpg", url: "u1" },
      ],
    });
    expect(res.status).toBe(200);
    expect(inserted.map((p) => [p.blobPathname, p.position, p.originalSha256])).toEqual([
      ["activities/photos/new.jpg", 0, null],
      ["activities/photos/a.jpg", 1, "f".repeat(64)],
    ]);
  });

  it("reverts the edit when republish throws", async () => {
    republish.mockRejectedValue(new Error("boom"));
    const res = await patch({ trimEndM: 10 });
    expect(res.status).toBe(500);
    expect(reverted).toEqual([31]);
  });

  it("metadata-only edits update directly without an edit or republish", async () => {
    const res = await patch({ name: " renamed ", hidden: true, trimStartM: 200 });
    expect(res.status).toBe(200);
    expect(edits).toHaveLength(0);
    expect(republish).not.toHaveBeenCalled();
    expect(updates[0]).toMatchObject({ name: "renamed", hidden: true });
  });

  it("a sport change marks the row stale in the same update, then republishes", async () => {
    row.value = { ...row.value!, sportType: "Run" };
    const res = await patch({ sportType: "Hike" });
    expect(res.status).toBe(200);
    expect(updates[0]).toMatchObject({ sportType: "Hike", needsRepublish: true, staleMarkedAt: expect.any(Date) });
    expect(republish).toHaveBeenCalledWith(5);
    expect(edits).toHaveLength(0);
  });

  it("the same sport sent again marks nothing", async () => {
    row.value = { ...row.value!, sportType: "Run" };
    await patch({ sportType: "Run", name: "x" });
    expect(updates[0]).not.toHaveProperty("needsRepublish");
    expect(republish).not.toHaveBeenCalled();
  });

  it("a republish failure after a sport change still saves it (stale stays set)", async () => {
    row.value = { ...row.value!, sportType: "Run" };
    republish.mockRejectedValue(new Error("boom"));
    const res = await patch({ sportType: "Ride" });
    expect(res.status).toBe(200);
    expect(updates[0]).toMatchObject({ sportType: "Ride", needsRepublish: true });
  });

  it("404s an unknown activity", async () => {
    row.value = null;
    expect((await patch({ trimStartM: 1 })).status).toBe(404);
    expect(edits).toHaveLength(0);
  });
});

describe("PATCH photos: private fields", () => {
  const SHA_A = "a".repeat(64);
  const SHA_B = "b".repeat(64);
  const taken = new Date("2026-10-03T15:10:00Z");

  beforeEach(() => {
    photoRows.value = [
      {
        pathname: "p/a.jpg", width: 2000, height: 1500, originalSha256: SHA_A, takenAt: taken,
        gpsLat: 37.87, gpsLng: -122.26, pinLat: 37.87, pinLng: -122.26,
      },
      {
        pathname: "p/b.jpg", width: 800, height: 600, originalSha256: null, takenAt: null,
        gpsLat: null, gpsLng: null, pinLat: null, pinLng: null,
      },
    ];
  });

  it("keeps every private field (and a still-valid pin) for photos it already had", async () => {
    const res = await patch({ photos: [{ pathname: "p/b.jpg", url: "ub" }, { pathname: "p/a.jpg", url: "ua" }] });
    expect(res.status).toBe(200);
    expect(inserted).toEqual([
      expect.objectContaining({ blobPathname: "p/b.jpg", position: 0, width: 800, height: 600, originalSha256: null, takenAt: null, gpsLat: null, gpsLng: null }),
      expect.objectContaining({
        blobPathname: "p/a.jpg", position: 1, width: 2000, height: 1500, originalSha256: SHA_A,
        takenAt: taken, gpsLat: 37.87, gpsLng: -122.26, pinLat: 37.87, pinLng: -122.26,
      }),
    ]);
  });

  it("new values win over stored ones; a moved photo loses its old pin until republish", async () => {
    await patch({
      photos: [
        { pathname: "p/a.jpg", url: "ua", originalSha256: SHA_B, takenAt: "2026-10-03T16:00:00Z", gpsLat: 1.5, gpsLng: 2.5 },
        { pathname: "p/new.jpg", url: "un", gpsLat: 3, gpsLng: 4 },
      ],
    });
    expect(inserted).toEqual([
      expect.objectContaining({
        blobPathname: "p/a.jpg", originalSha256: SHA_B, takenAt: new Date("2026-10-03T16:00:00Z"),
        gpsLat: 1.5, gpsLng: 2.5, pinLat: null, pinLng: null,
      }),
      expect.objectContaining({ blobPathname: "p/new.jpg", originalSha256: null, takenAt: null, gpsLat: 3, gpsLng: 4, pinLat: null }),
    ]);
  });

  it("republishes after a photo change (pins)", async () => {
    await patch({ photos: [{ pathname: "p/a.jpg", url: "ua" }] });
    expect(republish).toHaveBeenCalledWith(5);
    expect(edits).toHaveLength(0);
  });

  it("a republish failure after a photo change doesn't fail the edit", async () => {
    republish.mockRejectedValue(new Error("r2 down"));
    const res = await patch({ name: "renamed", photos: [{ pathname: "p/a.jpg", url: "ua" }] });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(inserted).toHaveLength(1);
    expect(updates[0]).toMatchObject({ name: "renamed" });
    expect(revalidate).toHaveBeenCalledWith("/activities/5");
  });

  it("rejects invalid private fields before writing anything", async () => {
    for (const bad of [
      { pathname: "p/a.jpg", url: "ua", originalSha256: "nope" },
      { pathname: "p/a.jpg", url: "ua", takenAt: "soon" },
      { pathname: "p/a.jpg", url: "ua", gpsLat: 10, gpsLng: 200 },
      { pathname: "p/a.jpg", url: "ua", gpsLng: 20 },
    ]) {
      expect((await patch({ photos: [bad] })).status).toBe(400);
    }
    expect(updates).toHaveLength(0);
    expect(inserted).toHaveLength(0);
  });
});

describe("PATCH visibility", () => {
  it.each([
    ["public", { hidden: false, mapHidden: false }],
    ["hide-map", { hidden: false, mapHidden: true }],
    ["private", { hidden: true, mapHidden: false }],
  ])("%s → columns", async (visibility, cols) => {
    const res = await patch({ visibility });
    expect(res.status).toBe(200);
    expect(updates[0]).toMatchObject(cols);
    // a serializer switch: no edit, no rebuild
    expect(republish).not.toHaveBeenCalled();
    expect(edits).toHaveLength(0);
    expect(invalidate).toHaveBeenCalledWith("activities_list", "activities_latest");
    expect(revalidate).toHaveBeenCalledWith("/activities/5");
  });

  it("hrHidden is its own switch", async () => {
    await patch({ hrHidden: true });
    expect(updates[0]).toMatchObject({ hrHidden: true });
    expect(updates[0]).not.toHaveProperty("hidden");
    expect(updates[0]).not.toHaveProperty("mapHidden");
  });

  it("visibility wins over the legacy hidden flag", async () => {
    await patch({ hidden: true, visibility: "hide-map" });
    expect(updates[0]).toMatchObject({ hidden: false, mapHidden: true });
  });

  it("rejects unknown values", async () => {
    expect((await patch({ visibility: "friends" })).status).toBe(400);
    expect((await patch({ hrHidden: "yes" })).status).toBe(400);
    expect(updates).toHaveLength(0);
  });
});
