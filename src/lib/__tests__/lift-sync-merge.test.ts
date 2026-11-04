import { describe, it, expect, vi, beforeEach } from "vitest";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "@/lib/db/schema";

const { linkWorkout, state } = vi.hoisted(() => ({ linkWorkout: vi.fn(), state: { db: null as unknown } }));

vi.mock("@/lib/db", async (orig) => ({
  ...(await orig<typeof import("@/lib/db")>()),
  getDb: () => state.db,
}));
vi.mock("@/lib/lift/link", () => ({ linkWorkout: (...a: unknown[]) => linkWorkout(...a) }));
// lift-core's id helpers may still be stubs; same algorithm as the site's
vi.mock("lift-core", async (orig) => {
  const real = await orig<typeof import("lift-core")>();
  const { createHash } = await import("node:crypto");
  const sha256Hex = (t: string) => createHash("sha256").update(t, "utf8").digest("hex");
  const nameKey = (n: string) => real.normalizeName(n) || n.normalize("NFKC").toLowerCase().trim();
  return { ...real, sha256Hex, nameKey, customExerciseId: (n: string) => `custom-${sha256Hex(nameKey(n)).slice(0, 12)}` };
});

import { customExerciseId } from "lift-core";
import { followMergeChains, ingestStrongText } from "@/lib/lift/ingest";
import { planStrongIngest } from "@/lib/lift/plan";

const db = drizzle(neon("postgresql://user:pass@127.0.0.1:1/none"), { schema });

const NAME = "Zercher Wobble Hold (Barbell)";
const TEXT = `Leg Day\nWednesday, November 4, 2026 at 6:12 PM\n\n${NAME}\nSet 1: 100 lb × 5\n\nBench Press (Barbell)\nSet 1: 185 lb × 5`;
const CUSTOM = customExerciseId(NAME);

describe("followMergeChains", () => {
  it("follows chains to the end", () => {
    const lookup = new Map<string, string | null>([
      ["a", "b"],
      ["b", "c"],
      ["c", null],
      ["x", null],
    ]);
    expect(followMergeChains(["a", "b", "x", "missing"], lookup)).toEqual(new Map([["a", "c"], ["b", "c"]]));
  });

  it("stops at 5 hops and on cycles", () => {
    const long = new Map<string, string | null>([..."abcdefg"].map((c, i, all) => [c, all[i + 1] ?? null]));
    expect(followMergeChains(["a"], long).get("a")).toBe("f");
    const cycle = new Map<string, string | null>([
      ["a", "b"],
      ["b", "a"],
    ]);
    expect(followMergeChains(["a"], cycle).get("a")).toBe("b");
  });
});

describe("planStrongIngest with redirects", () => {
  it("logs a merged custom exercise against a catalog target", () => {
    const plain = planStrongIngest(TEXT, { source: "api" });
    expect(plain.workout!.workoutExercises[0].exerciseId).toBe(CUSTOM);

    const p = planStrongIngest(TEXT, { source: "api", redirects: new Map([[CUSTOM, "squat-barbell"]]) });
    const w = p.workout!;
    expect(w.workoutExercises[0]).toMatchObject({ exerciseId: "squat-barbell", nameRaw: NAME });
    expect(w.exercises.map((e) => e.id).sort()).toEqual(["bench-press-barbell", "squat-barbell"]);
    expect(p.summary!.exercises[0]).toMatchObject({ exerciseId: "squat-barbell", custom: false });
    // the target's muscles now count
    expect(w.workout.muscleLoad).toHaveProperty("quads");
  });

  it("writes no exercise row for a custom target (it already exists)", () => {
    const p = planStrongIngest(TEXT, { source: "api", redirects: new Map([[CUSTOM, "custom-target000000"]]) });
    expect(p.workout!.workoutExercises[0].exerciseId).toBe("custom-target000000");
    expect(p.workout!.exercises.map((e) => e.id)).toEqual(["bench-press-barbell"]);
    expect(p.summary!.exercises[0].custom).toBe(true);
  });
});

describe("ingestStrongText merge redirect", () => {
  let selects: unknown[][];
  const batch = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    selects = [];
    const fake = Object.create(db);
    fake.select = () => {
      const result = selects.shift() ?? [];
      const done = Promise.resolve(result);
      const chain = { from: () => chain, where: () => chain, limit: () => done, then: done.then.bind(done) };
      return chain;
    };
    fake.batch = batch.mockResolvedValue([]);
    state.db = fake;
    linkWorkout.mockResolvedValue([]);
  });

  it("looks up merges for custom exercises and re-plans against the target", async () => {
    // hop 1: the custom row was merged; hop 2: the target isn't merged further; then the sha lookup
    selects.push([{ id: CUSTOM, mergedInto: "squat-barbell" }], [{ id: "squat-barbell", mergedInto: null }], []);
    const res = await ingestStrongText(TEXT, { source: "api" });
    expect(res.status).toBe("created");
    expect(res.summary!.exercises[0]).toMatchObject({ exerciseId: "squat-barbell", custom: false });
    type Sqlable = { toSQL(): { sql: string; params: unknown[] } };
    const writes = (batch.mock.calls[0][0] as Sqlable[]).map((q) => q.toSQL());
    const we = writes.find((w) => w.sql.startsWith('insert into "lift_workout_exercises"'))!;
    expect(we.params).toContain("squat-barbell");
    expect(we.params).not.toContain(CUSTOM);
  });

  it("does nothing extra when nothing was merged", async () => {
    selects.push([{ id: CUSTOM, mergedInto: null }], []);
    const res = await ingestStrongText(TEXT, { source: "api" });
    expect(res.summary!.exercises[0]).toMatchObject({ exerciseId: CUSTOM, custom: true });
  });
});
