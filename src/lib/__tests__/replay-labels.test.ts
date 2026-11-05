import { describe, it, expect } from "vitest";
import { chipKey, chipLabel, formatClock, formatDurationShort, formatSpeed, formatSpeedChoice } from "@/lib/replay/labels";

describe("replay labels", () => {
  it("formats clocks", () => {
    expect(formatClock(0)).toBe("0:00");
    expect(formatClock(75)).toBe("1:15");
    expect(formatClock(3725)).toBe("1:02:05");
    expect(formatClock(-4)).toBe("0:00");
  });

  it("formats speed choices", () => {
    expect(formatSpeedChoice(60)).toBe("60×");
  });

  it("formats short durations", () => {
    expect(formatDurationShort(45)).toBe("45 s");
    expect(formatDurationShort(300)).toBe("5 min");
    expect(formatDurationShort(90)).toBe("2 min");
    expect(formatDurationShort(3600)).toBe("1 h");
    expect(formatDurationShort(3900)).toBe("1 h 5 min");
  });

  it("uses pace on foot and speed otherwise", () => {
    expect(formatSpeed(1000 / 270, "Run", "km")).toBe("4:30 /km");
    expect(formatSpeed(0, "Run", "km")).toBe("–:– /km");
    expect(formatSpeed(10, "Ride", "km")).toBe("36.0 km/h");
    expect(formatSpeed(10, "Ride", "mi")).toBe("22.4 mph");
  });

  it("labels chips", () => {
    expect(chipLabel({ kind: "pause", t: 0, endT: 120, durationS: 120 }, "Run", "km")).toBe("paused · 2 min");
    expect(chipLabel({ kind: "fog", t: 0, endT: 600, durationS: 600, gap: 0 }, "Run", "km")).toBe("in the fog · 10 min");
    expect(chipLabel({ kind: "cut", t: 5, endT: 5, gap: 1 }, "Run", "km")).toBe("skipped");
    expect(chipLabel({ kind: "split", t: 5, endT: 5, n: 3, unit: "km" }, "Run", "km")).toBe("km 3");
    expect(chipLabel({ kind: "split", t: 5, endT: 5, n: 2, unit: "mi" }, "Run", "mi")).toBe("mi 2");
    expect(chipLabel({ kind: "maxSpeed", t: 5, endT: 5, speed: 1000 / 240 }, "Run", "km")).toBe("fastest · 4:00 /km");
    expect(chipLabel({ kind: "maxSpeed", t: 5, endT: 5, speed: 12 }, "Ride", "km")).toBe("top speed · 43.2 km/h");
  });

  it("keys chips stably", () => {
    expect(chipKey({ kind: "cut", t: 5.4, endT: 5.4, gap: 1 })).toBe("cut:5");
  });
});
