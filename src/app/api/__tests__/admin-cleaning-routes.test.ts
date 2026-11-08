import { describe, it, expect, vi, beforeEach } from "vitest";
import type { CanonicalTrack } from "@/lib/canonical-track";

// in-memory stand-in for the cleaning io (src/lib/cleaning/load.ts): rows are
// only ever inserted or stamped, like the real thing
const { denied, db, republish, revalidate, invalidate, calls, stale } = vi.hoisted(() => {
  type Row = Record<string, unknown> & { id: number };
  const db = {
    activities: new Map<number, Row>(),
    edits: [] as Row[],
    suggestions: [] as Row[],
    sources: [] as Row[],
    tracks: new Map<number, CanonicalTrack | "unavailable">(),
    nextId: 1000,
    reset() {
      this.activities.clear();
      this.edits.length = 0;
      this.suggestions.length = 0;
      this.sources.length = 0;
      this.tracks.clear();
      this.nextId = 1000;
    },
  };
  return {
    denied: { value: false },
    db,
    republish: vi.fn(),
    revalidate: vi.fn(),
    invalidate: vi.fn(),
    calls: [] as string[], // write/republish order
    stale: { markAllStale: vi.fn() },
  };
});

vi.mock("@/lib/admin-auth", async () => {
  const { NextResponse } = await import("next/server");
  return { requireAdmin: async () => (denied.value ? NextResponse.json({ error: "unauthorized" }, { status: 401 }) : null) };
});
vi.mock("next/cache", () => ({ revalidatePath: (p: string) => revalidate(p) }));
vi.mock("@/lib/cache", () => ({ invalidateCache: (...a: unknown[]) => invalidate(...a) }));
vi.mock("@/lib/privacy/stale", () => stale);

vi.mock("@/lib/republish", async (orig) => {
  const actual = await orig<typeof import("@/lib/republish")>();
  return {
    ...actual,
    republish: (id: number) => {
      calls.push(`republish:${id}`);
      return republish(id);
    },
    defaultDeps: () => ({
      loadSources: async (id: number) => db.sources.filter((s) => s.activityId === id).map((s) => ({ id: s.id, kind: s.kind, provider: s.provider, externalId: s.externalId, rawSha256: s.rawSha256 })),
    }),
  };
});

vi.mock("@/lib/activities", async (orig) => {
  const actual = await orig<typeof import("@/lib/activities")>();
  return {
    ...actual,
    insertActivity: async (values: Record<string, unknown>) => {
      const existing = [...db.activities.values()].find((a) => a.dedupeKey === values.dedupeKey);
      if (existing) return { inserted: false, id: existing.id };
      const id = db.nextId++;
      db.activities.set(id, { ...actual.withheldRoute(values as never), id } as never);
      calls.push(`insertActivity:${id}`);
      return { inserted: true, id };
    },
  };
});

vi.mock("@/lib/cleaning/load", async () => {
  const { DEFAULT_PRIVACY_SETTINGS } = await import("@/lib/privacy/settings");
  const { DEFAULT_ACTIVITY_SETTINGS } = await import("@/lib/cleaning/settings");
  const clone = <T,>(v: T): T => structuredClone(v);
  return {
    getActivity: async (id: number) => (db.activities.has(id) ? clone(db.activities.get(id)) : null),
    listEdits: async (id: number) => clone(db.edits.filter((e) => e.activityId === id)),
    getEdit: async (id: number) => clone(db.edits.find((e) => e.id === id) ?? null),
    listSuggestions: async (id: number) => clone(db.suggestions.filter((s) => s.activityId === id && s.detectorVersion === 1)),
    getSuggestion: async (id: number) => clone(db.suggestions.find((s) => s.id === id) ?? null),
    listMergeCandidates: async (row: { id: number; startDateUtc: Date }) =>
      [...db.activities.values()]
        .filter((a) => a.id !== row.id && !a.hidden && Math.abs((a.startDateUtc as Date).getTime() - row.startDateUtc.getTime()) <= 12 * 3600e3)
        .map((a) => ({ id: a.id, name: a.name, startDateUtc: a.startDateUtc, distanceM: a.distanceM, sportType: a.sportType })),
    listChildren: async (id: number) =>
      [...db.activities.values()].filter((a) => a.splitFromId === id).map((a) => ({ id: a.id, name: a.name, startDateUtc: a.startDateUtc, hidden: a.hidden })),
    findActivityIdByDedupeKey: async (key: string) => [...db.activities.values()].find((a) => a.dedupeKey === key)?.id ?? null,
    insertEdit: async (activityId: number, kind: string, params: Record<string, unknown>, note: string | null) => {
      const id = db.nextId++;
      db.edits.push({ id, activityId, kind, params: clone(params), note, createdAt: new Date(), revertedAt: null });
      calls.push(`edit:${activityId}:${kind}`);
      return id;
    },
    revertEditOnce: async (id: number) => {
      const e = db.edits.find((x) => x.id === id);
      if (!e || e.revertedAt) return false;
      e.revertedAt = new Date();
      calls.push(`revert:${id}`);
      return true;
    },
    decideSuggestion: async (id: number, status: string, editId: number | null) => {
      const s = db.suggestions.find((x) => x.id === id);
      if (!s || s.status !== "open") return false;
      Object.assign(s, { status, editId, decidedAt: new Date() });
      return true;
    },
    setHidden: async (id: number, hidden: boolean) => {
      const a = db.activities.get(id);
      if (a) a.hidden = hidden;
      calls.push(`hidden:${id}:${hidden}`);
    },
    copySources: async (from: number, to: number) => {
      const rows = db.sources.filter((s) => s.activityId === from);
      for (const r of rows) {
        const dup = db.sources.some((s) => s.activityId === to && s.kind === r.kind && s.rawSha256 === r.rawSha256 && s.provider === r.provider && s.externalId === r.externalId);
        if (!dup) db.sources.push({ ...r, id: db.nextId++, activityId: to });
      }
      return rows.length;
    },
    markStale: async (ids: number[]) => void calls.push(`stale:${ids.join(",")}`),
    loadTrackForRow: async (row: { id: number }) => {
      const t = db.tracks.get(row.id);
      if (t === "unavailable") return { status: "unavailable", row, ref: {} };
      return t ? { status: "ok", row, track: t, ref: {} } : { status: "no-track", row };
    },
    loadPublishContext: async (row: { sportType: string }) => ({
      zones: [], settings: DEFAULT_PRIVACY_SETTINGS, activity: DEFAULT_ACTIVITY_SETTINGS, merged: [], sportType: row.sportType,
    }),
  };
});

import { GET as getCleaning } from "@/app/api/admin/activities/[id]/cleaning/route";
import { POST as preview } from "@/app/api/admin/activities/[id]/cleaning/preview/route";
import { POST as postEdit } from "@/app/api/admin/activities/[id]/edits/route";
import { POST as revert } from "@/app/api/admin/activities/[id]/edits/[editId]/revert/route";
import { POST as decide } from "@/app/api/admin/activities/[id]/suggestions/[sid]/route";
import { POST as split } from "@/app/api/admin/activities/[id]/split/route";
import { POST as merge } from "@/app/api/admin/activities/[id]/merge/route";
import { splitDedupeKey } from "@/lib/cleaning/plan";

// ---------------------------------------------------------------------------
// fixtures

function synthTrack(n = 600): CanonicalTrack {
  const c: CanonicalTrack["columns"] = { t: [], lat: [], lng: [], ele: [], hr: [], cadence: [], watts: [], speed: [], dist: [] };
  for (let i = 0; i < n; i++) {
    c.t.push(i);
    c.lat.push(47 + i * 0.00003);
    c.lng.push(8 + Math.sin(i / 50) * 0.001);
    c.ele.push(400 + i * 0.1);
    c.hr.push(130 + (i % 40));
    c.cadence.push(null);
    c.watts.push(null);
    c.speed.push(3.3);
    c.dist.push(i * 3.3);
  }
  return {
    format: "canonical-track", v: 1, source: { kind: "device-file", sha256: "a".repeat(64), fileType: "fit" },
    sportType: "Run", startEpochMs: Date.UTC(2026, 9, 1, 8), utcOffsetMin: 60, hasLocalTime: true, syntheticTime: false,
    session: null, kilojoules: null, suggestedName: "run", columns: c,
  };
}

const at = (h: number, m = 0) => new Date(Date.UTC(2026, 9, 1, h, m));
const T0 = Date.UTC(2026, 9, 1, 8); // synthTrack's startEpochMs (the anchor)

function addActivity(id: number, over: Record<string, unknown> = {}) {
  db.activities.set(id, {
    id, name: `act ${id}`, sportType: "Run", startDateUtc: at(8), localDate: "2026-10-01", localTime: "09:00", utcOffsetMin: 60,
    distanceM: 1980, movingTimeS: 600, elapsedTimeS: 600, elevGainM: 60, avgSpeedMs: 3.3, maxSpeedMs: 3.3,
    avgHr: 150, maxHr: 169, avgCadence: null, avgWatts: null, maxWatts: null, kilojoules: null, description: "desc",
    sufferScore: null, gear: "shoes", polyline: "abc", cardPolyline: "ab", bounds: { minLat: 1, minLng: 2, maxLat: 3, maxLng: 4 },
    trimStartM: 200, trimEndM: 200, fitBlobUrl: "https://x/f.fit", fitBlobPathname: "activities/fit/f.fit", fitSha256: "a".repeat(64),
    fileType: "fit", source: "upload", externalId: `ext${id}`, dedupeKey: `key${id}`, hidden: false, processingVersion: 3,
    mapHidden: false, hrHidden: false, rawStats: { distanceM: 2000 }, hrZonesS: [1, 2, 3, 4, 5], splitFromId: null, legacyRoute: null,
    ...over,
  });
  db.sources.push({ id: db.nextId++, activityId: id, provider: "upload", externalId: null, kind: "device-file", rawSha256: `${id}`.padEnd(64, "0") });
  db.tracks.set(id, synthTrack());
}

function addEdit(activityId: number, kind: string, params: Record<string, unknown>, revertedAt: Date | null = null) {
  const id = db.nextId++;
  db.edits.push({ id, activityId, kind, params, note: null, createdAt: new Date(), revertedAt });
  return id;
}

const active = (activityId: number) => db.edits.filter((e) => e.activityId === activityId && !e.revertedAt);

const req = (body?: unknown) =>
  new Request("http://localhost/api/admin/x", {
    method: body === undefined ? "GET" : "POST",
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
const ctx = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });
const id5 = ctx({ id: "5" });

beforeEach(() => {
  vi.clearAllMocks();
  db.reset();
  calls.length = 0;
  denied.value = false;
  republish.mockImplementation(async (id: number) => ({ status: "published", id }));
  stale.markAllStale.mockResolvedValue(4);
  addActivity(5);
});

// ---------------------------------------------------------------------------

describe("auth", () => {
  it("every cleaning route requires admin and writes nothing", async () => {
    denied.value = true;
    const res = await Promise.all([
      getCleaning(req(), id5),
      preview(req({ edits: [] }), id5),
      postEdit(req({ kind: "no-gps" }), id5),
      revert(req({}), ctx({ id: "5", editId: "1" })),
      decide(req({ action: "accept" }), ctx({ id: "5", sid: "1" })),
      split(req({ atS: 100 }), id5),
      merge(req({ otherId: 6 }), id5),
    ]);
    expect(res.map((r) => r.status)).toEqual(Array(7).fill(401));
    expect(calls).toEqual([]);
    expect(republish).not.toHaveBeenCalled();
  });
});

describe("GET cleaning", () => {
  it("400 bad id, 404 unknown", async () => {
    expect((await getCleaning(req(), ctx({ id: "x" }))).status).toBe(400);
    expect((await getCleaning(req(), ctx({ id: "99" }))).status).toBe(404);
  });

  it("returns the full contract", async () => {
    db.tracks.set(5, synthTrack(5000));
    const reverted = addEdit(5, "crop", { startS: 10, endS: null }, new Date());
    const live = addEdit(5, "cut", { fromS: 50, toS: 60 });
    db.suggestions.push(
      { id: 1, activityId: 5, detectorVersion: 1, kind: "crop-head", confidence: 0.9, edit: { kind: "crop", params: { startS: 30, endS: null } }, summary: "s", range: { fromS: 0, toS: 30 }, status: "dismissed", editId: null, createdAt: new Date(), decidedAt: new Date() },
      { id: 2, activityId: 5, detectorVersion: 0, kind: "idle", confidence: 0.5, edit: null, summary: "old", range: null, status: "open", editId: null, createdAt: new Date(), decidedAt: null },
    );
    addActivity(6, { startDateUtc: at(14) });
    addActivity(7, { startDateUtc: at(23) }); // too far
    addActivity(8, { startDateUtc: at(9), hidden: true });
    addActivity(9, { startDateUtc: at(10), splitFromId: 5 });

    const res = await getCleaning(req(), id5);
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.ok).toBe(true);
    expect(j.trackStatus).toBe("ok");
    expect(Object.keys(j.track).sort()).toEqual(["dist", "ele", "hr", "lat", "lng", "speed", "t"]);
    expect(j.track.t.length).toBeLessThanOrEqual(3000);
    expect(j.track.t[0]).toBe(0);
    expect(j.track.t[j.track.t.length - 1]).toBe(4999);
    expect(j.totalPoints).toBe(5000);
    expect(j.startEpochMs).toBe(Date.UTC(2026, 9, 1, 8));
    expect(j.published).toMatchObject({ polyline: "abc", cardPolyline: "ab", bounds: { minLat: 1 }, distanceM: 1980, hrZonesS: [1, 2, 3, 4, 5], trimStartM: 200 });
    expect(j.rawStats).toEqual({ distanceM: 2000 });
    expect(j.edits.map((e: { id: number }) => e.id)).toEqual([reverted, live]);
    expect(j.edits[0]).toEqual({ id: reverted, kind: "crop", params: { startS: 10, endS: null }, note: null, createdAt: expect.any(String), revertedAt: expect.any(String) });
    expect(j.suggestions.map((s: { id: number }) => s.id)).toEqual([1]);
    expect(j.suggestions[0]).toMatchObject({ status: "dismissed", edit: { kind: "crop" }, range: { fromS: 0, toS: 30 } });
    expect(j.mergeCandidates.map((m: { id: number }) => m.id).sort()).toEqual([6, 9]);
    expect(Object.keys(j.mergeCandidates[0]).sort()).toEqual(["distanceM", "id", "name", "sportType", "startDateUtc"]);
    expect(j.splitFromId).toBeNull();
    expect(j.children).toEqual([{ id: 9, name: "act 9", startDateUtc: at(10).toISOString(), hidden: false }]);
    expect(calls).toEqual([]);
  });

  it("no track / unreadable track: everything else still comes back", async () => {
    db.tracks.set(5, "unavailable");
    const j = await (await getCleaning(req(), id5)).json();
    expect(j).toMatchObject({ ok: true, trackStatus: "unavailable", track: null, startEpochMs: null });
    db.tracks.delete(5);
    expect(await (await getCleaning(req(), id5)).json()).toMatchObject({ ok: true, trackStatus: "no-track", track: null });
  });
});

describe("preview", () => {
  it("validates every edit", async () => {
    for (const body of [
      "nope", {}, { edits: "x" }, { edits: [{ kind: "trim", params: {} }] }, { edits: [{ kind: "split", params: {} }] },
      { edits: [{ kind: "crop", params: {} }] }, { edits: [{ kind: "cut", params: { fromS: 9, toS: 1 } }] },
      { edits: [{ kind: "merge", params: { withActivityId: 5 } }] }, { edits: [{ kind: "drop-points", params: { ts: [] } }] },
    ]) {
      expect((await preview(req(body), id5)).status).toBe(400);
    }
  });

  it("applies current edits + proposed ones and writes nothing", async () => {
    const base = await (await preview(req({ edits: [] }), id5)).json();
    expect(base.ok).toBe(true);
    expect(Object.keys(base.preview).sort()).toEqual(["bounds", "cardPolyline", "polyline", "stats"]);
    expect(base.preview.stats).toHaveProperty("hrZonesS");
    const cropped = await (await preview(req({ edits: [{ kind: "crop", params: { startS: 300, endS: null } }] }), id5)).json();
    expect(cropped.preview.stats.distanceM).toBeLessThan(base.preview.stats.distanceM * 0.7);
    expect(cropped.preview.polyline).not.toBe(base.preview.polyline);

    // an active crop is part of the baseline; crops intersect, so a wider
    // proposed crop changes nothing and a narrower one narrows
    addEdit(5, "crop", { startS: 300, endS: null });
    const withActive = await (await preview(req({ edits: [] }), id5)).json();
    expect(withActive.preview.stats.distanceM).toBeCloseTo(cropped.preview.stats.distanceM);
    const wider = await (await preview(req({ edits: [{ kind: "crop", params: { startS: 100, endS: null } }] }), id5)).json();
    expect(wider.preview.stats.distanceM).toBeCloseTo(withActive.preview.stats.distanceM);
    const narrower = await (await preview(req({ edits: [{ kind: "crop", params: { startS: null, endS: 450 } }] }), id5)).json();
    expect(narrower.preview.stats.distanceM).toBeLessThan(withActive.preview.stats.distanceM);

    const noGps = await (await preview(req({ edits: [{ kind: "no-gps", params: {} }] }), id5)).json();
    expect(noGps.preview).toMatchObject({ polyline: null, cardPolyline: null, bounds: null });

    expect(calls).toEqual([]);
    expect(republish).not.toHaveBeenCalled();
  });

  it("404 / 422 / 503", async () => {
    expect((await preview(req({ edits: [] }), ctx({ id: "99" }))).status).toBe(404);
    db.tracks.delete(5);
    expect((await preview(req({ edits: [] }), id5)).status).toBe(422);
    db.tracks.set(5, "unavailable");
    expect((await preview(req({ edits: [] }), id5)).status).toBe(503);
  });
});

describe("POST edits", () => {
  it("records a validated edit, republishes, refreshes caches", async () => {
    const res = await postEdit(req({ kind: "drop-points", params: { ts: [30, 10, 30] }, note: " spike " }), id5);
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j).toEqual({ ok: true, editId: expect.any(Number), status: "published" });
    expect(db.edits.find((e) => e.id === j.editId)).toMatchObject({ activityId: 5, kind: "drop-points", params: { ts: [10, 30] }, note: "spike" });
    expect(calls).toEqual(["edit:5:drop-points", "republish:5"]);
    expect(invalidate).toHaveBeenCalledWith("activities_list", "activities_latest");
    expect(revalidate).toHaveBeenCalledWith("/activities/5");
  });

  it("only crop, cut, drop-points, no-gps with valid params", async () => {
    for (const body of [
      { kind: "merge", params: { withActivityId: 6 } }, { kind: "split", params: { atS: 3 } }, { kind: "merged-into", params: {} },
      { kind: "trim", params: { startM: 1, endM: 1 } }, { kind: "crop", params: { startS: 5, endS: 2 } }, { kind: "cut", params: "x" },
      { kind: "no-gps", note: 5 }, { params: {} }, "bad",
    ]) {
      expect((await postEdit(req(body), id5)).status).toBe(400);
    }
    expect((await postEdit(req({ kind: "no-gps" }), ctx({ id: "99" }))).status).toBe(404);
    expect(db.edits).toHaveLength(0);
  });

  it("an edit republish can't reflect is reverted (422 / 503 / 500)", async () => {
    republish.mockResolvedValueOnce({ status: "no-source" });
    expect((await postEdit(req({ kind: "no-gps" }), id5)).status).toBe(422);
    republish.mockResolvedValueOnce({ status: "source-unavailable" });
    expect((await postEdit(req({ kind: "no-gps" }), id5)).status).toBe(503);
    republish.mockRejectedValueOnce(new Error("boom"));
    expect((await postEdit(req({ kind: "no-gps" }), id5)).status).toBe(500);
    expect(db.edits).toHaveLength(3);
    expect(db.edits.every((e) => e.revertedAt)).toBe(true);
  });
});

describe("revert", () => {
  it("generic: stamps reverted_at, republishes; repeating is a no-op", async () => {
    const e = addEdit(5, "cut", { fromS: 1, toS: 2 });
    const res = await revert(req({}), ctx({ id: "5", editId: String(e) }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, reverted: [e], republished: { 5: "published" } });
    expect(db.edits).toHaveLength(1);
    expect(db.edits[0].revertedAt).toBeInstanceOf(Date);
    expect(calls).toEqual([`revert:${e}`, "stale:5", "republish:5"]);
    expect(revalidate).toHaveBeenCalledWith("/activities/5");

    calls.length = 0;
    expect(await (await revert(req({}), ctx({ id: "5", editId: String(e) }))).json()).toEqual({ ok: true, reverted: [], republished: {} });
    expect(calls).toEqual([]);
  });

  it("404 for an edit of another activity; 400 bad ids", async () => {
    addActivity(6);
    const e = addEdit(6, "cut", { fromS: 1, toS: 2 });
    expect((await revert(req({}), ctx({ id: "5", editId: String(e) }))).status).toBe(404);
    expect((await revert(req({}), ctx({ id: "5", editId: "x" }))).status).toBe(400);
    expect(db.edits[0].revertedAt).toBeNull();
  });

  it("a reverted accepted suggestion stays accepted", async () => {
    const e = addEdit(5, "crop", { startS: 30, endS: null });
    db.suggestions.push({ id: 1, activityId: 5, detectorVersion: 1, kind: "crop-head", confidence: 0.95, edit: { kind: "crop", params: { startS: 30, endS: null } }, summary: "s", range: null, status: "accepted", editId: e, createdAt: new Date(), decidedAt: new Date() });
    await revert(req({}), ctx({ id: "5", editId: String(e) }));
    expect(db.suggestions[0].status).toBe("accepted");
  });
});

describe("suggestions", () => {
  const sug = (over: Record<string, unknown> = {}) => {
    db.suggestions.push({
      id: 1, activityId: 5, detectorVersion: 1, kind: "crop-head", confidence: 0.8, edit: { kind: "crop", params: { startS: 30, endS: null } },
      summary: "standing at the start", range: { fromS: 0, toS: 30 }, status: "open", editId: null, createdAt: new Date(), decidedAt: null, ...over,
    });
  };
  const act = (action: unknown, sid = "1") => decide(req({ action }), ctx({ id: "5", sid }));

  it("accept: creates the edit with an 'accepted:' note, stamps the suggestion, republishes; idempotent", async () => {
    sug();
    const j = await (await act("accept")).json();
    expect(j).toMatchObject({ ok: true, unchanged: false, suggestion: { id: 1, status: "accepted", editId: expect.any(Number) }, republished: { 5: "published" } });
    expect(db.edits).toEqual([expect.objectContaining({ id: j.suggestion.editId, kind: "crop", params: { startS: 30, endS: null, anchorEpochMs: T0 }, note: "accepted: standing at the start" })]);
    expect(db.suggestions[0].decidedAt).toBeInstanceOf(Date);
    expect(republish).toHaveBeenCalledWith(5);

    const again = await (await act("accept")).json();
    expect(again).toMatchObject({ ok: true, unchanged: true, suggestion: { editId: j.suggestion.editId } });
    expect(db.edits).toHaveLength(1);
    expect((await act("dismiss")).status).toBe(409);
  });

  it("dismiss: stamps dismissed; idempotent; can't then accept", async () => {
    sug();
    expect(await (await act("dismiss")).json()).toMatchObject({ ok: true, unchanged: false, suggestion: { status: "dismissed", editId: null } });
    expect(db.suggestions[0].decidedAt).toBeInstanceOf(Date);
    expect(await (await act("dismiss")).json()).toMatchObject({ ok: true, unchanged: true });
    expect((await act("accept")).status).toBe(409);
    expect(db.edits).toHaveLength(0);
  });

  it("information-only, invalid stored edit, bad action, wrong activity", async () => {
    sug({ edit: null });
    expect((await act("accept")).status).toBe(409);
    sug({ id: 2, edit: { kind: "crop", params: { startS: 50, endS: 10 } } });
    expect((await act("accept", "2")).status).toBe(400);
    sug({ id: 3, edit: { kind: "merge", params: { withActivityId: 6 } } });
    expect((await act("accept", "3")).status).toBe(400);
    sug({ id: 4, activityId: 6 });
    expect((await act("accept", "4")).status).toBe(404);
    expect((await act("approve")).status).toBe(400);
    expect((await act("accept", "99")).status).toBe(404);
    expect(db.edits).toHaveLength(0);
    expect(db.suggestions.every((s) => s.status === "open")).toBe(true);
  });
});

describe("split", () => {
  const doSplit = (atS: unknown, id = "5") => split(req({ atS }), ctx({ id }));

  it("rejects atS outside the cleaned range", async () => {
    addEdit(5, "crop", { startS: 100, endS: 500 });
    for (const atS of [100, 500, 50, 599, 0, -3, "200", null]) expect((await doSplit(atS)).status).toBe(400);
    expect(db.activities.size).toBe(1);
  });

  it("creates the child, crops both, records the marker, republishes both", async () => {
    addEdit(5, "crop", { startS: 20, endS: 550 });
    const trim = addEdit(5, "trim", { startM: 50, endM: 80 });
    const res = await doSplit(300.4);
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j).toMatchObject({ ok: true, childId: expect.any(Number), reused: false, republished: { 5: "published" } });
    const child = db.activities.get(j.childId)!;
    expect(child).toMatchObject({
      name: "act 5 (2)", sportType: "Run", gear: "shoes", description: null, source: "upload", externalId: null,
      startDateUtc: new Date(at(8).getTime() + 300_000), localDate: "2026-10-01", localTime: "09:05",
      dedupeKey: splitDedupeKey("key5", 300), fitSha256: "a".repeat(64), fitBlobPathname: "activities/fit/f.fit", splitFromId: 5,
    });
    // no route of its own until republish
    expect(child.polyline ?? null).toBeNull();
    expect(child.bounds ?? null).toBeNull();
    expect(db.sources.filter((s) => s.activityId === j.childId).map((s) => s.rawSha256)).toEqual(db.sources.filter((s) => s.activityId === 5).map((s) => s.rawSha256));
    expect(active(j.childId).map((e) => [e.kind, e.params])).toEqual([
      ["crop", { startS: 300, endS: 550, anchorEpochMs: T0 }],
      ["trim", { startM: 50, endM: 80 }],
    ]);
    const parentNew = active(5).filter((e) => e.id !== trim).slice(1);
    // crops intersect: the earlier 20–550 crop keeps the start
    expect(parentNew.map((e) => [e.kind, e.params])).toEqual([
      ["crop", { startS: null, endS: 300, anchorEpochMs: T0 }],
      ["split", { childId: j.childId, atS: 300, parentCropEditId: parentNew[0].id }],
    ]);
    expect(j.parentCropEditId).toBe(parentNew[0].id);
    expect(j.markerEditId).toBe(parentNew[1].id);
    expect(calls.filter((c) => c.startsWith("republish"))).toEqual(["republish:5", `republish:${j.childId}`]);
    expect(revalidate).toHaveBeenCalledWith(`/activities/${j.childId}`);
  });

  it("carries cleaning in the second half over to the child", async () => {
    addEdit(5, "cut", { fromS: 100, toS: 150 }); // first half only: stays on the parent
    addEdit(5, "cut", { fromS: 400, toS: 450 });
    addEdit(5, "drop-points", { ts: [12, 480] });
    const res = await doSplit(300);
    const j = await res.json();
    expect(active(j.childId).map((e) => e.kind).sort()).toEqual(["crop", "cut", "drop-points"]);
    expect(active(j.childId).find((e) => e.kind === "cut")!.params).toEqual({ fromS: 400, toS: 450 });
  });

  it("is safe to retry: a finished split is reused without new rows", async () => {
    const first = await (await doSplit(300)).json();
    const edits = db.edits.length;
    const again = await (await doSplit(300)).json();
    expect(again).toMatchObject({ ok: true, childId: first.childId, reused: true, markerEditId: first.markerEditId, parentCropEditId: first.parentCropEditId });
    expect(db.edits).toHaveLength(edits);
    expect(db.activities.size).toBe(2);
  });

  it("resumes after a failure between the parent crop and the marker", async () => {
    const first = await (await doSplit(300)).json();
    // simulate the marker never having been written
    db.edits.splice(db.edits.findIndex((e) => e.id === first.markerEditId), 1);
    const again = await (await doSplit(300)).json();
    expect(again).toMatchObject({ ok: true, childId: first.childId, reused: true, parentCropEditId: first.parentCropEditId });
    expect(active(5).map((e) => e.kind)).toEqual(["crop", "split"]);
    expect(active(first.childId).map((e) => e.kind)).toEqual(["crop"]);
  });

  it("refuses merged activities; 404, 422, 503", async () => {
    addEdit(5, "merge", { withActivityId: 6 });
    expect((await doSplit(300)).status).toBe(409);
    addActivity(6);
    addEdit(6, "merged-into", { intoActivityId: 9, wasHidden: false });
    expect((await doSplit(300, "6")).status).toBe(409);
    expect((await doSplit(300, "99")).status).toBe(404);
    addActivity(7);
    db.tracks.delete(7);
    expect((await doSplit(300, "7")).status).toBe(422);
    db.tracks.set(7, "unavailable");
    expect((await doSplit(300, "7")).status).toBe(503);
  });

  it("revert: hides the child (never deletes), reverts the parent crop then the marker, republishes both", async () => {
    const s = await (await doSplit(300)).json();
    calls.length = 0;
    // the parent crop alone can't be reverted while the split is live
    expect((await revert(req({}), ctx({ id: "5", editId: String(s.parentCropEditId) }))).status).toBe(409);
    // nor the child's only crop
    const childCrop = active(s.childId)[0].id;
    expect((await revert(req({}), ctx({ id: String(s.childId), editId: String(childCrop) }))).status).toBe(409);

    const res = await revert(req({}), ctx({ id: "5", editId: String(s.markerEditId) }));
    expect(await res.json()).toEqual({ ok: true, reverted: [s.parentCropEditId, s.markerEditId], republished: { 5: "published", [s.childId]: "published" } });
    expect(calls).toEqual([`hidden:${s.childId}:true`, `revert:${s.parentCropEditId}`, `revert:${s.markerEditId}`, `stale:5,${s.childId}`, "republish:5", `republish:${s.childId}`]);
    expect(db.activities.get(s.childId)!.hidden).toBe(true);
    expect(active(5)).toEqual([]);

    // repeat: nothing more
    calls.length = 0;
    expect(await (await revert(req({}), ctx({ id: "5", editId: String(s.markerEditId) }))).json()).toEqual({ ok: true, reverted: [], republished: {} });
    expect(calls).toEqual([]);

    // re-split at the same point brings the same child back
    const again = await (await doSplit(300)).json();
    expect(again).toMatchObject({ ok: true, childId: s.childId, reused: true });
    expect(db.activities.get(s.childId)!.hidden).toBe(false);
    expect(active(5).map((e) => e.kind)).toEqual(["crop", "split"]);
    expect(active(s.childId).map((e) => e.kind)).toEqual(["crop"]);
    expect(db.activities.size).toBe(2);
  });

  it("a hidden parent makes a hidden child", async () => {
    db.activities.get(5)!.hidden = true;
    const s = await (await doSplit(300)).json();
    expect(db.activities.get(s.childId)!.hidden).toBe(true);
  });
});

describe("merge", () => {
  beforeEach(() => addActivity(6, { startDateUtc: at(9), hidden: false }));
  const doMerge = (otherId: unknown, id = "5") => merge(req({ otherId }), ctx({ id }));

  it("merges the later one into the earlier one, whichever route it's called on", async () => {
    const res = await doMerge(5, "6");
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j).toMatchObject({ ok: true, targetId: 5, absorbedId: 6, unchanged: false, republished: { 5: "published" } });
    expect(active(6).map((e) => [e.kind, e.params])).toEqual([["merged-into", { intoActivityId: 5, wasHidden: false }]]);
    expect(active(5).map((e) => [e.kind, e.params])).toEqual([["merge", { withActivityId: 6 }]]);
    expect(db.activities.get(6)!.hidden).toBe(true);
    // absorbed side first, so nothing shows twice
    expect(calls).toEqual(["edit:6:merged-into", "hidden:6:true", "edit:5:merge", "stale:5", "republish:5"]);
    expect(revalidate).toHaveBeenCalledWith("/activities/5");
    expect(revalidate).toHaveBeenCalledWith("/activities/6");
    expect(invalidate).toHaveBeenCalled();

    const again = await (await doMerge(6)).json();
    expect(again).toMatchObject({ ok: true, unchanged: true, mergeEditId: j.mergeEditId, markerEditId: j.markerEditId });
    expect(db.edits).toHaveLength(2);
  });

  it("refuses itself, unknown, far apart, chains and double merges", async () => {
    expect((await doMerge(5)).status).toBe(400);
    expect((await doMerge("6")).status).toBe(400);
    expect((await doMerge(99)).status).toBe(404);
    addActivity(7, { startDateUtc: at(23) });
    expect((await doMerge(7)).status).toBe(400);
    // 6 merged into 8 already
    addActivity(8, { startDateUtc: at(7) });
    addEdit(6, "merged-into", { intoActivityId: 8, wasHidden: false });
    expect((await doMerge(6)).status).toBe(409);
    // target 5 absorbed into 8 → 9 can't go into 5
    addActivity(9, { startDateUtc: at(10) });
    addEdit(5, "merged-into", { intoActivityId: 8, wasHidden: false });
    expect((await doMerge(9)).status).toBe(409);
    expect(calls).toEqual([]);
  });

  it("refuses split halves and trackless activities", async () => {
    db.activities.get(6)!.splitFromId = 5;
    expect((await doMerge(6)).status).toBe(409);
    db.activities.get(6)!.splitFromId = null;
    db.sources = db.sources.filter((s) => s.activityId !== 6);
    expect((await doMerge(6)).status).toBe(422);
    expect(db.edits).toHaveLength(0);
  });

  it("revert: target republished first, then the absorbed one gets its hidden flag back", async () => {
    db.activities.get(6)!.hidden = false;
    const m = await (await doMerge(6)).json();
    calls.length = 0;
    const res = await revert(req({}), ctx({ id: "5", editId: String(m.mergeEditId) }));
    expect(await res.json()).toEqual({ ok: true, reverted: [m.mergeEditId, m.markerEditId], republished: { 5: "published", 6: "published" } });
    expect(calls).toEqual([`revert:${m.mergeEditId}`, "stale:5", "republish:5", "hidden:6:false", `revert:${m.markerEditId}`, "stale:6", "republish:6"]);
    expect(db.activities.get(6)!.hidden).toBe(false);
    expect(db.edits).toHaveLength(2); // nothing deleted
    expect(await (await revert(req({}), ctx({ id: "5", editId: String(m.mergeEditId) }))).json()).toMatchObject({ reverted: [] });
  });

  it("revert restores wasHidden=true (merges made before privacy was checked), and works from the absorbed side's marker", async () => {
    db.activities.get(6)!.hidden = true;
    const markerEditId = addEdit(6, "merged-into", { intoActivityId: 5, wasHidden: true });
    const mergeEditId = addEdit(5, "merge", { withActivityId: 6 });
    const m = { markerEditId, mergeEditId };
    const res = await revert(req({}), ctx({ id: "6", editId: String(m.markerEditId) }));
    expect(await res.json()).toMatchObject({ ok: true, reverted: [m.mergeEditId, m.markerEditId] });
    expect(db.activities.get(6)!.hidden).toBe(true);
    expect(active(5)).toEqual([]);
    expect(active(6)).toEqual([]);
  });

  it("revert finishes a half-done earlier revert, but never undoes a newer merge", async () => {
    const m = await (await doMerge(6)).json();
    // earlier attempt died after reverting the merge
    db.edits.find((e) => e.id === m.mergeEditId)!.revertedAt = new Date();
    const res = await (await revert(req({}), ctx({ id: "5", editId: String(m.mergeEditId) }))).json();
    expect(res.reverted).toEqual([m.markerEditId]);
    expect(db.activities.get(6)!.hidden).toBe(false);

    // merged again since: the old revert is a no-op
    const m2 = await (await doMerge(6)).json();
    const res2 = await (await revert(req({}), ctx({ id: "5", editId: String(m.mergeEditId) }))).json();
    expect(res2.reverted).toEqual([]);
    expect(active(5).map((e) => e.id)).toEqual([m2.mergeEditId]);
    expect(db.activities.get(6)!.hidden).toBe(true);
  });
});

describe("anchors", () => {
  it("crop, cut and drop-points get the canonical start; no-gps doesn't", async () => {
    for (const [kind, params] of [["crop", { startS: 10, endS: null }], ["cut", { fromS: 50, toS: 60 }], ["drop-points", { ts: [12] }], ["no-gps", {}]] as const) {
      const j = await (await postEdit(req({ kind, params }), id5)).json();
      const stored = db.edits.find((e) => e.id === j.editId)!.params as Record<string, unknown>;
      if (kind === "no-gps") expect(stored).toEqual({});
      else expect(stored.anchorEpochMs).toBe(T0);
    }
  });

  it("a client-sent anchor is replaced by the current track's", async () => {
    const j = await (await postEdit(req({ kind: "cut", params: { fromS: 50, toS: 60, anchorEpochMs: 123 } }), id5)).json();
    expect(db.edits.find((e) => e.id === j.editId)!.params).toEqual({ fromS: 50, toS: 60, anchorEpochMs: T0 });
  });
});

describe("route-only tracks", () => {
  const NO_TIMED = "this activity has no timed track (route only)";
  beforeEach(() => db.tracks.set(5, { ...synthTrack(), syntheticTime: true }));

  it("GET flags it", async () => {
    expect(await (await getCleaning(req(), id5)).json()).toMatchObject({ ok: true, trackStatus: "ok", syntheticTime: true });
  });

  it("edits, preview, suggestion accept, split and merge are refused with 422", async () => {
    for (const res of [
      await postEdit(req({ kind: "no-gps" }), id5),
      await postEdit(req({ kind: "crop", params: { startS: 10, endS: null } }), id5),
      await preview(req({ edits: [] }), id5),
      await split(req({ atS: 300 }), id5),
    ]) {
      expect(res.status).toBe(422);
      expect((await res.json()).error).toMatch(NO_TIMED);
    }
    db.suggestions.push({ id: 1, activityId: 5, detectorVersion: 1, kind: "no-gps", confidence: 0.8, edit: { kind: "no-gps", params: {} }, summary: "s", range: null, status: "open", editId: null, createdAt: new Date(), decidedAt: null });
    expect((await decide(req({ action: "accept" }), ctx({ id: "5", sid: "1" }))).status).toBe(422);
    expect(db.suggestions[0].status).toBe("open");
    addActivity(6, { startDateUtc: at(9) });
    const m = await merge(req({ otherId: 6 }), id5);
    expect(m.status).toBe(422);
    expect((await m.json()).error).toMatch(NO_TIMED);
    expect(db.edits).toHaveLength(0);
    expect(db.activities.size).toBe(2);
  });
});

describe("split boundaries", () => {
  it("a parent takes nothing after its split; a child nothing before it", async () => {
    const s = await (await split(req({ atS: 300 }), id5)).json();
    db.tracks.set(s.childId, synthTrack()); // same sources, same track
    const before = db.edits.length;
    // parent
    expect((await postEdit(req({ kind: "crop", params: { startS: null, endS: 400 } }), id5)).status).toBe(409);
    expect((await postEdit(req({ kind: "crop", params: { startS: 350, endS: null } }), id5)).status).toBe(409);
    expect((await postEdit(req({ kind: "cut", params: { fromS: 250, toS: 350 } }), id5)).status).toBe(409);
    // child
    const childCtx = ctx({ id: String(s.childId) });
    expect((await postEdit(req({ kind: "crop", params: { startS: 100, endS: null } }), childCtx)).status).toBe(409);
    expect((await postEdit(req({ kind: "cut", params: { fromS: 250, toS: 350 } }), childCtx)).status).toBe(409);
    expect(db.edits).toHaveLength(before);
    // inside their own halves: fine
    expect((await postEdit(req({ kind: "crop", params: { startS: 20, endS: null } }), id5)).status).toBe(200);
    expect((await postEdit(req({ kind: "cut", params: { fromS: 400, toS: 450 } }), childCtx)).status).toBe(200);
  });

  it("suggestion accept is refused the same way", async () => {
    await split(req({ atS: 300 }), id5);
    db.suggestions.push({ id: 1, activityId: 5, detectorVersion: 1, kind: "crop-tail", confidence: 0.8, edit: { kind: "crop", params: { startS: null, endS: 500 } }, summary: "tail", range: { fromS: 500, toS: 599 }, status: "open", editId: null, createdAt: new Date(), decidedAt: null });
    expect((await decide(req({ action: "accept" }), ctx({ id: "5", sid: "1" }))).status).toBe(409);
    expect(db.suggestions[0].status).toBe("open");
  });

  it("after the split is undone the parent can be cropped past it again", async () => {
    const s = await (await split(req({ atS: 300 }), id5)).json();
    await revert(req({}), ctx({ id: "5", editId: String(s.markerEditId) }));
    expect((await postEdit(req({ kind: "crop", params: { startS: null, endS: 400 } }), id5)).status).toBe(200);
  });

  it("a split can't be undone while its half has an activity merged into it", async () => {
    const s = await (await split(req({ atS: 300 }), id5)).json();
    addEdit(s.childId, "merge", { withActivityId: 77 }); // made before merges refused split halves
    const res = await revert(req({}), ctx({ id: "5", editId: String(s.markerEditId) }));
    expect(res.status).toBe(409);
    expect(db.activities.get(s.childId)!.hidden).toBe(false);
    expect(active(5).map((e) => e.kind)).toEqual(["crop", "split"]);
  });

  it("a child's start crop can't be reverted while only an end crop would remain", async () => {
    const s = await (await split(req({ atS: 300 }), id5)).json();
    db.tracks.set(s.childId, synthTrack());
    const childCtx = (editId: number) => ctx({ id: String(s.childId), editId: String(editId) });
    const startCrop = active(s.childId)[0].id;
    const j = await (await postEdit(req({ kind: "crop", params: { startS: null, endS: 500 } }), ctx({ id: String(s.childId) }))).json();
    expect((await revert(req({}), childCtx(startCrop))).status).toBe(409);
    expect((await revert(req({}), childCtx(j.editId))).status).toBe(200);
  });
});

describe("merge refusals", () => {
  beforeEach(() => addActivity(6, { startDateUtc: at(9) }));
  const doMerge = (otherId: number, id = "5") => merge(req({ otherId }), ctx({ id }));

  it("an absorbed activity more private than the target", async () => {
    db.activities.get(6)!.hidden = true;
    expect(await (await doMerge(6)).json()).toMatchObject({ ok: false, error: expect.stringMatching(/private/) });
    db.activities.get(6)!.hidden = false;
    db.activities.get(6)!.mapHidden = true;
    expect((await doMerge(6)).status).toBe(409);
    db.activities.get(5)!.mapHidden = true;
    db.activities.get(6)!.hrHidden = true;
    expect(await (await doMerge(6)).json()).toMatchObject({ ok: false, error: expect.stringMatching(/heart rate/) });
    db.activities.get(5)!.hrHidden = true;
    expect((await doMerge(6)).status).toBe(200);
  });

  it("split parents, on either side", async () => {
    addEdit(6, "split", { childId: 40, atS: 100, parentCropEditId: 1 });
    expect((await doMerge(6)).status).toBe(409);
    expect(db.edits.filter((e) => e.kind === "merge" || e.kind === "merged-into")).toHaveLength(0);
  });

  it("crops at the joint, with a hint", async () => {
    const c = addEdit(5, "crop", { startS: null, endS: 500 });
    const r = await (await doMerge(6)).json();
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/undo the crop first, or merge before cropping/) });
    db.edits.find((e) => e.id === c)!.revertedAt = new Date();
    addEdit(6, "crop", { startS: 30, endS: null });
    expect((await doMerge(6)).status).toBe(409);
    expect(db.activities.get(6)!.hidden).toBe(false);
  });

  it("503 when a side's track can't be read", async () => {
    db.tracks.set(6, "unavailable");
    expect((await doMerge(6)).status).toBe(503);
    expect(db.edits).toHaveLength(0);
  });
});
