import { describe, it, expect } from "vitest";
import * as F from "./fixtures/cleaning-tracks";
import { detectSuggestions, formatDuration } from "../cleaning/detect";
import { applyCleaning, validateCleaningEdit, type EditLike } from "../cleaning/edits";
import { cleanedStats } from "../cleaning/stats";
import type { CanonicalTrack } from "../canonical-track";
import type { Suggestion } from "../cleaning/types";
import type { TrackRecord } from "../geo";

const detect = (b: F.Built) => detectSuggestions(b.track, b.track.sportType);
const kinds = (s: Suggestion[]) => s.map((x) => x.kind);
const notIdle = (s: Suggestion[]) => s.filter((x) => x.kind !== "idle");
const confClass = (c: number) => (c >= 0.9 ? "high" : c >= 0.6 ? "medium" : "low");

function statsOf(track: CanonicalTrack, suggestions: Suggestion[]) {
  const edits: EditLike[] = suggestions.filter((s) => s.edit).map((s, i) => ({ id: i + 1, kind: s.edit!.kind, params: s.edit!.params }));
  const cleaned = applyCleaning(track, edits);
  const c = cleaned.track.columns;
  const records: TrackRecord[] = c.t.map((t, i) => ({ t, lat: c.lat[i], lng: c.lng[i], ele: c.ele[i], hr: c.hr[i], cadence: c.cadence[i], watts: c.watts[i], speed: c.speed[i] }));
  const dist = cleaned.cleaned ? c.dist : c.dist.map((d) => d - c.dist[0]);
  return cleanedStats(records, dist, cleaned.breaks, cleaned.excludedS, track.sportType);
}
// stats of the untouched track, measured the same way
const rawStats = (track: CanonicalTrack) => statsOf(track, []);

describe("detectSuggestions: vehicle segments", () => {
  it("cuts a 15 min car ride out of a run, padded to the stops around it", () => {
    const b = F.carRideRun();
    const car = F.carSpan(b);
    const s = detect(b);
    expect(notIdle(s).map((x) => x.kind)).toEqual(["cut-vehicle"]);
    const cut = s.find((x) => x.kind === "cut-vehicle")!;
    expect(cut.edit!.kind).toBe("cut");
    const p = cut.edit!.params as { fromS: number; toS: number };
    expect(Math.abs(p.fromS - car.fromS)).toBeLessThanOrEqual(30);
    expect(Math.abs(p.toS - car.toS)).toBeLessThanOrEqual(30);
    expect(cut.range).toEqual({ fromS: p.fromS, toS: p.toS });
    expect(confClass(cut.confidence)).toBe("high");
    expect(cut.summary).toMatch(/^vehicle ride 1[45] min, 1[23]\.\d km at 5\d km\/h avg$/);

    const before = rawStats(b.track);
    const after = statsOf(b.track, s);
    expect(before.distanceM - after.distanceM).toBeGreaterThan(car.distM - 300);
    expect(before.distanceM - after.distanceM).toBeLessThan(car.distM + 300);
    expect(before.movingTimeS - after.movingTimeS).toBeGreaterThan(car.toS - car.fromS - 60);
    expect(before.movingTimeS - after.movingTimeS).toBeLessThan(car.toS - car.fromS + 60);
    expect(after.distanceM).toBeGreaterThan(7800); // 2 × 22.5 min at 3 m/s
    expect(after.distanceM).toBeLessThan(8500);
  });

  it("works from speed and distance alone (no positions, no speed channel)", () => {
    const b = F.carRideRun({ positions: false });
    b.track.columns.speed = b.track.columns.speed.map(() => null);
    const car = F.carSpan(b);
    const cut = detect(b).find((x) => x.kind === "cut-vehicle")!;
    expect(cut).toBeDefined();
    const p = cut.edit!.params as { fromS: number; toS: number };
    expect(Math.abs(p.fromS - car.fromS)).toBeLessThanOrEqual(30);
    expect(Math.abs(p.toS - car.toS)).toBeLessThanOrEqual(30);
  });

  it("does not flag a genuine 25 m/s descent on a ride", () => {
    const s = detect(F.downhillRide());
    expect(kinds(s)).not.toContain("cut-vehicle");
    expect(notIdle(s)).toEqual([]);
  });

  it("does flag the same speed on the flat", () => {
    const b = F.flatVehicleRide();
    const cut = detect(b).find((x) => x.kind === "cut-vehicle")!;
    expect(cut).toBeDefined();
    const p = cut.edit!.params as { fromS: number; toS: number };
    expect(Math.abs(p.fromS - b.marks.car.fromS)).toBeLessThanOrEqual(30);
    expect(Math.abs(p.toS - b.marks.car.toS)).toBeLessThanOrEqual(30);
    expect(cut.confidence).toBeLessThan(0.9); // only 1.1× the ride limit
  });

  it("crops instead of cutting when the ride touches the end", () => {
    const b = F.buildTrack([
      { dur: 1800, v: 3, hr: 150 },
      { dur: 30, v: 0 },
      { dur: 900, v: 15 },
      { dur: 30, v: 0 },
    ], { sportType: "Run", fileType: "fit", seed: 5 });
    const s = notIdle(detect(b));
    expect(kinds(s)).toEqual(["crop-tail"]);
    expect(s[0].edit).toEqual({ kind: "crop", params: { startS: null, endS: expect.any(Number) } });
    expect(Math.abs((s[0].edit!.params.endS as number) - 1830)).toBeLessThanOrEqual(30);
  });
});

describe("detectSuggestions: forgot to stop / late start", () => {
  it("crops 5 h 12 min of the watch sitting still after a 50 min run", () => {
    const b = F.forgotToStop();
    const s = detect(b);
    expect(notIdle(s).map((x) => x.kind)).toEqual(["crop-tail"]);
    const tail = s.find((x) => x.kind === "crop-tail")!;
    const p = tail.edit!.params as { startS: number | null; endS: number };
    expect(p.startS).toBeNull();
    expect(Math.abs(p.endS - 3000)).toBeLessThanOrEqual(30);
    expect(confClass(tail.confidence)).toBe("high");
    expect(tail.summary).toBe("watch kept recording 5 h 12 min after the run ended, mostly stationary");
    expect(tail.range).toEqual({ fromS: p.endS, toS: b.track.columns.t.at(-1) });

    const before = rawStats(b.track);
    const after = statsOf(b.track, s);
    expect(before.elapsedTimeS).toBeGreaterThan(6 * 3600);
    expect(Math.abs(after.elapsedTimeS - 3000)).toBeLessThanOrEqual(60);
    expect(Math.abs(after.distanceM - 9000)).toBeLessThan(400);
    expect(Math.abs(after.movingTimeS - 3000)).toBeLessThanOrEqual(60);
  });

  it("crops a 12 min late start", () => {
    const b = F.lateStart();
    const s = detect(b);
    expect(notIdle(s).map((x) => x.kind)).toEqual(["crop-head"]);
    const head = s.find((x) => x.kind === "crop-head")!;
    expect(head.edit!.kind).toBe("crop");
    const p = head.edit!.params as { startS: number; endS: number | null };
    expect(p.endS).toBeNull();
    expect(Math.abs(p.startS - 720)).toBeLessThanOrEqual(20);
    expect(confClass(head.confidence)).toBe("medium");
    expect(head.summary).toMatch(/^recording started 12 min before the run began/);
    // the wait itself isn't repeated as an idle stretch
    expect(s.filter((x) => x.kind === "idle")).toEqual([]);
    const after = statsOf(b.track, s);
    expect(Math.abs(after.elapsedTimeS - 2400)).toBeLessThanOrEqual(30);
  });

  it("keeps a slow-walking tail at low confidence (could be a cooldown)", () => {
    const b = F.buildTrack([{ dur: 2400, v: 3, hr: 150 }, { dur: 1200, v: 1.2, hr: 100 }], { sportType: "Run", fileType: "fit", seed: 6 });
    const tail = detect(b).find((x) => x.kind === "crop-tail")!;
    expect(tail).toBeDefined();
    expect(tail.confidence).toBeLessThanOrEqual(0.6);
    expect(tail.summary).toMatch(/slow walking$/);
  });

  it("a short tail is not a forgot-to-stop", () => {
    const b = F.buildTrack([{ dur: 2400, v: 3, hr: 150 }, { dur: 300, v: 0 }], { sportType: "Run", fileType: "fit", seed: 7 });
    expect(kinds(detect(b))).not.toContain("crop-tail");
  });
});

describe("detectSuggestions: idle stretches", () => {
  it("reports stoplight pauses of at least a minute as info", () => {
    const b = F.cityRun();
    const s = detect(b);
    expect(kinds(s)).toEqual(["idle", "idle", "idle"]);
    const long = [2, 3, 4].map((i) => b.marks[`stop${i}`]);
    s.forEach((x, i) => {
      expect(x.edit).toBeNull();
      expect(Math.abs(x.range!.fromS - long[i].fromS)).toBeLessThanOrEqual(5);
      expect(Math.abs(x.range!.toS - long[i].toS)).toBeLessThanOrEqual(5);
    });
    expect(s.map((x) => x.summary)).toEqual(["stopped 1 min 10 s", "stopped 1 min 20 s", "stopped 1 min 30 s"]);
  });

  it("merges stops separated by a few seconds of shuffling", () => {
    const b = F.buildTrack([
      { dur: 600, v: 3 }, { dur: 40, v: 0 }, { dur: 10, v: 1.5 }, { dur: 40, v: 0 }, { dur: 600, v: 3 },
    ], { sportType: "Run", fileType: "fit", seed: 8 });
    const idle = detect(b).filter((x) => x.kind === "idle");
    expect(idle).toHaveLength(1);
    expect(idle[0].range!.toS - idle[0].range!.fromS).toBeGreaterThanOrEqual(85);
  });

  it("offers a low-confidence cut for a long mid-activity stop", () => {
    const b = F.buildTrack([{ dur: 1200, v: 3 }, { dur: 1800, v: 0, mark: "cafe" }, { dur: 1200, v: 3 }], { sportType: "Run", fileType: "fit", seed: 9 });
    const idle = detect(b).filter((x) => x.kind === "idle");
    expect(idle).toHaveLength(1);
    expect(idle[0].edit!.kind).toBe("cut");
    expect(idle[0].confidence).toBeLessThanOrEqual(0.6);
    expect(idle[0].summary).toBe("stopped 30 min mid-run");
    const p = idle[0].edit!.params as { fromS: number; toS: number };
    expect(Math.abs(p.fromS - b.marks.cafe.fromS)).toBeLessThanOrEqual(5);
    expect(Math.abs(p.toS - b.marks.cafe.toS)).toBeLessThanOrEqual(5);
  });

  it("a clean run produces nothing but idle info", () => {
    const b = F.cleanRun();
    const s = detect(b);
    expect(kinds(s)).toEqual(["idle"]);
    expect(s[0].edit).toBeNull();
    expect(Math.abs(s[0].range!.fromS - b.marks.stop.fromS)).toBeLessThanOrEqual(5);
    expect(s[0].summary).toBe("stopped 2 min");
  });

  it("stays quiet on stationary sports and motionless tracks", () => {
    const b = F.buildTrack([{ dur: 2400, v: 0, hr: 110 }], { sportType: "WeightTraining", fileType: "fit", positions: false, seed: 10 });
    expect(detect(b)).toEqual([]);
    const still = F.buildTrack([{ dur: 2400, v: 0, hr: 110 }], { sportType: "Run", fileType: "fit", positions: false, seed: 10 });
    expect(detect(still)).toEqual([]);
  });
});

describe("detectSuggestions: gps spikes", () => {
  it("drops 3 isolated ~2 km spikes", () => {
    const b = F.spikyRun();
    const s = detect(b);
    expect(notIdle(s).map((x) => x.kind)).toEqual(["drop-spikes"]);
    const d = s[0];
    expect(d.edit).toEqual({ kind: "drop-points", params: { ts: F.SPIKE_TS } });
    expect(confClass(d.confidence)).toBe("high");
    expect(d.summary).toBe("3 gps spikes, up to 2.0 km off the route");

    const before = rawStats(b.track);
    const after = statsOf(b.track, s);
    expect(before.distanceM - after.distanceM).toBeGreaterThan(3 * 4000 - 300);
    expect(before.distanceM - after.distanceM).toBeLessThan(3 * 4000 + 300);
    expect(Math.abs(after.distanceM - 5400)).toBeLessThan(300);
  });

  it("never flags genuine movement: a jump that stays (re-acquired fix) or fast riding", () => {
    const b = F.buildTrack([{ dur: 1800, v: 3 }], { sportType: "Run", fileType: "gpx", seed: 12 });
    const c = b.track.columns;
    for (let i = 900; i < c.t.length; i++) c.lat[i] = c.lat[i]! + 0.01; // ~1.1 km shift, never returns
    expect(kinds(detect(b))).not.toContain("drop-spikes");
    expect(kinds(detect(F.downhillRide()))).not.toContain("drop-spikes");
    expect(kinds(detect(F.carRideRun()))).not.toContain("drop-spikes");
  });

  it("drops a short run of up to 3 spike samples", () => {
    const b = F.buildTrack([{ dur: 1200, v: 3 }], { sportType: "Run", fileType: "gpx", seed: 13 });
    const c = b.track.columns;
    for (const i of [600, 601, 602]) c.lng[i] = c.lng[i]! + 0.02;
    const d = detect(b).find((x) => x.kind === "drop-spikes")!;
    expect(d.edit!.params.ts).toEqual([600, 601, 602]);
  });
});

describe("detectSuggestions: indoor drift", () => {
  it("drops gps that only jitters during a treadmill run", () => {
    const s = detect(F.treadmill());
    expect(notIdle(s).map((x) => x.kind)).toEqual(["no-gps"]);
    expect(s[0].edit).toEqual({ kind: "no-gps", params: {} });
    expect(confClass(s[0].confidence)).toBe("high");
    expect(s[0].summary).toMatch(/^gps only drifts within \d+ m over 40 min while the device logged 7\.\d km/);
    const after = statsOf(F.treadmill().track, s);
    expect(after.distanceM).toBeGreaterThan(7000); // footpod distance survives
  });

  it("is most confident for indoor sports", () => {
    const s = detect(F.treadmill("VirtualRun"));
    expect(s.find((x) => x.kind === "no-gps")!.confidence).toBe(0.95);
  });

  it("leaves real movement in a small area alone (a soccer field, laps)", () => {
    const soccer = F.buildTrack([{ dur: 1800, v: (t) => (t % 60 < 30 ? 4 : 1.5), turn: 0.1 }], { sportType: "Soccer", fileType: "fit", seed: 14 });
    expect(kinds(detect(soccer))).not.toContain("no-gps");
    const workout = F.buildTrack([{ dur: 1800, v: (t) => (t % 60 < 30 ? 4 : 1.5), turn: 0.1 }], { sportType: "Workout", fileType: "fit", seed: 14 });
    expect(kinds(detect(workout))).not.toContain("no-gps");
  });
});

describe("detectSuggestions: contract", () => {
  const all = () => [
    F.carRideRun(), F.forgotToStop(), F.cityRun(), F.spikyRun(), F.treadmill(), F.treadmill("VirtualRun"),
    F.downhillRide(), F.flatVehicleRide(), F.lateStart(), F.cleanRun(),
  ];

  it("every proposed edit validates and ranges are on the track clock", () => {
    for (const b of all()) {
      const end = b.track.columns.t.at(-1)!;
      for (const s of detect(b)) {
        if (s.edit) expect(validateCleaningEdit(s.edit.kind, s.edit.params)).toEqual({ ok: true, params: s.edit.params });
        expect(s.confidence).toBeGreaterThan(0);
        expect(s.confidence).toBeLessThan(1);
        if (s.range) {
          expect(s.range.fromS).toBeGreaterThanOrEqual(0);
          expect(s.range.toS).toBeLessThanOrEqual(end);
          expect(s.range.toS).toBeGreaterThanOrEqual(s.range.fromS);
        }
      }
    }
  });

  it("is deterministic and leaves the track untouched", () => {
    for (const b of all()) {
      const copy = JSON.stringify(b.track);
      const first = JSON.stringify(detect(b));
      expect(JSON.stringify(detect(b))).toBe(first);
      expect(JSON.stringify(b.track)).toBe(copy);
    }
  });

  it("is fast on long tracks", () => {
    const b = F.buildTrack([{ dur: 3000, v: 3 }, { dur: 9 * 3600, v: 0 }], { sportType: "Run", fileType: "gpx", seed: 15 });
    expect(b.track.columns.t.length).toBeGreaterThan(30000);
    const t0 = performance.now();
    detect(b);
    expect(performance.now() - t0).toBeLessThan(500);
  });

  it("says nothing about polyline-only tracks (synthetic time)", () => {
    const b = F.carRideRun();
    b.track.syntheticTime = true;
    expect(detect(b)).toEqual([]);
  });

  it("formats durations for summaries", () => {
    expect(formatDuration(45)).toBe("45 s");
    expect(formatDuration(90)).toBe("1 min 30 s");
    expect(formatDuration(41 * 60)).toBe("41 min");
    expect(formatDuration(5 * 3600 + 12 * 60)).toBe("5 h 12 min");
    expect(formatDuration(3599.9)).toBe("1 h");
  });
});
