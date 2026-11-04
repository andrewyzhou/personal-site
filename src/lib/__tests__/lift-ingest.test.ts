import { describe, it, expect, vi, beforeEach } from "vitest";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "@/lib/db/schema";
import type { IngestPlan } from "@/lib/lift/plan";

// a real drizzle instance over an unreachable url: query builders render real
// sql via toSQL(), while select/batch are stubbed so nothing hits the network
const { plan, linkWorkout, state } = vi.hoisted(() => ({
  plan: vi.fn(),
  linkWorkout: vi.fn(),
  state: { db: null as unknown },
}));

vi.mock("@/lib/db", async (orig) => ({
  ...(await orig<typeof import("@/lib/db")>()),
  getDb: () => state.db,
}));
vi.mock("@/lib/lift/plan", () => ({ planShareIngest: (...a: unknown[]) => plan(...a) }));
vi.mock("@/lib/lift/link", () => ({
  linkWorkout: (...a: unknown[]) => linkWorkout(...a),
}));

import { buildIngestBatch, ingestShareText, EMPTY_TEXT } from "@/lib/lift/ingest";

const db = drizzle(neon("postgresql://user:pass@127.0.0.1:1/none"), { schema });

const SUMMARY = {
  title: "Push Day",
  startedLocal: "2026-11-04T18:12",
  exerciseCount: 1,
  workingSets: 2,
  volumeKg: 839.15,
  unit: "lb" as const,
  exercises: [],
};

function fullPlan(): IngestPlan {
  return {
    sha256: "ab".repeat(32),
    ingest: {
      id: "ing_" + "ab".repeat(12),
      source: "shortcut",
      rawSha256: "ab".repeat(32),
      rawText: "raw",
      shareSlug: "Slug1",
      workoutId: "share-Slug1",
      status: "parsed",
      warnings: [],
    },
    workout: {
      workout: {
        id: "share-Slug1",
        title: "Push Day",
        startedLocal: "2026-11-04T18:12",
        startedAt: new Date("2026-11-05T02:12:00Z"),
        utcOffsetMin: -480,
        source: "share-text",
        latestIngestId: "ing_" + "ab".repeat(12),
        shareSlug: "Slug1",
        workingSets: 2,
        volumeKg: 839.15,
        muscleLoad: { chest: 1 },
      },
      exercises: [{ id: "bench-press-barbell", name: "Bench Press (Barbell)", source: "catalog" }],
      aliases: [{ exerciseId: "bench-press-barbell", alias: "Bench Press (Barbell)", normalized: "bench press barbell" }],
      muscles: [{ exerciseId: "bench-press-barbell", region: "chest", role: "primary" }],
      workoutExercises: [
        { id: "share-Slug1:0", workoutId: "share-Slug1", exerciseId: "bench-press-barbell", position: 0, nameRaw: "Bench Press (Barbell)" },
      ],
      sets: [{ id: "share-Slug1:0:0", workoutExerciseId: "share-Slug1:0", position: 0, kind: "normal" }],
    },
    summary: SUMMARY,
    parsed: {} as IngestPlan["parsed"],
    warnings: [],
  };
}

function emptyPlan(): IngestPlan {
  const p = fullPlan();
  return { ...p, ingest: { ...p.ingest, status: "empty", workoutId: null }, workout: null, summary: null };
}

type Sqlable = { toSQL(): { sql: string; params: unknown[] } };

let existingRows: unknown[] = [];
const batch = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  existingRows = [];
  const chain = { from: () => chain, where: () => chain, limit: async () => existingRows };
  const fake = Object.create(db);
  fake.select = () => chain;
  fake.batch = batch.mockResolvedValue([]);
  state.db = fake;
  linkWorkout.mockResolvedValue([]);
});

describe("buildIngestBatch", () => {
  it("writes ingest, catalog rows, workout upsert, then replaces exercises and sets", () => {
    const sqls = buildIngestBatch(db, fullPlan()).map((q) => (q as unknown as Sqlable).toSQL().sql);
    expect(sqls).toHaveLength(8);
    expect(sqls[0]).toMatch(/^insert into "lift_ingests" .* on conflict do nothing$/);
    expect(sqls[1]).toMatch(/^insert into "exercises" .* on conflict do nothing$/);
    expect(sqls[2]).toMatch(/^insert into "exercise_aliases" .* on conflict do nothing$/);
    expect(sqls[3]).toMatch(/^insert into "exercise_muscles" .* on conflict do nothing$/);
    expect(sqls[4]).toMatch(/^insert into "lift_workouts" .* on conflict \("id"\) do update set /);
    expect(sqls[4]).toContain('"title" = excluded."title"');
    expect(sqls[4]).toContain('"deleted_at" = null');
    // a phone discard set status too; a re-share brings it back as finished
    expect(sqls[4]).toContain(`"status" = 'finished'`);
    expect(sqls[4]).not.toContain('"created_at" = ');
    // re-shares keep startedLocal fresh but leave linked timing to linkWorkout
    expect(sqls[4]).toContain('"started_local" = excluded."started_local"');
    for (const col of ["started_at", "utc_offset_min", "ended_at", "duration_s"]) {
      expect(sqls[4]).toContain(
        `"${col}" = case when exists (select 1 from "lift_workout_activities" a where a."workout_id" = "lift_workouts"."id") then "lift_workouts"."${col}" else excluded."${col}" end`
      );
    }
    expect(sqls[5]).toMatch(/^delete from "lift_workout_exercises" where "lift_workout_exercises"."workout_id" = \$1$/);
    expect(sqls[6]).toMatch(/^insert into "lift_workout_exercises"/);
    expect(sqls[7]).toMatch(/^insert into "lift_sets"/);
    // lift code never writes activities
    expect(sqls.join("\n")).not.toMatch(/"activities"/);
  });

  it("is just the ingest row for an empty parse", () => {
    const qs = buildIngestBatch(db, emptyPlan());
    expect(qs).toHaveLength(1);
    expect((qs[0] as unknown as Sqlable).toSQL().sql).toMatch(/^insert into "lift_ingests"/);
  });
});

describe("ingestShareText", () => {
  it("stores a new workout in one batch, then links it", async () => {
    plan.mockReturnValue(fullPlan());
    linkWorkout.mockResolvedValue([
      { activityId: 1, role: "primary", method: "auto", deltaMin: -2, sportType: "WeightTraining", localTime: "18:10" },
    ]);
    const res = await ingestShareText("raw", { source: "shortcut" });
    expect(plan).toHaveBeenCalledWith("raw", { source: "shortcut" });
    expect(batch).toHaveBeenCalledOnce();
    expect(batch.mock.calls[0][0]).toHaveLength(8);
    expect(linkWorkout).toHaveBeenCalledWith(expect.objectContaining({ id: "share-Slug1", startedLocal: "2026-11-04T18:12" }));
    expect(res).toMatchObject({ status: "created", duplicate: false, workoutId: "share-Slug1", ingestId: "ing_" + "ab".repeat(12) });
    expect(res.text).toMatch(/^logged push day · .* · watch: linked \(weight training 18:10\)$/);
  });

  it("still succeeds when linking blows up", async () => {
    plan.mockReturnValue(fullPlan());
    linkWorkout.mockRejectedValue(new Error("db hiccup"));
    const res = await ingestShareText("raw", { source: "shortcut" });
    expect(res.status).toBe("created");
    expect(res.links).toEqual([]);
    expect(res.text).toMatch(/watch: not linked yet$/);
  });

  it("still writes a byte-identical re-send, but reports it as a duplicate", async () => {
    // the upsert sets deleted_at = null, so this is also what un-deletes a soft-deleted workout
    plan.mockReturnValue(fullPlan());
    existingRows = [{ id: "ing_old", workoutId: "share-Slug1", status: "parsed" }];
    const res = await ingestShareText("raw", { source: "telegram" });
    expect(batch).toHaveBeenCalledOnce();
    expect(batch.mock.calls[0][0]).toHaveLength(8);
    expect(linkWorkout).toHaveBeenCalledWith(expect.objectContaining({ id: "share-Slug1" }));
    expect(res).toMatchObject({ status: "duplicate", duplicate: true, ingestId: "ing_old", workoutId: "share-Slug1" });
    expect(res.text).toMatch(/^already logged push day/);
  });

  it("restores share A after an edited B of the same slug", async () => {
    // A is seen (its ingest row exists), B overwrote the workout; A again must rewrite it
    const a = fullPlan();
    plan.mockReturnValue(a);
    existingRows = [{ id: a.ingest.id, workoutId: "share-Slug1", status: "parsed" }];
    await ingestShareText("raw A", { source: "shortcut" });
    expect(batch).toHaveBeenCalledOnce();
    const workoutUpsert = (batch.mock.calls[0][0][4] as Sqlable).toSQL();
    expect(workoutUpsert.sql).toMatch(/^insert into "lift_workouts"/);
    expect(workoutUpsert.params).toContain("Push Day");
    expect(workoutUpsert.params).toContain(a.ingest.id);
  });

  it("logs a previously empty sha once the parser can read it", async () => {
    plan.mockReturnValue(fullPlan());
    existingRows = [{ id: "ing_old", workoutId: null, status: "empty" }];
    const res = await ingestShareText("raw", { source: "api" });
    expect(batch).toHaveBeenCalledOnce();
    expect(batch.mock.calls[0][0]).toHaveLength(8);
    expect(linkWorkout).toHaveBeenCalled();
    expect(res).toMatchObject({ status: "created", duplicate: false, ingestId: "ing_old", workoutId: "share-Slug1" });
    expect(res.text).toMatch(/^logged push day/);
  });

  it("keeps the raw text of an oversized share and says why it was refused", async () => {
    const reason = "too big to log: 1 exercises / 501 sets (max 100 / 500)";
    plan.mockReturnValue({ ...emptyPlan(), rejected: reason });
    const res = await ingestShareText("huge", { source: "api" });
    expect(batch).toHaveBeenCalledOnce();
    expect(batch.mock.calls[0][0]).toHaveLength(1);
    expect(linkWorkout).not.toHaveBeenCalled();
    expect(res).toMatchObject({ status: "empty", duplicate: false, workoutId: null, text: reason });
  });

  it("keeps the raw text of an empty parse and reports it", async () => {
    plan.mockReturnValue(emptyPlan());
    const res = await ingestShareText("hello", { source: "api" });
    expect(batch).toHaveBeenCalledOnce();
    expect(batch.mock.calls[0][0]).toHaveLength(1);
    expect(linkWorkout).not.toHaveBeenCalled();
    expect(res).toMatchObject({ status: "empty", duplicate: false, workoutId: null, text: EMPTY_TEXT });
  });

  it("reports a re-sent empty share as an empty duplicate (the insert is a no-op)", async () => {
    plan.mockReturnValue(emptyPlan());
    existingRows = [{ id: "ing_old", workoutId: null, status: "empty" }];
    const res = await ingestShareText("hello", { source: "api" });
    expect(batch).toHaveBeenCalledOnce();
    expect(batch.mock.calls[0][0]).toHaveLength(1);
    expect(res).toMatchObject({ status: "empty", duplicate: true, ingestId: "ing_old", text: EMPTY_TEXT });
  });
});
