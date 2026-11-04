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
vi.mock("@/lib/lift/plan", async (orig) => ({
  ...(await orig<typeof import("@/lib/lift/plan")>()),
  planStrongIngest: (...a: unknown[]) => plan(...a),
}));
vi.mock("@/lib/lift/link", () => ({
  linkWorkout: (...a: unknown[]) => linkWorkout(...a),
}));

import { buildIngestBatch, editCandidatesWhere, ingestStrongText, EMPTY_TEXT } from "@/lib/lift/ingest";

const realPlan = (await vi.importActual<typeof import("@/lib/lift/plan")>("@/lib/lift/plan")).planStrongIngest;

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
      strongSlug: "Slug1",
      workoutId: "strong-Slug1",
      status: "parsed",
      warnings: [],
    },
    workout: {
      workout: {
        id: "strong-Slug1",
        title: "Push Day",
        startedLocal: "2026-11-04T18:12",
        startedAt: new Date("2026-11-05T02:12:00Z"),
        utcOffsetMin: -480,
        source: "strong-text",
        latestIngestId: "ing_" + "ab".repeat(12),
        strongSlug: "Slug1",
        workingSets: 2,
        volumeKg: 839.15,
        muscleLoad: { chest: 1 },
      },
      exercises: [{ id: "bench-press-barbell", name: "Bench Press (Barbell)", source: "catalog" }],
      aliases: [{ exerciseId: "bench-press-barbell", alias: "Bench Press (Barbell)", normalized: "bench press barbell" }],
      muscles: [{ exerciseId: "bench-press-barbell", region: "chest", role: "primary" }],
      workoutExercises: [
        { id: "strong-Slug1:0", workoutId: "strong-Slug1", exerciseId: "bench-press-barbell", position: 0, nameRaw: "Bench Press (Barbell)" },
      ],
      sets: [{ id: "strong-Slug1:0:0", workoutExerciseId: "strong-Slug1:0", position: 0, kind: "normal" }],
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

// selects ignore their where clause and return the table's rows; the code
// under test re-checks what it needs (pickEditTarget filters candidates itself)
let existingRows: unknown[] = [];
let workoutRows: unknown[] = [];
let workoutExerciseRows: unknown[] = [];
const batch = vi.fn();

function rowsFor(table: unknown): unknown[] {
  if (table === schema.liftIngests) return existingRows;
  if (table === schema.liftWorkouts) return workoutRows;
  if (table === schema.liftWorkoutExercises) return workoutExerciseRows;
  return [];
}

beforeEach(() => {
  vi.clearAllMocks();
  existingRows = [];
  workoutRows = [];
  workoutExerciseRows = [];
  const fake = Object.create(db);
  fake.select = () => ({
    from: (table: unknown) => {
      const rows = async () => rowsFor(table);
      const q = { where: () => q, limit: rows, then: (ok: (v: unknown[]) => unknown, no: (e: unknown) => unknown) => rows().then(ok, no) };
      return q;
    },
  });
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

describe("ingestStrongText", () => {
  it("stores a new workout in one batch, then links it", async () => {
    plan.mockReturnValue(fullPlan());
    linkWorkout.mockResolvedValue([
      { activityId: 1, role: "primary", method: "auto", deltaMin: -2, sportType: "WeightTraining", localTime: "18:10" },
    ]);
    const res = await ingestStrongText("raw", { source: "shortcut" });
    expect(plan).toHaveBeenCalledWith("raw", { source: "shortcut" });
    expect(batch).toHaveBeenCalledOnce();
    expect(batch.mock.calls[0][0]).toHaveLength(8);
    expect(linkWorkout).toHaveBeenCalledWith(expect.objectContaining({ id: "strong-Slug1", startedLocal: "2026-11-04T18:12" }));
    expect(res).toMatchObject({ status: "created", duplicate: false, workoutId: "strong-Slug1", ingestId: "ing_" + "ab".repeat(12) });
    expect(res.text).toMatch(/^logged push day · .* · watch: linked \(weight training 18:10\)$/);
  });

  it("still succeeds when linking blows up", async () => {
    plan.mockReturnValue(fullPlan());
    linkWorkout.mockRejectedValue(new Error("db hiccup"));
    const res = await ingestStrongText("raw", { source: "shortcut" });
    expect(res.status).toBe("created");
    expect(res.links).toEqual([]);
    expect(res.text).toMatch(/watch: not linked yet$/);
  });

  it("still writes a byte-identical re-send, but reports it as a duplicate", async () => {
    // the upsert sets deleted_at = null, so this is also what un-deletes a soft-deleted workout
    plan.mockReturnValue(fullPlan());
    existingRows = [{ id: "ing_old", workoutId: "strong-Slug1", status: "parsed" }];
    const res = await ingestStrongText("raw", { source: "telegram" });
    expect(batch).toHaveBeenCalledOnce();
    expect(batch.mock.calls[0][0]).toHaveLength(8);
    expect(linkWorkout).toHaveBeenCalledWith(expect.objectContaining({ id: "strong-Slug1" }));
    expect(res).toMatchObject({ status: "duplicate", duplicate: true, ingestId: "ing_old", workoutId: "strong-Slug1" });
    expect(res.text).toMatch(/^already logged push day/);
  });

  it("restores share A after an edited B of the same slug", async () => {
    // A is seen (its ingest row exists), B overwrote the workout; A again must rewrite it
    const a = fullPlan();
    plan.mockReturnValue(a);
    existingRows = [{ id: a.ingest.id, workoutId: "strong-Slug1", status: "parsed" }];
    await ingestStrongText("raw A", { source: "shortcut" });
    expect(batch).toHaveBeenCalledOnce();
    const workoutUpsert = (batch.mock.calls[0][0][4] as Sqlable).toSQL();
    expect(workoutUpsert.sql).toMatch(/^insert into "lift_workouts"/);
    expect(workoutUpsert.params).toContain("Push Day");
    expect(workoutUpsert.params).toContain(a.ingest.id);
  });

  it("logs a previously empty sha once the parser can read it", async () => {
    plan.mockReturnValue(fullPlan());
    existingRows = [{ id: "ing_old", workoutId: null, status: "empty" }];
    const res = await ingestStrongText("raw", { source: "api" });
    expect(batch).toHaveBeenCalledOnce();
    expect(batch.mock.calls[0][0]).toHaveLength(8);
    expect(linkWorkout).toHaveBeenCalled();
    expect(res).toMatchObject({ status: "created", duplicate: false, ingestId: "ing_old", workoutId: "strong-Slug1" });
    expect(res.text).toMatch(/^logged push day/);
  });

  it("keeps the raw text of an oversized share and says why it was refused", async () => {
    const reason = "too big to log: 1 exercises / 501 sets (max 100 / 500)";
    plan.mockReturnValue({ ...emptyPlan(), rejected: reason });
    const res = await ingestStrongText("huge", { source: "api" });
    expect(batch).toHaveBeenCalledOnce();
    expect(batch.mock.calls[0][0]).toHaveLength(1);
    expect(linkWorkout).not.toHaveBeenCalled();
    expect(res).toMatchObject({ status: "empty", duplicate: false, workoutId: null, text: reason });
  });

  it("keeps the raw text of an empty parse and reports it", async () => {
    plan.mockReturnValue(emptyPlan());
    const res = await ingestStrongText("hello", { source: "api" });
    expect(batch).toHaveBeenCalledOnce();
    expect(batch.mock.calls[0][0]).toHaveLength(1);
    expect(linkWorkout).not.toHaveBeenCalled();
    expect(res).toMatchObject({ status: "empty", duplicate: false, workoutId: null, text: EMPTY_TEXT });
  });

  it("reports a re-sent empty share as an empty duplicate (the insert is a no-op)", async () => {
    plan.mockReturnValue(emptyPlan());
    existingRows = [{ id: "ing_old", workoutId: null, status: "empty" }];
    const res = await ingestStrongText("hello", { source: "api" });
    expect(batch).toHaveBeenCalledOnce();
    expect(batch.mock.calls[0][0]).toHaveLength(1);
    expect(res).toMatchObject({ status: "empty", duplicate: true, ingestId: "ing_old", text: EMPTY_TEXT });
  });
});

describe("editCandidatesWhere", () => {
  it("matches its own id, its link, or a live strong workout at the same minute", () => {
    const q = db.select().from(schema.liftWorkouts).where(editCandidatesWhere("strong-y", "y", "2026-11-02T19:18")).toSQL();
    expect(q.sql).toMatch(
      /where \("lift_workouts"."id" = \$1 or "lift_workouts"."strong_slug" = \$2 or \("lift_workouts"."started_local" = \$3 and "lift_workouts"."source" like \$4 and "lift_workouts"."deleted_at" is null\)\)$/
    );
    expect(q.params).toEqual(["strong-y", "y", "2026-11-02T19:18", "strong%"]);
    const bare = db.select().from(schema.liftWorkouts).where(editCandidatesWhere("strong-z", null, null)).toSQL();
    expect(bare.params).toEqual(["strong-z"]);
  });
});

// the owner's real share from 2026-11-02 (lift_ingests raw_text), byte for byte
const FULL_BODY_B =
  "Full Body B\nMonday, November 2, 2026 at 7:18 PM\n\nSquat (Barbell)\nW1: 45 lb × 6 [Warm-up]\nW2: 135 lb × 4 [Warm-up]\n" +
  "Set 1: 185 lb × 5\nSet 2: 185 lb × 5\n\nDeadlift (Barbell)\nSet 1: 185 lb × 5\nSet 2: 185 lb × 4\n\n" +
  "Bicep Curl (Dumbbell)\nSet 1: 35 lb × 6\nSet 2: 35 lb × 7\n\nhttps://link.strong.app/caterxeu\n";
// edited in strong afterwards (deadlift set 2 got its fifth rep) and shared again: new link
const FULL_BODY_B_EDITED = FULL_BODY_B.replace("Set 2: 185 lb × 4", "Set 2: 185 lb × 5").replace("caterxeu", "q7Edit2b");
const CORE_SAME_MINUTE =
  "Core Finisher\nMonday, November 2, 2026 at 7:18 PM\n\nCable Crunch\nSet 1: 50 lb × 15\n\nHanging Leg Raise\nSet 1: 12 reps\n\n" +
  "https://link.strong.app/core9xyz\n";

describe("ingestStrongText re-share sequences (real planner)", () => {
  type Row = Record<string, unknown>;

  beforeEach(() => {
    process.env.LIFT_TIMEZONE = "America/Los_Angeles";
    plan.mockImplementation((...a: Parameters<typeof realPlan>) => realPlan(...a));
  });

  // what the batch would have left in the db: the last plan the ingest wrote
  function commit() {
    const p = plan.mock.results.at(-1)!.value as IngestPlan;
    const ingests = existingRows as Row[];
    if (!ingests.some((r) => r.rawSha256 === p.sha256)) {
      ingests.push({ id: p.ingest.id, workoutId: p.ingest.workoutId, status: p.ingest.status, rawSha256: p.sha256 });
    }
    if (!p.workout) return;
    const w = p.workout.workout;
    workoutRows = [
      ...(workoutRows as Row[]).filter((r) => r.id !== w.id),
      { id: w.id, title: w.title, startedLocal: w.startedLocal, strongSlug: w.strongSlug, source: w.source, deletedAt: null },
    ];
    workoutExerciseRows = [
      ...(workoutExerciseRows as Row[]).filter((r) => r.workoutId !== w.id),
      ...p.workout.workoutExercises.map((we) => ({ workoutId: we.workoutId, nameRaw: we.nameRaw })),
    ];
  }

  // the ingest lookup is by sha, which the fake's where can't see
  beforeEach(() => {
    const all = () => existingRows as Row[];
    const fake = state.db as { select: () => { from: (t: unknown) => unknown } };
    const base = fake.select;
    fake.select = () => ({
      from: (table: unknown) => {
        if (table !== schema.liftIngests) return base().from(table);
        const sha = (plan.mock.results.at(-1)?.value as IngestPlan | undefined)?.sha256;
        const rows = async () => all().filter((r) => r.rawSha256 === sha);
        const q = { where: () => q, limit: rows };
        return q;
      },
    });
  });

  async function share(text: string) {
    batch.mockClear();
    const res = await ingestStrongText(text, { source: "telegram" });
    const writes = (batch.mock.calls[0][0] as Sqlable[]).map((q) => q.toSQL());
    commit();
    return { res, writes, plan: plan.mock.results.at(-1)!.value as IngestPlan };
  }

  it("an edited re-share with a new link updates the same workout; a byte-identical one is a duplicate", async () => {
    const a = await share(FULL_BODY_B);
    expect(a.res).toMatchObject({ status: "created", workoutId: "strong-caterxeu" });
    expect(a.res.details.split("\n")[0]).toMatch(/^logged full body b · mon nov 2 · 3 exercises · 6 sets/);

    const b = await share(FULL_BODY_B_EDITED);
    expect(b.res).toMatchObject({ status: "updated", duplicate: false, workoutId: "strong-caterxeu" });
    expect(b.res.text).toMatch(/^updated full body b · mon nov 2 · 3 exercises · 6 sets · 4,155 lb · /);
    expect(b.res.details.split("\n")).toContain("deadlift (barbell): 2×5 @ 185 lb · top e1rm 216 lb");
    // a fresh ingest row keeps the edited raw and points at the old workout
    expect(b.plan.ingest).toMatchObject({ rawText: FULL_BODY_B_EDITED, strongSlug: "q7Edit2b", workoutId: "strong-caterxeu" });
    expect(b.res.ingestId).toBe(b.plan.ingest.id);
    expect(b.res.ingestId).not.toBe(a.res.ingestId);
    expect(b.writes[0].params).toContain(FULL_BODY_B_EDITED);
    // the workout is upserted in place (links live on its id) and its exercises replaced
    const upsert = b.writes.find((w) => w.sql.startsWith('insert into "lift_workouts"'))!;
    expect(upsert.params).toContain("strong-caterxeu");
    expect(upsert.params).toContain("q7Edit2b");
    expect(upsert.params).not.toContain("strong-q7Edit2b");
    const replace = b.writes.find((w) => w.sql.startsWith('delete from "lift_workout_exercises"'))!;
    expect(replace.params).toEqual(["strong-caterxeu"]);
    expect(b.plan.workout!.sets.every((s) => String(s.id).startsWith("strong-caterxeu:"))).toBe(true);
    expect(workoutRows).toHaveLength(1);

    const again = await share(FULL_BODY_B_EDITED);
    expect(again.res).toMatchObject({ status: "duplicate", duplicate: true, workoutId: "strong-caterxeu", ingestId: b.res.ingestId });
    expect(again.res.text).toMatch(/^already logged full body b/);

    // the original bytes are seen too: they go back to the same workout, not a second copy
    const old = await share(FULL_BODY_B);
    expect(old.res).toMatchObject({ status: "duplicate", workoutId: "strong-caterxeu" });
    expect(workoutRows).toHaveLength(1);
  });

  it("a different workout at the same minute stays its own", async () => {
    await share(FULL_BODY_B);
    const core = await share(CORE_SAME_MINUTE);
    expect(core.res).toMatchObject({ status: "created", workoutId: "strong-core9xyz" });
    expect(core.res.text).toMatch(/^logged core finisher/);
    expect(workoutRows).toHaveLength(2);
    // and the edited full body b still finds its own workout next to it
    const b = await share(FULL_BODY_B_EDITED);
    expect(b.res).toMatchObject({ status: "updated", workoutId: "strong-caterxeu" });
  });

  it("a renamed edit still lands on the workout when most exercises carry over", async () => {
    await share(FULL_BODY_B);
    const renamed = await share(FULL_BODY_B_EDITED.replace("Full Body B", "Full Body B (light)"));
    expect(renamed.res).toMatchObject({ status: "updated", workoutId: "strong-caterxeu" });
    expect(renamed.res.text).toMatch(/^updated full body b \(light\)/);
  });

  it("doesn't guess between two candidates: logs new and says why", async () => {
    workoutRows = [
      { id: "strong-csv-a", title: "Full Body B", startedLocal: "2026-11-02T19:18", strongSlug: null, source: "strong-csv", deletedAt: null },
      { id: "strong-csv-b", title: "Full Body B", startedLocal: "2026-11-02T19:18", strongSlug: null, source: "strong-csv", deletedAt: null },
    ];
    const res = await share(FULL_BODY_B);
    expect(res.res).toMatchObject({ status: "created", workoutId: "strong-caterxeu" });
    const warning = { line: 0, message: "2 workouts already start at that minute, so this was logged as a new one", text: "strong-csv-a, strong-csv-b" };
    expect(res.res.warnings).toContainEqual(warning);
    expect(res.plan.ingest.warnings).toContainEqual(warning);
    expect(res.res.details.split("\n").at(-1)).toBe(warning.message);
  });

  it("revives a deleted workout as logged, not updated", async () => {
    workoutRows = [
      { id: "strong-caterxeu", title: "Full Body B", startedLocal: "2026-11-02T19:18", strongSlug: "caterxeu", source: "strong-text", deletedAt: new Date() },
    ];
    const res = await share(FULL_BODY_B);
    expect(res.res).toMatchObject({ status: "created", workoutId: "strong-caterxeu" });
  });
});
