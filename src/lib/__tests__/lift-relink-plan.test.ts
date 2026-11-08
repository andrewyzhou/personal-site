import { describe, expect, it } from "vitest";
import { formatRelinkReport, planRelink, type RelinkActivity, type RelinkLink, type RelinkWorkout } from "@/lib/lift/relink-plan";

const w = (id: string, startedLocal: string): RelinkWorkout => ({ id, startedLocal, title: `lift ${id}` });
const a = (id: number, sportType: string, start: string, minutes: number, name = ""): RelinkActivity => ({
  id,
  sportType,
  name,
  localDate: start.slice(0, 10),
  localTime: start.slice(11, 16),
  elapsedS: minutes * 60,
});

describe("planRelink", () => {
  const recordings = [
    a(1, "WeightTraining", "2026-11-01T18:00", 60),
    a(2, "Ride", "2026-11-02T17:00", 100, "bike + lift"),
    a(3, "Run", "2026-11-03T07:00", 30),
    a(4, "WeightTraining", "2026-11-04T18:05", 50),
  ];

  it("links unlinked workouts inside any sport, and leaves existing links alone", () => {
    const workouts = [
      w("a", "2026-11-01T18:02"), // already linked to #1
      w("b", "2026-11-02T18:10"), // inside the ride: new
      w("c", "2026-11-03T12:00"), // nothing near: stays lift-only
      w("d", "2026-11-04T18:00"), // manual link elsewhere
    ];
    const links: RelinkLink[] = [
      { workoutId: "a", activityId: 1, role: "primary", method: "auto" },
      { workoutId: "d", activityId: 3, role: "primary", method: "manual" },
    ];
    const rows = planRelink(workouts, links, recordings);
    expect(rows.map((r) => [r.workout.id, r.change])).toEqual([
      ["a", "unchanged"],
      ["b", "new-link"],
      ["c", "unchanged"],
      ["d", "manual"],
    ]);
    expect(rows[1].proposed).toEqual([{ activityId: 2, role: "overrun", deltaMin: -70 }]);
    const text = formatRelinkReport(rows, recordings);
    expect(text).toContain("new link (unlinked today, would link): 1");
    expect(text).toContain('proposed: #2 overrun (Ride 2026-11-02 17:00 "bike + lift")');
  });

  it("reports an auto link the new rule would pick differently, without claiming it", () => {
    // auto-linked to the 18:05 recording, which the new rule also picks
    const same = planRelink([w("x", "2026-11-04T18:00")], [{ workoutId: "x", activityId: 4, role: "primary", method: "auto" }], recordings);
    expect(same[0].change).toBe("unchanged");
    // stored as overrun, but the rule now says primary
    const diff = planRelink([w("x", "2026-11-04T18:00")], [{ workoutId: "x", activityId: 4, role: "overrun", method: "auto" }], recordings);
    expect(diff[0].change).toBe("would-change");
    expect(formatRelinkReport(diff, recordings)).toMatch(/now: {6}#4 overrun[\s\S]*proposed: #4 primary/);
  });

  it("never offers a recording another workout holds, and claims new links in order", () => {
    const rec = [a(9, "Ride", "2026-11-05T10:00", 120)];
    const rows = planRelink([w("p", "2026-11-05T10:30"), w("q", "2026-11-05T11:00")], [], rec);
    expect(rows.map((r) => r.change)).toEqual(["new-link", "unchanged"]);
    const held = planRelink([w("q", "2026-11-05T11:00")], [{ workoutId: "z", activityId: 9, role: "primary", method: "auto" }], rec);
    expect(held[0].proposed).toEqual([]);
  });
});
