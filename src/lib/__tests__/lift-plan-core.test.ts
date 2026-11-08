import { describe, it, expect } from "vitest";
import { linkWorkoutToActivities } from "lift-core";
import { planShareIngest } from "@/lib/lift/plan";
import { customExerciseId } from "@/lib/lift/rows";
import { formatIngestSummary } from "@/lib/lift/summary";

// no mocks: the planner against the real lift-core parser, catalog and math

const SAMPLE = `Push Day
Wednesday, November 4, 2026 at 6:12 PM

Bench Press (Barbell)
W1: 95 lb × 10
Set 1: 185 lb × 5
Set 2: 185 lb × 5 @ 8

Pull Up
Set 1: 12 reps
Set 2: +25 lb × 8

https://example.com/w/AbCdEf123`;

describe("planShareIngest with the real lift-core", () => {
  const plan = planShareIngest(SAMPLE, { source: "shortcut", timezone: "America/Los_Angeles" });

  it("parses the sample share into a workout", () => {
    expect(plan.ingest.status).toBe("parsed");
    const w = plan.workout!;
    expect(w.workout).toMatchObject({
      id: "share-AbCdEf123",
      title: "Push Day",
      startedLocal: "2026-11-04T18:12",
      shareSlug: "AbCdEf123",
      workingSets: 4,
      utcOffsetMin: -480,
    });
    expect(w.workout.volumeKg).toBeGreaterThanOrEqual(839);
    expect(w.workoutExercises.map((we) => we.nameRaw)).toEqual(["Bench Press (Barbell)", "Pull Up"]);
    expect(w.sets).toHaveLength(5);
    expect(w.sets[0]).toMatchObject({ kind: "warmup", weight: 95, unit: "lb", reps: 10, e1rmKg: null });
    expect(w.sets[2]).toMatchObject({ rpe: 8 });
    expect(w.sets[3]).toMatchObject({ reps: 12, bodyweight: true, e1rmKg: null });
    expect(w.sets[4]).toMatchObject({ weight: 25, bodyweight: true, e1rmKg: null });
  });

  it("resolves both names to catalog exercises with muscles", () => {
    const w = plan.workout!;
    expect(w.exercises.every((e) => e.source === "catalog" && !e.isCustom)).toBe(true);
    expect(w.muscles.some((m) => m.region === "chest" && m.role === "primary")).toBe(true);
    expect(w.muscles.some((m) => m.region === "lats")).toBe(true);
    const load = w.workout.muscleLoad as Record<string, number>;
    expect(Math.max(...Object.values(load))).toBeCloseTo(1);
  });

  it("formats the summary line", () => {
    // tonnage rules (e.g. whether "+25 lb" counts) belong to lift-core, so only the shape is pinned
    expect(formatIngestSummary(plan.summary!, [])).toMatch(
      /^logged push day · wed nov 4 · 2 exercises · 4 sets · \d{1,3}(,\d{3})* lb · created lift session$/
    );
  });

  it("links to a watch recording that started two minutes early", () => {
    const links = linkWorkoutToActivities(plan.workout!.workout.startedLocal, [
      { id: 11, sportType: "WeightTraining", localStart: "2026-11-04T18:10", elapsedS: 3000 },
      { id: 12, sportType: "WeightTraining", localStart: "2026-11-04T08:00", elapsedS: 3000 },
    ]);
    expect(links).toEqual([expect.objectContaining({ activityId: 11, role: "primary" })]);
  });

  it("gives non-latin and punctuation-only custom names their own ids", () => {
    const names = ["Жим лёжа", "深蹲", "!!!"];
    const ids = names.map(customExerciseId);
    expect(new Set(ids).size).toBe(3);
    expect(customExerciseId("  жим ЛЁЖА ")).toBe(ids[0]);

    const text = `Odd Day
Wednesday, November 4, 2026 at 6:12 PM

${names.map((n) => `${n}\nSet 1: 10 kg × 5`).join("\n\n")}`;
    const w = planShareIngest(text, { source: "api", timezone: "UTC" }).workout!;
    expect(w.exercises.map((e) => e.id)).toEqual(ids);
    expect(w.workoutExercises.map((we) => we.exerciseId)).toEqual(ids);
  });

  it("collapses the same linkless workout sent with different trailing bytes", () => {
    const linkless = SAMPLE.replace(/\n\nhttps:.*$/, "");
    const a = planShareIngest(linkless, { source: "shortcut", timezone: "UTC" });
    const b = planShareIngest(linkless + "\n\n  ", { source: "telegram", timezone: "UTC" });
    expect(a.sha256).not.toBe(b.sha256);
    expect(a.workout!.workout.id).toMatch(/^share-[0-9a-f]{16}$/);
    expect(b.workout!.workout.id).toBe(a.workout!.workout.id);
  });

  it("sends a non-workout to an empty ingest", () => {
    const empty = planShareIngest("hey what's up", { source: "telegram" });
    expect(empty.ingest.status).toBe("empty");
    expect(empty.workout).toBeNull();
  });
});
