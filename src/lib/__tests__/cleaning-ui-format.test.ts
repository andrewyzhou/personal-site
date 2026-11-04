import { describe, it, expect } from "vitest";
import {
  areaPath,
  axisTicks,
  boundsOfSegments,
  bucketSeries,
  currentCrop,
  editLinkId,
  editParamsLabel,
  fmtClock,
  fmtConfidence,
  fmtOffset,
  formToSettings,
  groupSuggestions,
  isRevertable,
  linePath,
  nearestIndex,
  newestFirst,
  normalizeRange,
  nudge,
  nudgeStep,
  positionAt,
  removedBands,
  robustRange,
  segmentsInRange,
  settingsToForm,
  statRows,
  timeToX,
  trimParams,
  trimEffect,
  cropWidens,
  xToTime,
  zoneBpm,
  zoneFractions,
  type EditRow,
  type SuggestionRow,
} from "../cleaning/ui-format";

// 2025-07-06T14:00:00Z; with -420 min offset that's 7:00:00 am local
const START = Date.UTC(2025, 6, 6, 14, 0, 0);
const ctx = { startEpochMs: START, utcOffsetMin: -420 };

const edit = (id: number, kind: string, params: Record<string, unknown>, createdAt: string, revertedAt: string | null = null): EditRow => ({
  id, kind, params, note: null, createdAt, revertedAt,
});

describe("time formatting", () => {
  it("formats offsets as m:ss and h:mm:ss", () => {
    expect(fmtOffset(0)).toBe("0:00");
    expect(fmtOffset(754)).toBe("12:34");
    expect(fmtOffset(3725)).toBe("1:02:05");
    expect(fmtOffset(-5)).toBe("0:00");
    expect(fmtOffset(NaN)).toBe("—");
  });

  it("formats wall clock in the activity's timezone", () => {
    expect(fmtClock(START, 0, -420)).toBe("7:00:00 am");
    expect(fmtClock(START, 5 * 3600 + 65, -420)).toBe("12:01:05 pm");
    expect(fmtClock(START, 0, 0)).toBe("2:00:00 pm");
  });

  it("formats confidence as a clamped percent", () => {
    expect(fmtConfidence(0.876)).toBe("88%");
    expect(fmtConfidence(1.4)).toBe("100%");
  });
});

describe("scrubber math", () => {
  it("maps x and time both ways, clamped", () => {
    expect(xToTime(50, 100, 600)).toBe(300);
    expect(xToTime(-10, 100, 600)).toBe(0);
    expect(xToTime(150, 100, 600)).toBe(600);
    expect(timeToX(300, 200, 600)).toBe(100);
    expect(xToTime(10, 0, 600)).toBe(0);
  });

  it("normalizes ranges: ordered, rounded, clamped, min width", () => {
    expect(normalizeRange(90.4, 10.6, 100)).toEqual({ fromS: 11, toS: 90 });
    expect(normalizeRange(-5, 200, 100)).toEqual({ fromS: 0, toS: 100 });
    expect(normalizeRange(10, 10.2, 100)).toBeNull();
  });

  it("nudges by a duration-relative step", () => {
    expect(nudgeStep(100)).toBe(1);
    expect(nudgeStep(5000)).toBe(10);
    expect(nudgeStep(5000, true)).toBe(100);
    expect(nudge(5, -10, 100)).toBe(0);
    expect(nudge(95, 10, 100)).toBe(100);
  });

  it("finds the nearest sample", () => {
    const t = [0, 10, 20, 30];
    expect(nearestIndex(t, 14)).toBe(1);
    expect(nearestIndex(t, 16)).toBe(2);
    expect(nearestIndex(t, -3)).toBe(0);
    expect(nearestIndex(t, 99)).toBe(3);
    expect(nearestIndex([], 5)).toBe(-1);
  });

  it("finds a position, skipping samples without gps", () => {
    const track = { t: [0, 10, 20, 30], lat: [1, null, null, 4], lng: [1, null, null, 4] };
    expect(positionAt(track, 0)).toEqual([1, 1]);
    expect(positionAt(track, 22)).toEqual([4, 4]);
    expect(positionAt({ t: [0], lat: [null], lng: [null] }, 0)).toBeNull();
  });

  it("splits range segments at missing positions", () => {
    const track = { t: [0, 10, 20, 30, 40], lat: [1, 2, null, 4, 5], lng: [1, 2, null, 4, 5] };
    expect(segmentsInRange(track)).toEqual([[[1, 1], [2, 2]], [[4, 4], [5, 5]]]);
    expect(segmentsInRange(track, 25, 40)).toEqual([[[4, 4], [5, 5]]]);
    expect(boundsOfSegments(segmentsInRange(track))).toEqual({ minLat: 1, minLng: 1, maxLat: 5, maxLng: 5 });
    expect(boundsOfSegments([])).toBeNull();
  });
});

describe("downsampling", () => {
  it("buckets samples into pixel columns", () => {
    const t = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const v = [1, 3, 5, 7, 9, null, 2, 4, 6, 8, 10];
    const b = bucketSeries(t, v, 10, 2);
    expect(b).toHaveLength(2);
    expect(b[0]).toEqual({ min: 1, max: 9, avg: 5 });
    // last sample (t = duration) lands in the last column
    expect(b[1]).toEqual({ min: 2, max: 10, avg: 6 });
  });

  it("leaves empty columns null and handles zero width", () => {
    const b = bucketSeries([0, 10], [1, 2], 10, 5);
    expect(b.filter(Boolean)).toHaveLength(2);
    expect(b[2]).toBeNull();
    expect(bucketSeries([0], [1], 10, 0)).toEqual([]);
  });

  it("ignores spikes for the chart range", () => {
    const v = [...Array.from({ length: 200 }, (_, i) => i % 10), 9999];
    expect(robustRange(v)).toEqual([0, 9]);
    expect(robustRange([null, null])).toBeNull();
    expect(robustRange([5, 5])).toEqual([4, 6]);
  });

  it("builds svg paths that join gaps", () => {
    const b = [{ min: 0, max: 10, avg: 5 }, null, { min: 0, max: 0, avg: 0 }];
    expect(linePath(b, 100, 0, 10)).toBe("M0.5,50.0L2.5,98.0");
    expect(areaPath(b, 100, 10)).toBe("M0.5,100L0.5,2.0L2.5,100.0L2.5,100Z");
    expect(areaPath([null], 100, 10)).toBe("");
  });

  it("picks round axis ticks", () => {
    expect(axisTicks(600)).toEqual([0, 120, 240, 360, 480, 600]);
    expect(axisTicks(0)).toEqual([0]);
  });
});

describe("edits", () => {
  const edits = [
    edit(1, "crop", { startS: 60, endS: null }, "2025-07-06T15:00:00Z"),
    edit(2, "cut", { fromS: 100, toS: 200 }, "2025-07-06T15:01:00Z"),
    edit(3, "crop", { startS: 30, endS: 900 }, "2025-07-06T15:02:00Z", "2025-07-06T15:03:00Z"),
    edit(4, "cut", { fromS: 300, toS: 400 }, "2025-07-06T15:04:00Z", "2025-07-06T15:05:00Z"),
    edit(5, "split", { childId: 77, atS: 950 }, "2025-07-06T15:06:00Z"),
  ];

  it("sorts newest first", () => {
    expect(newestFirst(edits).map((e) => e.id)).toEqual([5, 4, 3, 2, 1]);
  });

  it("intersects the active crops", () => {
    expect(currentCrop(edits)).toEqual({ startS: 60, endS: null });
    expect(currentCrop([])).toBeNull();
    const many = [
      edit(1, "crop", { startS: 60, endS: 900 }, "2025-07-06T15:00:00Z"),
      edit(2, "crop", { startS: 30, endS: null }, "2025-07-06T15:01:00Z"), // wider: no effect
      edit(3, "crop", { startS: null, endS: 700 }, "2025-07-06T15:02:00Z"),
      edit(4, "crop", { startS: 500, endS: null }, "2025-07-06T15:03:00Z", "2025-07-06T15:04:00Z"),
    ];
    expect(currentCrop(many)).toEqual({ startS: 60, endS: 700 });
  });

  it("trims one side only", () => {
    expect(trimParams("end", 800.4)).toEqual({ startS: null, endS: 800 });
    expect(trimParams("start", 120)).toEqual({ startS: 120, endS: null });
  });

  it("tells narrowing trims from widening and emptying ones", () => {
    const w = { startS: 60, endS: 800 };
    expect(trimEffect(w, "start", 120)).toBe("narrows");
    expect(trimEffect(w, "start", 30)).toBe("widens");
    expect(trimEffect(w, "start", 800)).toBe("empty");
    expect(trimEffect(w, "end", 500)).toBe("narrows");
    expect(trimEffect(w, "end", 900)).toBe("widens");
    expect(trimEffect(w, "end", 60)).toBe("empty");
    expect(trimEffect(null, "end", 500)).toBe("narrows");
    expect(cropWidens(w, 100, 700)).toBe(false);
    expect(cropWidens(w, 10, 700)).toBe(true);
    expect(cropWidens(w, 100, 900)).toBe(true);
    expect(cropWidens(null, 0, 9999)).toBe(false);
  });

  it("draws removed bands for active crops and cuts only", () => {
    expect(removedBands(edits, 1000)).toEqual([
      { kind: "crop", fromS: 0, toS: 60 },
      { kind: "cut", fromS: 100, toS: 200 },
    ]);
    const both = [edit(1, "crop", { startS: null, endS: 900 }, "2025-07-06T15:00:00Z")];
    expect(removedBands(both, 1000)).toEqual([{ kind: "crop", fromS: 900, toS: 1000 }]);
  });

  it("only offers undo on active cleaning edits", () => {
    expect(isRevertable(edits[0])).toBe(true);
    expect(isRevertable(edits[2])).toBe(false);
    expect(isRevertable(edits[4])).toBe(false);
  });

  it("labels params with offsets and clock times", () => {
    expect(editParamsLabel("crop", { startS: 60, endS: 120 }, ctx)).toBe("keep 1:00–2:00 (7:01:00 am–7:02:00 am)");
    expect(editParamsLabel("crop", { startS: 60, endS: null }, ctx)).toBe("keep from 1:00 (7:01:00 am)");
    expect(editParamsLabel("crop", { startS: null, endS: 120 }, ctx)).toBe("keep until 2:00 (7:02:00 am)");
    expect(editParamsLabel("cut", { fromS: 0, toS: 30 }, ctx)).toBe("remove 0:00–0:30 (7:00:00 am–7:00:30 am)");
    expect(editParamsLabel("drop-points", { ts: [1, 2, 3, 4] }, ctx)).toBe("drop 4 points at 0:01, 0:02, 0:03, …");
    expect(editParamsLabel("drop-points", { ts: [65] }, ctx)).toBe("drop 1 point at 1:05");
    expect(editParamsLabel("no-gps", {}, ctx)).toBe("drop all positions");
    expect(editParamsLabel("merge", { withActivityId: 9 }, ctx)).toBe("appended activity #9");
    expect(editParamsLabel("split", { childId: 77, atS: 60 }, ctx)).toBe("split at 1:00 (7:01:00 am) into #77");
    expect(editParamsLabel("merged-into", { intoActivityId: 3, wasHidden: false }, ctx)).toBe("merged into #3");
  });

  it("links markers to the related activity", () => {
    expect(editLinkId("split", { childId: 77 })).toBe(77);
    expect(editLinkId("merge", { withActivityId: 9 })).toBe(9);
    expect(editLinkId("merged-into", { intoActivityId: 3 })).toBe(3);
    expect(editLinkId("crop", { startS: 1 })).toBeNull();
    expect(editLinkId("split", { childId: "x" })).toBeNull();
  });
});

describe("suggestions", () => {
  const s = (id: number, kind: string, confidence: number, status: SuggestionRow["status"], fromS = 0, hasEdit = true): SuggestionRow => ({
    id, kind, confidence, status, summary: `s${id}`, range: { fromS, toS: fromS + 10 },
    edit: hasEdit ? { kind: "cut", params: {} } : null, editId: null,
  });

  it("groups open by confidence, closed, and stops by time", () => {
    const g = groupSuggestions([
      s(1, "cut-vehicle", 0.6, "open"),
      s(2, "crop-head", 0.95, "open"),
      s(3, "drop-spikes", 0.8, "dismissed"),
      s(4, "idle", 0.5, "open", 500, false),
      s(5, "idle", 0.5, "open", 100, false),
      s(6, "crop-tail", 0.9, "accepted"),
    ]);
    expect(g.open.map((x) => x.id)).toEqual([2, 1]);
    expect(g.closed.map((x) => x.id)).toEqual([3, 6]);
    expect(g.stops.map((x) => x.id)).toEqual([5, 4]);
  });
});

describe("stats", () => {
  const st = { distanceM: 1609.344, movingTimeS: 480, elapsedTimeS: 600, elevGainM: 10, avgSpeedMs: 1609.344 / 480, avgHr: 150.4, maxHr: 171 };

  it("uses pace for foot sports", () => {
    const rows = statRows("Run", [st, null]);
    expect(rows.map((r) => r.label)).toEqual(["distance", "moving", "elapsed", "pace", "elevation", "avg hr", "max hr"]);
    expect(rows[0].values).toEqual(["1.00 mi", "—"]);
    expect(rows[3].values[0]).toBe("8:00 /mi");
    expect(rows[5].values[0]).toBe("150 bpm");
  });

  it("uses speed for rides and skips distance for duration-only types", () => {
    expect(statRows("Ride", [st]).find((r) => r.label === "speed")?.values[0]).toBe("7.5 mph");
    expect(statRows("Yoga", [st]).map((r) => r.label)).toEqual(["moving", "elapsed", "avg hr", "max hr"]);
  });

  it("prints dashes for missing values", () => {
    const rows = statRows("Run", [{ ...st, avgHr: null, maxHr: null }]);
    expect(rows.find((r) => r.label === "avg hr")?.values).toEqual(["—"]);
  });

  it("turns zone seconds into fractions", () => {
    expect(zoneFractions([10, 30, 60, 0, 0])).toEqual([0.1, 0.3, 0.6, 0, 0]);
    expect(zoneFractions([0, 0])).toBeNull();
    expect(zoneFractions(null)).toBeNull();
  });
});

describe("settings form", () => {
  const settings = { autoApply: { enabled: true, minConfidence: 0.9 }, hrMaxBpm: 190, hrZonePcts: [0.6, 0.7, 0.8, 0.9] };

  it("round-trips", () => {
    const f = settingsToForm(settings);
    expect(f).toEqual({ enabled: true, minConfidencePct: "90", hrMaxBpm: "190", zonePcts: ["60", "70", "80", "90"] });
    expect(formToSettings(f)).toEqual({ ok: true, settings });
  });

  it("rejects out-of-range and non-increasing values", () => {
    const f = settingsToForm(settings);
    expect(formToSettings({ ...f, minConfidencePct: "40" }).ok).toBe(false);
    expect(formToSettings({ ...f, hrMaxBpm: "250" }).ok).toBe(false);
    expect(formToSettings({ ...f, hrMaxBpm: "abc" }).ok).toBe(false);
    expect(formToSettings({ ...f, zonePcts: ["60", "60", "80", "90"] }).ok).toBe(false);
    expect(formToSettings({ ...f, zonePcts: ["20", "70", "80", "90"] }).ok).toBe(false);
  });

  it("converts zone bounds to bpm", () => {
    expect(zoneBpm(190, [0.6, 0.7, 0.8, 0.9])).toEqual([114, 133, 152, 171]);
  });
});
