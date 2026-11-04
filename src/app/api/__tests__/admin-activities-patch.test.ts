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

  it("404s an unknown activity", async () => {
    row.value = null;
    expect((await patch({ trimStartM: 1 })).status).toBe(404);
    expect(edits).toHaveLength(0);
  });
});
