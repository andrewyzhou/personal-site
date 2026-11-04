import { describe, it, expect } from "vitest";
import { applyCleaning, combineCrop, effectiveCropWindow } from "../cleaning/edits";
import { CANONICAL_FORMAT_VERSION, type CanonicalTrack } from "../canonical-track";
import { publishTrack } from "../republish";
import { DEFAULT_PRIVACY_SETTINGS } from "../privacy/settings";

const crop = (id: number, startS: number | null, endS: number | null, extra: Record<string, unknown> = {}) => ({
  id, kind: "crop", params: { startS, endS, ...extra },
});

function line(n: number, startEpochMs: number, lng0 = -122.3, synthetic = false): CanonicalTrack {
  const cols = { t: [] as number[], lat: [] as (number | null)[], lng: [] as (number | null)[], speed: [] as (number | null)[], dist: [] as number[] };
  for (let i = 0; i < n; i++) {
    cols.t.push(i);
    cols.lat.push(37.8);
    cols.lng.push(lng0 + (i * 3) / 88000);
    cols.speed.push(3);
    cols.dist.push(i * 3);
  }
  const nul = cols.t.map(() => null);
  return {
    format: "canonical-track", v: CANONICAL_FORMAT_VERSION,
    source: { kind: "device-file", sha256: "a".repeat(64), detailSha256: null, fileType: "fit" },
    sportType: "Run", startEpochMs, utcOffsetMin: 0, hasLocalTime: true, syntheticTime: synthetic,
    session: { distanceM: (n - 1) * 3, movingTimeS: n - 1, elapsedTimeS: n - 1, elevGainM: 0, avgSpeedMs: 3, maxSpeedMs: 3, avgHr: null, maxHr: null, avgCadence: null, avgWatts: null, maxWatts: null },
    kilojoules: null, suggestedName: "run",
    columns: { ...cols, ele: nul, hr: nul, cadence: nul, watts: nul },
  };
}
const T0 = Date.UTC(2026, 9, 1, 15);

describe("crops intersect", () => {
  it("every active crop narrows the window; order doesn't matter", () => {
    expect(effectiveCropWindow([crop(1, 300, null), crop(2, null, 3000)])).toEqual({ lo: 300, hi: 3000 });
    expect(effectiveCropWindow([crop(2, null, 3000), crop(1, 300, null)])).toEqual({ lo: 300, hi: 3000 });
    expect(effectiveCropWindow([crop(1, 10, 900), crop(2, 50, 2000)])).toEqual({ lo: 50, hi: 900 });
    expect(effectiveCropWindow([])).toEqual({ lo: -Infinity, hi: Infinity });
  });

  it("a later crop can never widen past a split boundary", () => {
    // child of a split at 3000 s, then an accepted "crop the tail at 3000"
    const t = line(6000, T0);
    const c = applyCleaning(t, [crop(1, 3000, null), crop(2, null, 3000)]);
    expect(c.track.columns.t.every((s) => s === 3000)).toBe(true);
  });

  it("combineCrop stores the proposal as is", () => {
    expect(combineCrop([crop(1, 300, null)], { startS: null, endS: 3000 })).toEqual({ startS: null, endS: 3000 });
  });

  it("anchored times follow a source whose clock starts elsewhere", () => {
    // edit made on a track starting at T0; the new source starts 60 s earlier
    const t = line(1000, T0 - 60_000);
    const c = applyCleaning(t, [crop(1, 100, 200, { anchorEpochMs: T0 })]);
    expect(c.track.columns.t[0]).toBe(160);
    expect(c.track.columns.t[c.track.columns.t.length - 1]).toBe(260);
  });
});

describe("merges", () => {
  it("each part keeps its own edits; the target's crop never drops the absorbed part", () => {
    const a = line(1000, T0);
    const b = line(1000, T0 + 3600_000, -122.2);
    const c = applyCleaning(a, [crop(1, null, 500)], [{ track: b, edits: [crop(9, 100, null)] }]);
    const t = c.track.columns.t;
    expect(t.filter((s) => s <= 500)).toHaveLength(501);
    expect(t.filter((s) => s > 500)[0]).toBe(3700);
    expect(t[t.length - 1]).toBe(3600 + 999);
  });

  it("every merged recording is privacy-trimmed at its own ends", () => {
    const a = line(1000, T0);
    const b = line(1000, T0 + 3600_000, -122.2);
    const p = publishTrack(a, [{ id: 1, kind: "trim", params: { startM: 200, endM: 200 } }], {
      zones: [],
      settings: DEFAULT_PRIVACY_SETTINGS,
      merged: [{ track: b, edits: [] }],
    });
    const t = p.visible.flat().map((s) => s.t);
    // a's end (t ≥ 933 at 3 m/s) and b's start (< 3600 + 67) are gone
    expect(t.some((s) => s > 933 && s < 3600)).toBe(false);
    expect(Math.min(...t.filter((s) => s >= 3600))).toBeGreaterThanOrEqual(3600 + 66);
  });
});

describe("route-only tracks", () => {
  it("ignore cleaning edits and keep the summary stats", () => {
    const t = line(600, T0, -122.3, true);
    const p = publishTrack(t, [{ id: 1, kind: "trim", params: { startM: 0, endM: 0 } }, crop(2, 0, 60)], { zones: [], settings: DEFAULT_PRIVACY_SETTINGS });
    expect(p.cleaned).toBe(false);
    expect(p.columns.movingTimeS).toBe(599);
  });
});
