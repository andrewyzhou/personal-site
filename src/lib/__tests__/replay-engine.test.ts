import { describe, it, expect } from "vitest";
import type { ReplayData, ReplaySegment } from "@/lib/replay/build";
import {
  activeEvents,
  angleDelta,
  avatarFogAlpha,
  buildEvents,
  buildTimeline,
  chaseStep,
  chaseZoom,
  defaultSpeed,
  fogWallS,
  lookAheadBearing,
  photoMoments,
  photoOpacity,
  playMap,
  positionAt,
  replayToWall,
  smoothAngle,
  smoothValue,
  trailUpTo,
  wallDuration,
  wallToReplay,
  IDLE_FF,
  SPEED_CHOICES,
} from "@/lib/replay/engine";
import { haversineM } from "@/lib/replay/decoy";

const M_PER_DEG = (Math.PI / 180) * 6371008.8;

// a straight run north at `speed` m/s, one point every `dt` s
function seg(t0: number, lat0: number, n: number, dt: number, speed: number, lng = 10): ReplaySegment {
  const s: ReplaySegment = { t: [], lat: [], lng: [], ele: null, hr: null, speed: [] };
  for (let i = 0; i < n; i++) {
    s.t.push(t0 + i * dt);
    s.lat.push(lat0 + (i * dt * speed) / M_PER_DEG);
    s.lng.push(lng);
    s.speed.push(speed);
  }
  return s;
}

function concat(a: ReplaySegment, b: ReplaySegment): ReplaySegment {
  return { t: [...a.t, ...b.t], lat: [...a.lat, ...b.lat], lng: [...a.lng, ...b.lng], ele: null, hr: null, speed: [...a.speed, ...b.speed] };
}

const last = (s: ReplaySegment) => s.t.length - 1;

// 0–600 s running, 600–720 s standing still, 720–1200 s running,
// fog 300 s, 1500–2100 running, cut, 2100–2400 running
function fixture(): ReplayData {
  const a1 = seg(0, 50, 61, 10, 3);
  const stop = seg(610, a1.lat[last(a1)], 12, 10, 0);
  const a2 = seg(730, a1.lat[last(a1)], 48, 10, 3);
  const s0 = concat(concat(a1, stop), a2);
  const endLat = s0.lat[last(s0)];
  const s1 = seg(1500, endLat + 0.004, 61, 10, 3, 10.002);
  const s2 = seg(2100, s1.lat[last(s1)] + 0.01, 31, 10, 3, 10.01);
  return {
    v: 1,
    sportType: "Run",
    segments: [s0, s1, s2],
    gaps: [
      { after: 0, kind: "fog", durationS: 300 },
      { after: 1, kind: "cut", durationS: 0 },
    ],
    totalS: 2400,
  };
}

describe("timeline", () => {
  const tl = buildTimeline(fixture(), { activityId: 42 });

  it("flattens segments and gaps", () => {
    expect(tl.segStart).toHaveLength(3);
    expect(tl.gaps.map((g) => g.kind)).toEqual(["fog", "cut"]);
    expect(tl.gaps[0].startT).toBe(1200);
    expect(tl.gaps[0].endT).toBe(1500);
    expect(tl.totalS).toBe(2400);
  });

  it("interpolates between points", () => {
    const p = positionAt(tl, 15);
    expect(p.lat).toBeCloseTo(50 + 45 / M_PER_DEG, 9);
    expect(p.gap).toBeNull();
    expect(p.speed).toBeCloseTo(3);
    expect(p.bearing).toBeCloseTo(0, 3);
    expect(p.distM).toBeCloseTo(45, 0);
  });

  it("clamps outside the track", () => {
    expect(positionAt(tl, -10).t).toBe(0);
    expect(positionAt(tl, 1e9).t).toBe(2400);
  });

  it("reports fog with decoy positions inside the blob", () => {
    const p = positionAt(tl, 1350);
    expect(p.gap).toEqual({ index: 0, kind: "fog", progress: 0.5 });
    const blob = tl.gaps[0].blob!;
    expect(haversineM(blob.center, [p.lat, p.lng])).toBeLessThan(blob.radiusM);
  });

  it("starts and ends the fog at the published points", () => {
    const g = tl.gaps[0];
    const a = positionAt(tl, 1200);
    const b = positionAt(tl, 1500);
    expect(haversineM([a.lat, a.lng], g.from)).toBeLessThan(0.01);
    expect(haversineM([b.lat, b.lng], g.to)).toBeLessThan(0.01);
    expect(b.gap).toBeNull();
  });

  it("jumps over a cut", () => {
    const p = positionAt(tl, 2100);
    expect(p.segment).toBe(2);
    expect(p.gap).toBeNull();
  });

  it("finds idle stretches", () => {
    expect(tl.idle).toHaveLength(1);
    expect(tl.idle[0].startT).toBe(600);
    expect(tl.idle[0].endT).toBe(730);
  });

  it("is O(log n) friendly: many lookups stay fast", () => {
    const t0 = performance.now();
    for (let i = 0; i < 20000; i++) positionAt(tl, (i * 7.3) % 2400);
    expect(performance.now() - t0).toBeLessThan(500);
  });
});

describe("play map", () => {
  const tl = buildTimeline(fixture());

  it("fast-forwards idle and compresses fog", () => {
    const pm = playMap(tl, 60);
    const idle = 130 / (60 * IDLE_FF);
    const fog = fogWallS(300, 60);
    expect(fog).toBe(4);
    expect(pm.wallS).toBeCloseTo((2400 - 130 - 300) / 60 + idle + fog, 6);
    expect(wallDuration(tl, 60)).toBeCloseTo(pm.wallS, 9);
  });

  it("keeps fog visible at high speeds", () => {
    expect(fogWallS(300, 300)).toBe(1.5);
    expect(fogWallS(300, 10)).toBe(4);
  });

  it("converts both ways", () => {
    const pm = playMap(tl, 30);
    for (const r of [0, 100, 650, 1250, 1499, 2100, 2400]) {
      expect(wallToReplay(pm, replayToWall(pm, r))).toBeCloseTo(r, 6);
    }
    expect(replayToWall(pm, 0)).toBe(0);
    expect(replayToWall(pm, 2400)).toBeCloseTo(pm.wallS, 9);
    // monotonic
    let prev = -1;
    for (let r = 0; r <= 2400; r += 5) {
      const w = replayToWall(pm, r);
      expect(w).toBeGreaterThanOrEqual(prev);
      prev = w;
    }
  });

  it("picks a default speed that plays in about a minute", () => {
    const s = defaultSpeed(tl);
    expect(SPEED_CHOICES).toContain(s);
    expect(wallDuration(tl, s)).toBeLessThanOrEqual(60);
    expect(s).toBe(60); // 40-ish minutes of moving → 60×
  });

  it("falls back to the fastest for very long tracks", () => {
    const long: ReplayData = { v: 1, sportType: "Ride", segments: [seg(0, 50, 2000, 30, 8)], gaps: [], totalS: 59970 };
    expect(defaultSpeed(buildTimeline(long))).toBe(300);
  });
});

describe("chase cam", () => {
  const tl = buildTimeline(fixture());

  it("wraps angles the short way", () => {
    expect(angleDelta(350, 10)).toBe(20);
    expect(angleDelta(10, 350)).toBe(-20);
    expect(smoothAngle(350, 10, 1e6, 0.5)).toBeCloseTo(10, 6);
    const mid = smoothAngle(350, 10, 0.5, 0.5);
    expect(mid > 350 || mid < 10).toBe(true);
  });

  it("smooths with explicit dt, independent of frame rate", () => {
    const one = smoothValue(0, 10, 1, 1);
    let many = 0;
    for (let i = 0; i < 10; i++) many = smoothValue(many, 10, 0.1, 1);
    expect(many).toBeCloseTo(one, 9);
    expect(smoothValue(3, 10, 0, 1)).toBe(3);
  });

  it("zooms closer when slow", () => {
    expect(chaseZoom(1)).toBeGreaterThan(chaseZoom(4));
    expect(chaseZoom(4)).toBeGreaterThan(chaseZoom(12));
    expect(chaseZoom(1000)).toBeGreaterThanOrEqual(14);
  });

  it("looks ahead along the track", () => {
    expect(lookAheadBearing(tl, 100, 30)).toBeCloseTo(0, 3);
  });

  it("snaps on the first step, then leads the avatar", () => {
    const { state, camera } = chaseStep(tl, null, 100, 1 / 60, 60);
    expect(camera.pitch).toBe(60);
    expect(state.heading).toBeCloseTo(0, 2);
    const pos = positionAt(tl, 100);
    expect(camera.center[1]).toBeGreaterThan(pos.lat); // ahead, i.e. north
    const next = chaseStep(tl, { heading: 90, zoom: 15 }, 100, 1 / 60, 60);
    expect(next.state.heading).toBeLessThan(90);
    expect(next.state.heading).toBeGreaterThan(80);
  });
});

describe("events", () => {
  const tl = buildTimeline(fixture());

  it("builds pause, fog, cut and split events in order", () => {
    const ev = buildEvents(tl, { unit: "km" });
    const kinds = ev.map((e) => e.kind);
    expect(kinds).toContain("pause");
    expect(kinds).toContain("fog");
    expect(kinds).toContain("cut");
    const pause = ev.find((e) => e.kind === "pause")!;
    expect(pause.kind === "pause" && pause.durationS).toBe(130);
    const fog = ev.find((e) => e.kind === "fog")!;
    expect(fog.kind === "fog" && fog.durationS).toBe(300);
    for (let i = 1; i < ev.length; i++) expect(ev[i].t).toBeGreaterThanOrEqual(ev[i - 1].t);
    // first km at 1000 m / 3 m/s ≈ 333 s
    const km1 = ev.find((e) => e.kind === "split" && e.n === 1)!;
    expect(km1.t).toBeCloseTo(333.3, 0);
  });

  it("uses fewer markers in miles", () => {
    const km = buildEvents(tl, { unit: "km" }).filter((e) => e.kind === "split").length;
    const mi = buildEvents(tl, { unit: "mi" }).filter((e) => e.kind === "split").length;
    expect(mi).toBeLessThan(km);
    expect(mi).toBeGreaterThan(0);
  });

  it("adds the max-speed point only when asked", () => {
    expect(buildEvents(tl).some((e) => e.kind === "maxSpeed")).toBe(false);
    expect(buildEvents(tl, { maxSpeed: true }).some((e) => e.kind === "maxSpeed")).toBe(true);
  });

  it("ignores short stops", () => {
    const d: ReplayData = { v: 1, sportType: "Run", segments: [concat(concat(seg(0, 50, 10, 10, 3), seg(100, 50 + 270 / M_PER_DEG, 4, 10, 0)), seg(140, 50 + 270 / M_PER_DEG, 10, 10, 3))], gaps: [], totalS: 230 };
    const t = buildTimeline(d);
    expect(t.idle.length).toBe(1); // 40 s, fast-forwarded…
    expect(buildEvents(t).some((e) => e.kind === "pause")).toBe(false); // …but no chip
  });

  it("shows chips during span events and for a hold after", () => {
    const ev = buildEvents(tl);
    const pm = playMap(tl, 60);
    expect(activeEvents(ev, pm, 1350).some((e) => e.kind === "fog")).toBe(true);
    expect(activeEvents(ev, pm, 1510).some((e) => e.kind === "fog")).toBe(true); // within hold
    expect(activeEvents(ev, pm, 1800).some((e) => e.kind === "fog")).toBe(false);
  });
});

describe("photos", () => {
  const tl = buildTimeline(fixture());

  it("puts each pinned photo at the nearest point", () => {
    const p = positionAt(tl, 300);
    const m = photoMoments(tl, [null, [p.lat + 1e-6, p.lng]]);
    expect(m).toHaveLength(1);
    expect(m[0].photo).toBe(1);
    expect(m[0].t).toBe(300);
  });

  it("pops in and fades out", () => {
    const pm = playMap(tl, 60);
    const m = { photo: 0, t: 300, lat: 0, lng: 0 };
    expect(photoOpacity(pm, m, 290)).toBe(0);
    expect(photoOpacity(pm, m, 300 + 60 * 1.5)).toBe(1);
    expect(photoOpacity(pm, m, 300 + 60 * 10)).toBe(0);
  });
});

describe("fog fade and trail", () => {
  const tl = buildTimeline(fixture());

  it("fades the avatar out and back", () => {
    expect(avatarFogAlpha(0)).toBe(1);
    expect(avatarFogAlpha(0.5)).toBe(0);
    expect(avatarFogAlpha(1)).toBe(1);
    expect(avatarFogAlpha(0.09)).toBeCloseTo(0.5, 5);
  });

  it("never draws the trail into the fog", () => {
    const g = tl.gaps[0];
    const lines = trailUpTo(tl, positionAt(tl, 1350));
    expect(lines).toHaveLength(1);
    const end = lines[0][lines[0].length - 1];
    expect(end).toEqual([g.from[1], g.from[0]]);
  });

  it("draws one line per segment", () => {
    expect(trailUpTo(tl, positionAt(tl, 2300))).toHaveLength(3);
  });
});
