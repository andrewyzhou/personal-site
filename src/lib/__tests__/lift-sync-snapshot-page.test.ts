import { describe, it, expect, vi, beforeEach } from "vitest";
import { drizzle } from "drizzle-orm/pg-proxy";
import { SNAPSHOT_ENTITIES, SNAPSHOT_PAGE_MAX, type BodyweightPayload } from "lift-core";

// a proxy driver records every query and answers with canned rows, so the
// paged loader's real sql is checked without a database
const { calls, answers } = vi.hoisted(() => ({
  calls: [] as { sql: string; params: unknown[] }[],
  answers: [] as unknown[][][],
}));
vi.mock("@/lib/db", async () => {
  const schema = await import("@/lib/db/schema");
  const db = drizzle(
    async (sql, params) => {
      calls.push({ sql, params });
      return { rows: answers.shift() ?? [] };
    },
    { schema }
  );
  return { getDb: () => db };
});

import { loadSnapshotPage, parseSnapshotQuery, snapshotPage } from "@/lib/lift/sync/snapshot";

const bw = (id: string): BodyweightPayload => ({ id, measuredAt: 1, weight: 180, unit: "lb", note: null, createdAt: 1, updatedAt: 1 });

describe("snapshotPage", () => {
  it("returns limit rows and the last id as the cursor when there is more", () => {
    const page = snapshotPage("bodyweights", [bw("a"), bw("b"), bw("c")], 2, new Date(9));
    expect(page).toEqual({ protocol: 1, entity: "bodyweights", rows: [bw("a"), bw("b")], next: "b", generatedAt: 9 });
  });
  it("ends with next null on the last page, including an empty one", () => {
    expect(snapshotPage("bodyweights", [bw("a"), bw("b")], 2).next).toBeNull();
    expect(snapshotPage("sets", [], 2)).toMatchObject({ rows: [], next: null });
  });
});

describe("parseSnapshotQuery", () => {
  const q = (s: string) => parseSnapshotQuery(new URLSearchParams(s));
  it("defaults to the first page at the max size", () => {
    expect(q("entity=workouts")).toEqual({ ok: true, query: { entity: "workouts", after: null, limit: SNAPSHOT_PAGE_MAX } });
    expect(q("entity=sets&after=abc&limit=10")).toEqual({ ok: true, query: { entity: "sets", after: "abc", limit: 10 } });
  });
  it("accepts every snapshot entity and nothing else", () => {
    for (const e of SNAPSHOT_ENTITIES) expect(q(`entity=${e}`).ok).toBe(true);
    expect(q("entity=set").ok).toBe(false);
    expect(q("").ok).toBe(false);
  });
  it("bounds the limit and the cursor", () => {
    expect(q(`entity=sets&limit=${SNAPSHOT_PAGE_MAX + 1}`).ok).toBe(false);
    expect(q("entity=sets&limit=0").ok).toBe(false);
    expect(q("entity=sets&limit=1.5").ok).toBe(false);
    expect(q("entity=sets&after=").ok).toBe(false);
    expect(q(`entity=sets&after=${"x".repeat(129)}`).ok).toBe(false);
  });
});

describe("loadSnapshotPage", () => {
  beforeEach(() => {
    calls.length = 0;
    answers.length = 0;
  });

  it("reads one entity in id order after the cursor, asking for one extra row", async () => {
    const page = await loadSnapshotPage({ entity: "bodyweights", after: "bw-5", limit: 50 }, new Date(3));
    expect(page).toEqual({ protocol: 1, entity: "bodyweights", rows: [], next: null, generatedAt: 3 });
    expect(calls).toHaveLength(1);
    expect(calls[0].sql).toMatch(/from "lift_bodyweights" where "lift_bodyweights"."id" > \$1 order by "lift_bodyweights"."id" asc limit \$2$/);
    expect(calls[0].params).toEqual(["bw-5", 51]);
  });

  it("starts without a cursor", async () => {
    await loadSnapshotPage({ entity: "templates", after: null, limit: 10 });
    expect(calls[0].sql).not.toContain(" > ");
    expect(calls[0].sql).toMatch(/order by "lift_templates"."id" asc limit \$1$/);
  });

  it("hides soft-deleted imported workouts from workouts, their exercises and sets", async () => {
    for (const entity of ["workouts", "workoutExercises", "sets"] as const) {
      calls.length = 0;
      await loadSnapshotPage({ entity, after: "x", limit: 10 });
      expect(calls[0].sql).toContain(`("lift_workouts"."source" = $1 or "lift_workouts"."deleted_at" is null)`);
      expect(calls[0].params[0]).toBe("app");
    }
  });

  it("loads muscles only for the custom exercises on this page", async () => {
    const t = new Date(0).toISOString();
    // id, name, equipment, category, tracking, source, is_custom, archived, free_db_id, merged_into, created_at, updated_at
    answers.push([["custom-aaaaaaaaaaaa", "Belt Squat", "machine", "strength", "weight_reps", "app", true, false, null, null, t, t]]);
    answers.push([["custom-aaaaaaaaaaaa", "quads", "primary"]]);
    const page = await loadSnapshotPage({ entity: "customExercises", after: null, limit: 10 });
    expect(calls).toHaveLength(2);
    expect(calls[0].sql).toContain(`"exercises"."is_custom" = $1`);
    expect(calls[1].sql).toMatch(/from "exercise_muscles" where "exercise_muscles"."exercise_id" in \(\$1\)$/);
    expect(page.rows).toMatchObject([{ id: "custom-aaaaaaaaaaaa", primary: '["quads"]', secondary: "[]" }]);
  });

  it("pages programs, re-serializing their jsonb into ProgramData text", async () => {
    const t = new Date(5).toISOString();
    // id, name, data, active, created_at, updated_at
    answers.push([["p1", "5x5", { weeks: [{ days: [{ templateId: "t1" }] }], version: 1, rules: {}, repeat: false, skipped: 0, startedAt: 7 }, true, t, t]]);
    const page = await loadSnapshotPage({ entity: "programs", after: null, limit: 10 });
    expect(calls[0].sql).toMatch(/from "lift_programs" order by "lift_programs"."id" asc limit \$1$/);
    expect(page.rows).toEqual([
      {
        id: "p1",
        name: "5x5",
        data: '{"version":1,"weeks":[{"days":[{"templateId":"t1"}]}],"rules":{},"startedAt":7,"skipped":0,"repeat":false}',
        active: 1,
        createdAt: 5,
        updatedAt: 5,
      },
    ]);
  });

  it("programs is the last snapshot entity", () => {
    expect(SNAPSHOT_ENTITIES[SNAPSHOT_ENTITIES.length - 1]).toBe("programs");
  });

  it("skips the muscle query for an empty page", async () => {
    await loadSnapshotPage({ entity: "customExercises", after: "zzz", limit: 10 });
    expect(calls).toHaveLength(1);
  });
});
