import { describe, it, expect } from "vitest";
import { buildReplay, fogGapReplayS, publicReplay } from "../replay/build";
import { publishTrack } from "../republish";
import { pointInPolygon } from "../privacy/fog";
import { DEFAULT_PRIVACY_SETTINGS } from "../privacy/settings";
import { CANONICAL_FORMAT_VERSION, type CanonicalTrack } from "../canonical-track";

const square = (lat: number, lng: number, h: number): number[][][] => [
  [[lng - h, lat - h], [lng + h, lat - h], [lng + h, lat + h], [lng - h, lat + h], [lng - h, lat - h]],
];

function line(n: number, opts: { hr?: boolean } = {}): CanonicalTrack {
  const c = { t: [] as number[], lat: [] as (number | null)[], lng: [] as (number | null)[], ele: [] as (number | null)[], hr: [] as (number | null)[], speed: [] as (number | null)[], dist: [] as number[] };
  for (let i = 0; i < n; i++) {
    c.t.push(i);
    c.lat.push(37.8);
    c.lng.push(-122.3 + (i * 3) / 88000);
    c.ele.push(10 + i / 100);
    c.hr.push(opts.hr === false ? null : 140 + (i % 10));
    c.speed.push(3);
    c.dist.push(i * 3);
  }
  const nul = c.t.map(() => null);
  return {
    format: "canonical-track", v: CANONICAL_FORMAT_VERSION,
    source: { kind: "device-file", sha256: "a".repeat(64), detailSha256: null, fileType: "fit" },
    sportType: "Run", startEpochMs: Date.UTC(2026, 9, 1), utcOffsetMin: 0, hasLocalTime: true, syntheticTime: false,
    session: null, kilojoules: null, suggestedName: "run",
    columns: { ...c, cadence: nul, watts: nul },
  };
}
const noTrim = { id: 1, kind: "trim", params: { startM: 0, endM: 0 } };
const ctx = { zones: [], settings: DEFAULT_PRIVACY_SETTINGS };

describe("replay build", () => {
  it("covers the published track with increasing replay time", () => {
    const r = publishTrack(line(1200), [noTrim], ctx).replay!;
    expect(r.segments).toHaveLength(1);
    const s = r.segments[0];
    expect(s.t[0]).toBe(0);
    expect(r.totalS).toBe(1199);
    for (let i = 1; i < s.t.length; i++) expect(s.t[i]).toBeGreaterThan(s.t[i - 1]);
    expect(s.speed.every((v) => Math.abs(v - 3) < 1e-9)).toBe(true);
    expect(s.ele).not.toBeNull();
    expect(s.hr).not.toBeNull();
  });

  it("caps the number of points but keeps every segment's ends", () => {
    const r = publishTrack(line(20000), [noTrim], ctx).replay!;
    const pts = r.segments.reduce((n, s) => n + s.t.length, 0);
    expect(pts).toBeLessThanOrEqual(2501);
    expect(r.segments[0].t[r.segments[0].t.length - 1]).toBe(19999);
  });

  it("never contains a point inside a zone; fog gaps take 5-minute steps", () => {
    const zone = { id: 1, polygon: square(37.8, -122.3 + (600 * 3) / 88000, 0.001) };
    const r = publishTrack(line(1200), [noTrim], { zones: [zone], settings: DEFAULT_PRIVACY_SETTINGS }).replay!;
    expect(r.segments.length).toBe(2);
    for (const s of r.segments) for (let i = 0; i < s.t.length; i++) expect(pointInPolygon(s.lat[i], s.lng[i], zone.polygon)).toBe(false);
    expect(r.gaps).toEqual([{ after: 0, kind: "fog", durationS: 300 }]);
    // replay time after the gap = end of segment 0 + the bucketed fog step
    expect(r.segments[1].t[0]).toBe(r.segments[0].t[r.segments[0].t.length - 1] + 300);
  });

  it("cuts are skipped, not fogged", () => {
    const r = publishTrack(line(1200), [noTrim, { id: 2, kind: "cut", params: { fromS: 400, toS: 700 } }], ctx).replay!;
    expect(r.gaps).toEqual([{ after: 0, kind: "cut", durationS: 0 }]);
    expect(r.segments[1].t[0]).toBe(r.segments[0].t[r.segments[0].t.length - 1]);
  });

  it("route-only tracks have no replay; no hr channel → null", () => {
    expect(publishTrack({ ...line(100), syntheticTime: true }, [noTrim], ctx).replay).toBeNull();
    expect(publishTrack(line(100, { hr: false }), [noTrim], ctx).replay!.segments[0].hr).toBeNull();
    expect(buildReplay([], [], () => undefined, "Run")).toBeNull();
  });

  it("public view drops heart rate when hidden", () => {
    const r = publishTrack(line(100), [noTrim], ctx).replay!;
    expect(publicReplay(r, true).segments[0].hr).toBeNull();
    expect(publicReplay(r, false)).toBe(r);
  });

  it("fog gap rounding", () => {
    expect(fogGapReplayS(10)).toBe(300);
    expect(fogGapReplayS(1000)).toBe(900);
  });
});
