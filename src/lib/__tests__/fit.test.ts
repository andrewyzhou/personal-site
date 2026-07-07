import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { gzipSync, zipSync } from "fflate";
import { parseTrackFile, unwrapTrackFile, mapSport, suggestedName } from "../fit";

const fixture = (name: string) =>
  new Uint8Array(fs.readFileSync(path.join(__dirname, "fixtures", name)));

describe("parseTrackFile with real garmin files", () => {
  it("decodes a gzipped fit workout (no-gps case)", () => {
    const parsed = parseTrackFile(fixture("sample.fit.gz"), "sample.fit.gz");
    expect(parsed.fileType).toBe("fit");
    expect(parsed.startDateUtc.toISOString()).toBe("2026-06-20T01:35:45.000Z");
    expect(parsed.utcOffsetMin).toBe(-420); // pdt
    expect(parsed.hasLocalTime).toBe(true);
    expect(parsed.sessionStats?.elapsedTimeS).toBe(291);
  });

  it("decodes a gzipped fit run with gps and produces sane derived data", () => {
    const parsed = parseTrackFile(fixture("sample-gps.fit.gz"), "sample-gps.fit.gz");
    expect(parsed.records.length).toBeGreaterThan(50);
    const gps = parsed.records.filter((r) => r.lat !== null);
    expect(gps.length).toBeGreaterThan(0);
    // semicircle conversion produced california-ish coordinates
    expect(gps[0].lat!).toBeGreaterThan(30);
    expect(gps[0].lat!).toBeLessThan(50);
    expect(gps[0].lng!).toBeLessThan(-100);
    // cumulative distance channel is monotonic
    for (let i = 1; i < parsed.cumDist.length; i++) {
      expect(parsed.cumDist[i]).toBeGreaterThanOrEqual(parsed.cumDist[i - 1]);
    }
  });
});

describe("container unwrapping", () => {
  it("unwraps a zip containing one fit (garmin export original)", () => {
    const rawFit = unwrapTrackFile(fixture("sample.fit.gz"), "sample.fit.gz");
    const zipped = zipSync({ "activity.fit": rawFit.bytes });
    const out = unwrapTrackFile(zipped, "export.zip");
    expect(out.fileType).toBe("fit");
    expect(out.bytes.length).toBe(rawFit.bytes.length);
  });

  it("rejects a zip with two track files", () => {
    const rawFit = unwrapTrackFile(fixture("sample.fit.gz"), "sample.fit.gz");
    const zipped = zipSync({ "a.fit": rawFit.bytes, "b.fit": rawFit.bytes });
    expect(() => unwrapTrackFile(zipped, "export.zip")).toThrow(/2 track files/);
  });

  it("unwraps nested gzip", () => {
    const rawFit = unwrapTrackFile(fixture("sample.fit.gz"), "sample.fit.gz");
    const regz = gzipSync(rawFit.bytes);
    expect(unwrapTrackFile(regz, "activity.fit.gz").fileType).toBe("fit");
  });

  it("rejects unsupported content", () => {
    expect(() => unwrapTrackFile(new TextEncoder().encode("hello world"), "notes.txt")).toThrow(/unsupported/);
  });

  it("sniffs gpx content", () => {
    const gpx = new TextEncoder().encode('<?xml version="1.0"?><gpx version="1.1"></gpx>');
    expect(unwrapTrackFile(gpx, "whatever.bin").fileType).toBe("gpx");
  });
});

describe("sport mapping", () => {
  it("maps every documented fit sport", () => {
    expect(mapSport("running")).toBe("Run");
    expect(mapSport("running", "trail")).toBe("TrailRun");
    expect(mapSport("running", "virtual_activity")).toBe("VirtualRun");
    expect(mapSport("cycling")).toBe("Ride");
    expect(mapSport("cycling", "mountain")).toBe("MountainBikeRide");
    expect(mapSport("cycling", "gravel_cycling")).toBe("GravelRide");
    expect(mapSport("swimming")).toBe("Swim");
    expect(mapSport("walking")).toBe("Walk");
    expect(mapSport("hiking")).toBe("Hike");
    expect(mapSport("training", "strength_training")).toBe("WeightTraining");
    expect(mapSport("fitness_equipment")).toBe("Workout");
    expect(mapSport("yoga")).toBe("Yoga");
    expect(mapSport("tennis")).toBe("Tennis");
    expect(mapSport("soccer")).toBe("Soccer");
    expect(mapSport("rock_climbing")).toBe("RockClimbing");
    expect(mapSport("paddleboarding")).toBe("Workout"); // unknown → Workout
  });
});

describe("suggestedName", () => {
  it("buckets by local hour", () => {
    expect(suggestedName("Run", 7)).toBe("morning run");
    expect(suggestedName("Ride", 14)).toBe("afternoon ride");
    expect(suggestedName("WeightTraining", 19)).toBe("evening lift");
    expect(suggestedName("Run", 23)).toBe("night run");
  });
});
