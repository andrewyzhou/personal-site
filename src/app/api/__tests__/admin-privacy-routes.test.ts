import { describe, it, expect, vi, beforeEach } from "vitest";

const { denied, zonesLib, stale, rebuild, settingsState, inserted, revalidate } = vi.hoisted(() => ({
  denied: { value: false },
  zonesLib: {
    listZones: vi.fn(),
    createZone: vi.fn(),
    updateZone: vi.fn(),
    archiveZone: vi.fn(),
    restoreZone: vi.fn(),
  },
  stale: { markStaleForZones: vi.fn(), markAllStale: vi.fn(), countPending: vi.fn() },
  rebuild: { republishPending: vi.fn() },
  settingsState: { value: null as unknown },
  inserted: [] as unknown[],
  revalidate: vi.fn(),
}));

vi.mock("@/lib/admin-auth", async () => {
  const { NextResponse } = await import("next/server");
  return {
    requireAdmin: async () => (denied.value ? NextResponse.json({ error: "unauthorized" }, { status: 401 }) : null),
  };
});
vi.mock("next/cache", () => ({ revalidatePath: (p: string) => revalidate(p) }));
vi.mock("@/lib/privacy/zones", async (orig) => ({ ...(await orig<typeof import("@/lib/privacy/zones")>()), ...zonesLib }));
vi.mock("@/lib/privacy/stale", () => stale);
vi.mock("@/lib/privacy/rebuild", () => rebuild);
vi.mock("@/lib/republish", () => ({
  stableStringify: (v: unknown) => JSON.stringify(v),
}));
vi.mock("@/lib/privacy/settings", async () => {
  const actual = await vi.importActual<typeof import("@/lib/privacy/settings")>("@/lib/privacy/settings");
  return { ...actual, loadPrivacySettings: async () => actual.normalizeSettings(settingsState.value) };
});
vi.mock("@/lib/db", () => ({
  privacySettings: { id: "id" },
  privacyZones: {},
  getDb: () => ({
    insert: () => ({ values: async (v: unknown) => void inserted.push(v) }),
    select: () => ({ from: () => ({ orderBy: () => ({ limit: async () => [] }) }) }),
  }),
}));

import { GET as listZonesRoute, POST as createZoneRoute } from "@/app/api/admin/privacy/zones/route";
import { PATCH as patchZoneRoute, DELETE as deleteZoneRoute } from "@/app/api/admin/privacy/zones/[id]/route";
import { POST as restoreZoneRoute } from "@/app/api/admin/privacy/zones/[id]/restore/route";
import { GET as getSettingsRoute, POST as postSettingsRoute } from "@/app/api/admin/privacy/settings/route";
import { POST as rebuildRoute } from "@/app/api/admin/privacy/rebuild/route";
import { ZoneError } from "@/lib/privacy/zones";

const sq = [[[0, 0], [0.01, 0], [0.01, 0.01], [0, 0.01], [0, 0]]];
const sq2 = [[[1, 1], [1.01, 1], [1.01, 1.01], [1, 1.01], [1, 1]]];
const req = (method: string, body?: unknown) =>
  new Request("http://localhost/api/admin/privacy/x", {
    method,
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
const ctx = (id = "4") => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.clearAllMocks();
  denied.value = false;
  inserted.length = 0;
  settingsState.value = null;
  stale.countPending.mockResolvedValue(7);
  stale.markStaleForZones.mockResolvedValue(3);
  stale.markAllStale.mockResolvedValue(12);
});

describe("auth", () => {
  it("every privacy route requires admin", async () => {
    denied.value = true;
    const responses = await Promise.all([
      listZonesRoute(req("GET")),
      createZoneRoute(req("POST", { polygon: sq })),
      patchZoneRoute(req("PATCH", { name: "x" }), ctx()),
      deleteZoneRoute(req("DELETE"), ctx()),
      restoreZoneRoute(req("POST"), ctx()),
      getSettingsRoute(req("GET")),
      postSettingsRoute(req("POST", {})),
      rebuildRoute(req("POST")),
    ]);
    expect(responses.map((r) => r.status)).toEqual(Array(8).fill(401));
    expect(zonesLib.createZone).not.toHaveBeenCalled();
    expect(stale.markAllStale).not.toHaveBeenCalled();
    expect(rebuild.republishPending).not.toHaveBeenCalled();
  });
});

describe("zones", () => {
  it("GET lists groups with the pending count", async () => {
    zonesLib.listZones.mockResolvedValue([{ rootId: 1 }]);
    const res = await listZonesRoute(req("GET"));
    expect(await res.json()).toEqual({ ok: true, zones: [{ rootId: 1 }], pending: 7 });
  });

  it("POST validates and normalizes the polygon, then marks stale", async () => {
    zonesLib.createZone.mockResolvedValue({ zone: { id: 9 }, touched: [sq] });
    const res = await createZoneRoute(req("POST", { name: " home ", polygon: [sq[0].slice(0, 4)] }));
    expect(res.status).toBe(200);
    expect(zonesLib.createZone).toHaveBeenCalledWith("home", sq, { markStale: stale.markStaleForZones });
    expect(stale.markStaleForZones).toHaveBeenCalledWith([sq]);
    expect(await res.json()).toEqual({ ok: true, zone: { id: 9 }, marked: 3, pending: 7 });
  });

  it("POST rejects bad bodies with 400 and writes nothing", async () => {
    for (const body of ["not json", { polygon: [[[0, 0], [1, 1]]] }, { name: 5, polygon: sq }, [sq]]) {
      const res = await createZoneRoute(req("POST", body));
      expect(res.status).toBe(400);
    }
    expect(zonesLib.createZone).not.toHaveBeenCalled();
    expect(stale.markStaleForZones).not.toHaveBeenCalled();
  });

  it("PATCH passes a validated patch and marks old + new geometry stale", async () => {
    zonesLib.updateZone.mockResolvedValue({ zone: { id: 10 }, touched: [sq, sq2] });
    const res = await patchZoneRoute(req("PATCH", { polygon: sq2, enabled: false }), ctx());
    expect(res.status).toBe(200);
    expect(zonesLib.updateZone).toHaveBeenCalledWith(4, { polygon: sq2, enabled: false }, { markStale: stale.markStaleForZones });
    expect(stale.markStaleForZones).toHaveBeenCalledWith([sq, sq2]);
    expect((await res.json()).pending).toBe(7);
  });

  it("PATCH validation: bad id, bad fields, empty patch", async () => {
    expect((await patchZoneRoute(req("PATCH", { name: "x" }), ctx("abc"))).status).toBe(400);
    expect((await patchZoneRoute(req("PATCH", { enabled: "yes" }), ctx())).status).toBe(400);
    expect((await patchZoneRoute(req("PATCH", { polygon: "x" }), ctx())).status).toBe(400);
    expect((await patchZoneRoute(req("PATCH", {}), ctx())).status).toBe(400);
    expect(zonesLib.updateZone).not.toHaveBeenCalled();
  });

  it("zone errors map to their status (404 missing, 409 archived)", async () => {
    zonesLib.updateZone.mockRejectedValue(new ZoneError(409, "zone is archived — restore it first"));
    const res = await patchZoneRoute(req("PATCH", { name: "x" }), ctx());
    expect(res.status).toBe(409);
    zonesLib.archiveZone.mockRejectedValue(new ZoneError(404, "zone not found"));
    expect((await deleteZoneRoute(req("DELETE"), ctx())).status).toBe(404);
    expect(stale.markStaleForZones).not.toHaveBeenCalled();
  });

  it("DELETE archives and marks stale", async () => {
    zonesLib.archiveZone.mockResolvedValue({ zone: { id: 4 }, touched: [sq] });
    const res = await deleteZoneRoute(req("DELETE"), ctx());
    expect(res.status).toBe(200);
    expect(zonesLib.archiveZone).toHaveBeenCalledWith(4, { markStale: stale.markStaleForZones });
    expect(stale.markStaleForZones).toHaveBeenCalledWith([sq]);
  });

  it("restore marks the restored and the displaced geometry stale", async () => {
    zonesLib.restoreZone.mockResolvedValue({ zone: { id: 4 }, touched: [sq, sq2] });
    const res = await restoreZoneRoute(req("POST"), ctx());
    expect(res.status).toBe(200);
    expect(zonesLib.restoreZone).toHaveBeenCalledWith(4, { markStale: stale.markStaleForZones });
    expect(stale.markStaleForZones).toHaveBeenCalledWith([sq, sq2]);
  });

  it("rejects zones with holes or several parts", async () => {
    const res = await createZoneRoute(req("POST", { polygon: [sq[0], sq2[0]] }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/single ring/);
    expect((await patchZoneRoute(req("PATCH", { polygon: [sq[0], sq2[0]] }), ctx())).status).toBe(400);
    expect(zonesLib.createZone).not.toHaveBeenCalled();
    expect(zonesLib.updateZone).not.toHaveBeenCalled();
  });
});

describe("settings", () => {
  it("GET returns the settings in effect", async () => {
    const res = await getSettingsRoute(req("GET"));
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.settings.distance.mode).toBe("visible-only");
    expect(body.pending).toBe(7);
  });

  it("POST inserts a normalized row merged onto the current one, then marks everything stale", async () => {
    const res = await postSettingsRoute(req("POST", { coarsenStartMin: 15, distance: { mode: "visible-only" } }));
    expect(res.status).toBe(200);
    expect(inserted).toEqual([
      { settings: { distance: { mode: "visible-only", roundToM: 100 }, coarsenStartMin: 15, defaultTrimM: expect.any(Number) } },
    ]);
    // before the insert and after it
    expect(stale.markAllStale).toHaveBeenCalledTimes(2);
    expect(await res.json()).toMatchObject({ ok: true, marked: 12, pending: 7 });
  });

  it("POST rejects invalid values instead of silently replacing them", async () => {
    for (const body of [{ coarsenStartMin: 7 }, { distance: { mode: "nope" } }, { distance: { roundToM: 1 } }, { defaultTrimM: -1 }, { distance: "x" }, "bad"]) {
      expect((await postSettingsRoute(req("POST", body))).status).toBe(400);
    }
    expect(inserted).toHaveLength(0);
    expect(stale.markAllStale).not.toHaveBeenCalled();
  });

  it("POST with no change inserts nothing", async () => {
    const res = await postSettingsRoute(req("POST", { coarsenStartMin: 0 }));
    expect(await res.json()).toMatchObject({ ok: true, unchanged: true });
    expect(inserted).toHaveLength(0);
    expect(stale.markAllStale).not.toHaveBeenCalled();
  });
});

describe("rebuild", () => {
  it("runs one batch with revalidation and returns the remaining count", async () => {
    rebuild.republishPending.mockResolvedValue({ results: [{ id: 1, status: "published" }], failedIds: [], remaining: 4, timedOut: false });
    const res = await rebuildRoute(req("POST", { excludeIds: [3, "x", -1] }));
    expect(res.status).toBe(200);
    const opts = rebuild.republishPending.mock.calls[0][0];
    expect(opts.excludeIds).toEqual([3]);
    opts.revalidate("/activities/1");
    expect(revalidate).toHaveBeenCalledWith("/activities/1");
    expect(await res.json()).toMatchObject({ ok: true, processed: 1, remaining: 4, failedIds: [] });
  });

  it("a failing batch is a 500, not a crash", async () => {
    rebuild.republishPending.mockRejectedValue(new Error("db down"));
    expect((await rebuildRoute(req("POST"))).status).toBe(500);
  });
});
