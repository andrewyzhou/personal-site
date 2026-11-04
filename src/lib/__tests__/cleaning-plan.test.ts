import { describe, it, expect } from "vitest";
import type { CanonicalTrack } from "../canonical-track";
import type { ActivityRow } from "../db/schema";
import {
  EDITOR_MAX_POINTS,
  atSInside,
  childValues,
  cleanedRange,
  currentCrop,
  downsampleIndices,
  editorTrack,
  latestOf,
  parseAtS,
  parseEditBody,
  parseProposedEdits,
  pickStats,
  planMerge,
  revertRefusal,
  splitCrops,
  splitDedupeKey,
  splitRefusal,
  DIRECT_EDIT_KINDS,
} from "../cleaning/plan";
import { createHash } from "crypto";

function synthTrack(n: number): CanonicalTrack {
  const c: CanonicalTrack["columns"] = { t: [], lat: [], lng: [], ele: [], hr: [], cadence: [], watts: [], speed: [], dist: [] };
  for (let i = 0; i < n; i++) {
    c.t.push(i);
    c.lat.push(47 + i * 0.00003);
    c.lng.push(8);
    c.ele.push(400);
    c.hr.push(140);
    c.cadence.push(null);
    c.watts.push(null);
    c.speed.push(3 + (i % 7) * 0.01);
    c.dist.push(i * 3.3);
  }
  return {
    format: "canonical-track", v: 1, source: { kind: "device-file", sha256: "a".repeat(64), fileType: "fit" },
    sportType: "Run", startEpochMs: Date.UTC(2026, 9, 1, 8), utcOffsetMin: 60, hasLocalTime: true, syntheticTime: false,
    session: null, kilojoules: null, suggestedName: "run", columns: c,
  };
}

describe("editor track", () => {
  it("keeps everything under the cap", () => {
    expect(downsampleIndices([1, 2, 3])).toEqual([0, 1, 2]);
  });

  it("caps at 3000, keeps first/last and per-bucket speed extremes (spikes)", () => {
    const speed: (number | null)[] = Array.from({ length: 20000 }, () => 3);
    speed[12345] = 99; // gps spike
    speed[777] = null;
    const idx = downsampleIndices(speed);
    expect(idx.length).toBeLessThanOrEqual(EDITOR_MAX_POINTS);
    expect(idx.length).toBeGreaterThan(2500);
    expect(idx[0]).toBe(0);
    expect(idx[idx.length - 1]).toBe(19999);
    expect(idx).toContain(12345);
    expect([...idx].sort((a, b) => a - b)).toEqual(idx);
    expect(new Set(idx).size).toBe(idx.length);
  });

  it("editorTrack returns the requested columns, aligned", () => {
    const tr = editorTrack(synthTrack(5000));
    expect(Object.keys(tr).sort()).toEqual(["dist", "ele", "hr", "lat", "lng", "speed", "t"]);
    expect(tr.t.length).toBeLessThanOrEqual(3000);
    for (const k of Object.keys(tr) as (keyof typeof tr)[]) expect(tr[k].length).toBe(tr.t.length);
    expect(tr.t[0]).toBe(0);
    expect(tr.t[tr.t.length - 1]).toBe(4999);
    expect(tr.dist[10]).toBeCloseTo(tr.t[10] * 3.3);
  });

  it("pickStats fills every stat column, missing ones as null", () => {
    const s = pickStats({ distanceM: 5, polyline: "x" } as never);
    expect(s.distanceM).toBe(5);
    expect(s.hrZonesS).toBeNull();
    expect(s).not.toHaveProperty("polyline");
  });
});

describe("request parsing", () => {
  it("parseEditBody validates kind, params and normalizes", () => {
    expect(parseEditBody("crop", { startS: 10 }, DIRECT_EDIT_KINDS)).toEqual({ kind: "crop", params: { startS: 10, endS: null } });
    expect(parseEditBody("no-gps", undefined, DIRECT_EDIT_KINDS)).toEqual({ kind: "no-gps", params: {} });
    expect(parseEditBody("merge", { withActivityId: 3 }, DIRECT_EDIT_KINDS)).toMatch(/unsupported/);
    expect(parseEditBody("trim", {}, DIRECT_EDIT_KINDS)).toMatch(/unsupported/);
    expect(parseEditBody(5, {}, DIRECT_EDIT_KINDS)).toMatch(/kind/);
    expect(parseEditBody("cut", [1, 2], DIRECT_EDIT_KINDS)).toMatch(/params/);
    expect(parseEditBody("cut", { fromS: 5, toS: 2 }, DIRECT_EDIT_KINDS)).toMatch(/fromS/);
  });

  it("parseProposedEdits gives synthetic negative ids in order", () => {
    expect(parseProposedEdits([{ kind: "cut", params: { fromS: 1, toS: 2 } }, { kind: "merge", params: { withActivityId: 4 } }])).toEqual([
      { id: -1, kind: "cut", params: { fromS: 1, toS: 2 } },
      { id: -2, kind: "merge", params: { withActivityId: 4 } },
    ]);
    expect(parseProposedEdits("x")).toMatch(/array/);
    expect(parseProposedEdits(Array(51).fill({ kind: "no-gps" }))).toMatch(/array/);
    expect(parseProposedEdits([{ kind: "split", params: {} }])).toMatch(/edits\[0\]/);
    expect(parseProposedEdits([null])).toMatch(/edits\[0\]/);
  });

  it("parseAtS: positive finite seconds, rounded", () => {
    expect(parseAtS(12.6)).toBe(13);
    for (const v of [0, -1, "5", NaN, Infinity, null]) expect(parseAtS(v)).toBeNull();
  });
});

describe("crops and range", () => {
  const edits = [
    { id: 1, kind: "crop", params: { startS: 10, endS: null } },
    { id: 2, kind: "trim", params: { startM: 50, endM: 0 } },
    { id: 3, kind: "crop", params: { startS: 20, endS: 500 } },
  ];

  it("currentCrop is the latest, optionally skipping one", () => {
    expect(currentCrop(edits)).toEqual({ id: 3, startS: 20, endS: 500 });
    expect(currentCrop(edits, 3)).toEqual({ id: 1, startS: 10, endS: null });
    expect(currentCrop([])).toBeNull();
    expect(latestOf(edits, "trim")?.id).toBe(2);
  });

  it("cleanedRange follows the cleaning edits, strict inside check", () => {
    const tr = synthTrack(600);
    expect(cleanedRange(tr, [])).toEqual({ startS: 0, endS: 599 });
    const r = cleanedRange(tr, edits);
    expect(r).toEqual({ startS: 20, endS: 500 });
    expect(atSInside(r, 20)).toBe(false);
    expect(atSInside(r, 500)).toBe(false);
    expect(atSInside(r, 21)).toBe(true);
    expect(atSInside(null, 21)).toBe(false);
    expect(cleanedRange(tr, [{ id: 1, kind: "crop", params: { startS: 1000, endS: null } }])).toBeNull();
  });

  it("splitCrops: parent keeps its start, child keeps the parent's end", () => {
    expect(splitCrops({ id: 3, startS: 20, endS: 500 }, 300)).toEqual({ parent: { startS: 20, endS: 300 }, child: { startS: 300, endS: 500 } });
    expect(splitCrops(null, 300)).toEqual({ parent: { startS: null, endS: 300 }, child: { startS: 300, endS: null } });
  });
});

describe("split", () => {
  const parent = {
    id: 7, name: "long run", sportType: "Run", gear: "pegasus", source: "upload", startDateUtc: new Date("2026-10-01T23:30:00Z"),
    utcOffsetMin: 60, dedupeKey: "k".repeat(64), fitBlobUrl: "u", fitBlobPathname: "p", fitSha256: "s", fileType: "fit",
    hidden: false, mapHidden: true, hrHidden: false, trimStartM: 200, trimEndM: 150,
  } as unknown as ActivityRow;

  it("dedupe key is sha256 of `${parent key}:split:${atS}`", () => {
    expect(splitDedupeKey("abc", 60)).toBe(createHash("sha256").update("abc:split:60").digest("hex"));
  });

  it("child copies metadata, shifts the start, crosses midnight in local time", () => {
    const v = childValues(parent, 3600, 3);
    expect(v).toMatchObject({
      name: "long run (2)", sportType: "Run", gear: "pegasus", description: null, source: "upload", externalId: null,
      startDateUtc: new Date("2026-10-02T00:30:00Z"), localDate: "2026-10-02", localTime: "01:30", utcOffsetMin: 60,
      dedupeKey: splitDedupeKey(parent.dedupeKey, 3600), fitBlobUrl: "u", fitBlobPathname: "p", fitSha256: "s", fileType: "fit",
      splitFromId: 7, hidden: false, mapHidden: true, processingVersion: 3, needsRepublish: true,
    });
    // no route of its own until republish
    expect(v.polyline).toBeUndefined();
  });

  it("refuses merged activities", () => {
    expect(splitRefusal([{ id: 1, kind: "merge", params: { withActivityId: 2 } }])?.status).toBe(409);
    expect(splitRefusal([{ id: 1, kind: "merged-into", params: {} }])?.status).toBe(409);
    expect(splitRefusal([{ id: 1, kind: "crop", params: {} }])).toBeNull();
  });
});

describe("planMerge", () => {
  const at = (h: number) => new Date(Date.UTC(2026, 9, 1, h));
  const side = (id: number, h: number, edits: { id: number; kind: string; params: Record<string, unknown> }[] = [], splitFromId: number | null = null) =>
    ({ row: { id, startDateUtc: at(h), splitFromId }, edits });

  it("always merges the later one into the earlier one", () => {
    expect(planMerge(side(1, 8), side(2, 9))).toMatchObject({ ok: true, targetId: 1, absorbedId: 2, alreadyMerged: false });
    expect(planMerge(side(2, 9), side(1, 8))).toMatchObject({ ok: true, targetId: 1, absorbedId: 2 });
  });

  it("refuses itself, far apart and split halves", () => {
    expect(planMerge(side(1, 8), side(1, 8))).toMatchObject({ ok: false, status: 400 });
    expect(planMerge(side(1, 0), side(2, 13))).toMatchObject({ ok: false, status: 400 });
    expect(planMerge(side(1, 8), side(2, 9, [], 1))).toMatchObject({ ok: false, status: 409 });
  });

  it("refuses chains, cycles and double merges", () => {
    // target is itself absorbed somewhere
    expect(planMerge(side(1, 8, [{ id: 5, kind: "merged-into", params: { intoActivityId: 9 } }]), side(2, 9))).toMatchObject({ ok: false, status: 409 });
    // absorbed has its own merges
    expect(planMerge(side(1, 8), side(2, 9, [{ id: 5, kind: "merge", params: { withActivityId: 3 } }]))).toMatchObject({ ok: false, status: 409 });
    // absorbed already merged elsewhere
    expect(planMerge(side(1, 8), side(2, 9, [{ id: 5, kind: "merged-into", params: { intoActivityId: 3 } }]))).toMatchObject({ ok: false, status: 409, error: expect.stringMatching(/already merged into 3/) });
  });

  it("recognizes a finished or half-finished merge into the same target", () => {
    const marker = { id: 5, kind: "merged-into", params: { intoActivityId: 1, wasHidden: false } };
    const merge = { id: 6, kind: "merge", params: { withActivityId: 2 } };
    expect(planMerge(side(1, 8, [merge]), side(2, 9, [marker]))).toMatchObject({ ok: true, alreadyMerged: true, markerId: 5, mergeEditId: 6 });
    expect(planMerge(side(1, 8), side(2, 9, [marker]))).toMatchObject({ ok: true, alreadyMerged: false, markerId: 5, mergeEditId: null });
    // a target can absorb several
    expect(planMerge(side(1, 8, [{ id: 7, kind: "merge", params: { withActivityId: 3 } }]), side(2, 9))).toMatchObject({ ok: true });
  });
});

describe("revertRefusal", () => {
  it("a crop a live split depends on can't be reverted on its own", () => {
    const edits = [
      { id: 4, kind: "crop", params: { startS: null, endS: 300 } },
      { id: 5, kind: "split", params: { childId: 9, atS: 300, parentCropEditId: 4 } },
    ];
    expect(revertRefusal(edits[0], edits, { isSplitChild: false })?.status).toBe(409);
    expect(revertRefusal({ id: 3, kind: "cut", params: {} }, edits, { isSplitChild: false })).toBeNull();
  });

  it("a live split child keeps at least one crop", () => {
    const only = [{ id: 8, kind: "crop", params: { startS: 300, endS: null } }];
    expect(revertRefusal(only[0], only, { isSplitChild: true })?.status).toBe(409);
    const two = [...only, { id: 9, kind: "crop", params: { startS: 320, endS: null } }];
    expect(revertRefusal(two[1], two, { isSplitChild: true })).toBeNull();
    expect(revertRefusal(only[0], only, { isSplitChild: false })).toBeNull();
  });
});
