import { describe, it, expect } from "vitest";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import type {
  BodyweightPayload,
  CustomExercisePayload,
  ProgramPayload,
  SetPayload,
  SyncEntity,
  SyncOp,
  TemplateExercisePayload,
  TemplateFolderPayload,
  TemplatePayload,
  WorkoutExercisePayload,
  WorkoutPayload,
} from "lift-core";
import * as schema from "@/lib/db/schema";
import {
  collectRefs,
  planSync,
  programRow,
  setRow,
  startedLocalFor,
  workoutRow,
  type PreparedMutation,
  type SyncState,
} from "@/lib/lift/sync/plan";
import { validateMutation } from "@/lib/lift/sync/validate";

// a real drizzle instance over an unreachable url: builders render real sql
// via toSQL() and nothing is ever executed
const db = drizzle(neon("postgresql://user:pass@127.0.0.1:1/none"), { schema });
type Sqlable = { toSQL(): { sql: string; params: unknown[] } };
const render = (qs: unknown[]) => qs.map((q) => (q as Sqlable).toSQL());

const T0 = Date.UTC(2026, 10, 4, 2, 12); // 2026-11-04 18:12 pst
const ts = { createdAt: T0, updatedAt: T0 + 1000 };

const workout = (over: Partial<WorkoutPayload> = {}): WorkoutPayload => ({
  id: "w1",
  title: "Push Day",
  startedAt: T0,
  endedAt: T0 + 3600_000,
  utcOffsetMin: -480,
  status: "finished",
  templateId: null,
  notes: null,
  ...ts,
  ...over,
});
const we = (over: Partial<WorkoutExercisePayload> = {}): WorkoutExercisePayload => ({
  id: "we1",
  workoutId: "w1",
  exerciseId: "bench-press-barbell",
  position: 0,
  notes: null,
  supersetGroup: null,
  restS: 90,
  ...ts,
  ...over,
});
const set = (over: Partial<SetPayload> = {}): SetPayload => ({
  id: "s1",
  workoutExerciseId: "we1",
  position: 0,
  kind: "normal",
  weight: 225,
  unit: "lb",
  reps: 5,
  durationS: null,
  distanceM: null,
  rpe: null,
  completed: 1,
  note: null,
  ...ts,
  ...over,
});
const custom = (over: Partial<CustomExercisePayload> = {}): CustomExercisePayload => ({
  id: "custom-aaaaaaaaaaaa",
  name: "Landmine Press",
  equipment: "barbell",
  tracking: "weight_reps",
  primary: '["front_delts"]',
  secondary: '["triceps","front_delts"]',
  archived: 0,
  mergedInto: null,
  ...ts,
  ...over,
});
const folder = (over: Partial<TemplateFolderPayload> = {}): TemplateFolderPayload => ({
  id: "f1",
  name: "PPL",
  position: 0,
  ...ts,
  ...over,
});
const template = (over: Partial<TemplatePayload> = {}): TemplatePayload => ({
  id: "t1",
  folderId: "f1",
  name: "Push",
  notes: null,
  position: 0,
  archived: 0,
  ...ts,
  ...over,
});
const templateExercise = (over: Partial<TemplateExercisePayload> = {}): TemplateExercisePayload => ({
  id: "te1",
  templateId: "t1",
  exerciseId: "bench-press-barbell",
  position: 0,
  supersetGroup: 1,
  restS: 120,
  plannedSets: '[{"kind":"normal","weight":185,"unit":"lb","reps":5,"durationS":null,"distanceM":null}]',
  notes: null,
  ...ts,
  ...over,
});
const bodyweight = (over: Partial<BodyweightPayload> = {}): BodyweightPayload => ({
  id: "bw1",
  measuredAt: T0,
  weight: 180.5,
  unit: "lb",
  note: null,
  ...ts,
  ...over,
});

let seq = 0;
function mut(entity: SyncEntity, op: SyncOp, payload: { id: string } | null, id = payload?.id ?? "x"): PreparedMutation {
  seq++;
  const raw = { seq, entity, op, id, payload, at: T0 };
  return { seq, raw, result: validateMutation(raw) };
}

function emptyState(over: Partial<SyncState> = {}): SyncState {
  return {
    seenSeqs: new Set(),
    workouts: new Set(),
    workoutExercises: new Map(),
    sets: new Map(),
    templates: new Set(),
    folders: new Set(),
    exercises: new Map(),
    ...over,
  };
}

const plan = (muts: PreparedMutation[], state = emptyState()) =>
  planSync(db, "device-abc123", muts, state, { timezone: "America/Los_Angeles" });

describe("payload mapping", () => {
  it("derives the wall clock from the device offset, else LIFT_TIMEZONE", () => {
    expect(startedLocalFor(T0, -480)).toBe("2026-11-03T18:12");
    expect(startedLocalFor(T0, 60)).toBe("2026-11-04T03:12");
    expect(startedLocalFor(T0, null, "America/New_York")).toBe("2026-11-03T21:12");
  });

  it("maps a workout: duration from endedAt, discarded soft-deletes", () => {
    const row = workoutRow(workout());
    expect(row).toMatchObject({
      id: "w1",
      source: "app",
      status: "finished",
      startedAt: new Date(T0),
      durationS: 3600,
      deletedAt: null,
      updatedAt: new Date(T0 + 1000),
    });
    expect(workoutRow(workout({ status: "discarded" })).deletedAt).toEqual(new Date(T0 + 1000));
    expect(workoutRow(workout({ endedAt: null, status: "active" }))).toMatchObject({ endedAt: null, durationS: null });
    expect(workoutRow(workout({ title: "  " })).title).toBe("workout");
  });

  it("maps a set: kg, e1rm only for completed absolute working sets", () => {
    const row = setRow(set(), false);
    expect(row.weightKg).toBeCloseTo(102.058, 3);
    expect(row.e1rmKg).toBeCloseTo(119.07, 2);
    expect(row.completed).toBe(true);
    expect(setRow(set({ completed: 0 }), false)).toMatchObject({ completed: false, e1rmKg: null });
    expect(setRow(set({ kind: "warmup" }), false).e1rmKg).toBeNull();
    expect(setRow(set(), true)).toMatchObject({ bodyweight: true, e1rmKg: null });
    expect(setRow(set({ weight: 100, unit: "kg" }), false).weightKg).toBe(100);
  });
});

describe("collectRefs", () => {
  it("asks for parents, non-catalog exercises and delete targets", () => {
    const refs = collectRefs([
      mut("workout_exercise", "insert", we({ exerciseId: "custom-bbbbbbbbbbbb" })),
      mut("set", "insert", set({ workoutExerciseId: "we9" })),
      mut("set", "delete", null, "s7"),
      mut("workout_exercise", "delete", null, "we8"),
      mut("template", "insert", template({ folderId: "f2" })),
      mut("template_exercise", "insert", templateExercise({ templateId: "t2" })),
      mut("custom_exercise", "update", custom({ mergedInto: "custom-cccccccccccc" })),
    ]);
    expect(refs.workoutIds).toEqual(["w1"]);
    expect(refs.workoutExerciseIds.sort()).toEqual(["we1", "we8", "we9"]);
    expect(refs.setIds).toEqual(["s7"]);
    expect(refs.folderIds).toEqual(["f2"]);
    expect(refs.templateIds).toEqual(["t2"]);
    // catalog slugs never need a lookup
    expect(refs.exerciseIds.sort()).toEqual(["custom-bbbbbbbbbbbb", "custom-cccccccccccc"]);
    expect(refs.seqs).toHaveLength(7);
  });
});

describe("planSync", () => {
  it("upserts a workout tree in seq order, last-write-wins, and logs every seq", () => {
    const muts = [
      mut("workout", "insert", workout()),
      mut("workout_exercise", "insert", we()),
      mut("set", "insert", set()),
    ];
    const p = plan(muts);
    expect(p).toMatchObject({ applied: 3, skipped: 0, rejected: [], appliedThrough: muts[2].seq });
    expect(p.touchedWorkoutIds).toEqual(["w1"]);
    const sqls = render(p.statements).map((s) => s.sql);
    // catalog rows first, then the mutations, then the log
    expect(sqls[0]).toMatch(/^insert into "exercises" .* on conflict do nothing$/);
    expect(sqls[1]).toMatch(/^insert into "exercise_aliases"/);
    expect(sqls[2]).toMatch(/^insert into "exercise_muscles"/);
    expect(sqls[3]).toMatch(/^insert into "lift_workouts" .* on conflict \("id"\) do update set /);
    expect(sqls[3]).toMatch(/ where "lift_workouts"."updated_at" <= excluded."updated_at"$/);
    expect(sqls[3]).toContain('"status" = excluded."status"');
    expect(sqls[3]).toContain('"deleted_at" = excluded."deleted_at"');
    for (const kept of ["source", "created_at", "working_sets", "volume_kg", "muscle_load", "share_slug", "latest_ingest_id"]) {
      expect(sqls[3]).not.toContain(`"${kept}" = `);
    }
    expect(sqls[4]).toMatch(/^insert into "lift_workout_exercises" .* where "lift_workout_exercises"."updated_at" <= excluded."updated_at"$/);
    expect(sqls[4]).toContain(
      `"name_raw" = case when "lift_workout_exercises"."exercise_id" = excluded."exercise_id" then "lift_workout_exercises"."name_raw" else excluded."name_raw" end`
    );
    expect(sqls[5]).toMatch(/^insert into "lift_sets" .* where "lift_sets"."updated_at" <= excluded."updated_at"$/);
    // a seq logged as rejected gets its new outcome; an applied one is never rewritten
    expect(sqls[6]).toMatch(/^insert into "lift_sync_log" .* on conflict \("device_id","seq"\) do update set .* where "lift_sync_log"."rejected" is not null$/);
    expect(sqls[6]).toContain('"rejected" = excluded."rejected"');
    expect(sqls).toHaveLength(7);
    // the catalog name becomes nameRaw
    expect(render([p.statements[4]])[0].params).toContain("Bench Press (Barbell)");
    // lift code never writes activities
    expect(sqls.join("\n")).not.toMatch(/"activities"/);
  });

  it("skips seqs the device already pushed", () => {
    const muts = [mut("bodyweight", "insert", bodyweight()), mut("bodyweight", "insert", bodyweight({ id: "bw2" }))];
    const p = plan(muts, emptyState({ seenSeqs: new Set([muts[0].seq]) }));
    expect(p).toMatchObject({ applied: 1, skipped: 1, appliedThrough: muts[1].seq });
    const sqls = render(p.statements);
    expect(sqls).toHaveLength(2);
    expect(sqls[0].params).toContain("bw2");
    expect(sqls[0].params).not.toContain("bw1");
    // only the new seq is logged
    expect(sqls[1].params).toEqual(["device-abc123", muts[1].seq, "bodyweight", "bw2", "insert", null]);
  });

  it("re-evaluates a previously rejected seq (left out of seenSeqs) and rewrites its log row", () => {
    // an m1-era insert an older server refused ("payload.utcOffsetMin is missing"), resent after the fix
    const m1: Partial<WorkoutPayload> = workout();
    delete m1.utcOffsetMin;
    delete m1.templateId;
    const retried = mut("workout", "insert", m1 as WorkoutPayload);
    const child = mut("workout_exercise", "insert", we());
    const p = plan([retried, child]);
    expect(p).toMatchObject({ applied: 2, skipped: 0, rejected: [] });
    const log = render(p.statements).at(-1)!;
    expect(log.sql).toMatch(/^insert into "lift_sync_log"/);
    expect(log.sql).toContain("do update set");
    expect(log.params).toEqual(expect.arrayContaining([retried.seq, child.seq]));
  });

  it("recomputes aggregates for workouts a replay touches, so a retry heals a failed recompute", () => {
    const muts = [mut("set", "update", set()), mut("workout", "update", workout({ id: "w2" })), mut("set", "delete", null, "s9")];
    const p = plan(
      muts,
      emptyState({
        seenSeqs: new Set(muts.map((m) => m.seq)),
        workouts: new Set(["w1", "w2", "w3"]),
        workoutExercises: new Map([["we1", { workoutId: "w1", exerciseId: "bench-press-barbell", tracking: "weight_reps" }]]),
        sets: new Map([["s9", "w3"]]),
      })
    );
    expect(p).toMatchObject({ applied: 0, skipped: 3, statements: [] });
    expect(p.touchedWorkoutIds.sort()).toEqual(["w1", "w2", "w3"]);
    // a replay of a workout that's gone touches nothing
    const gone = mut("workout", "update", workout({ id: "w404" }));
    expect(plan([gone], emptyState({ seenSeqs: new Set([gone.seq]) })).touchedWorkoutIds).toEqual([]);
  });

  it("refuses new exercises and sets in imported workouts, but accepts edits of existing rows", () => {
    const sw = "share-Slug1";
    const state = emptyState({
      workouts: new Set([sw]),
      workoutExercises: new Map([[`${sw}:0`, { workoutId: sw, exerciseId: "bench-press-barbell", tracking: "weight_reps" }]]),
      sets: new Map([[`${sw}:0:0`, sw]]),
    });
    const newWe = mut("workout_exercise", "insert", we({ id: "we-new", workoutId: sw }));
    const newSet = mut("set", "insert", set({ id: "s-new", workoutExerciseId: `${sw}:0` }));
    const editWe = mut("workout_exercise", "update", we({ id: `${sw}:0`, workoutId: sw, restS: 60 }));
    const editSet = mut("set", "update", set({ id: `${sw}:0:0`, workoutExerciseId: `${sw}:0`, reps: 6 }));
    const discard = mut("workout", "update", workout({ id: sw, status: "discarded" }));
    const p = plan([newWe, newSet, editWe, editSet, discard], state);
    expect(p.rejected).toEqual([
      { seq: newWe.seq, reason: `workout ${sw} is an imported workout: exercises can't be added to it` },
      { seq: newSet.seq, reason: `workout ${sw} is an imported workout: sets can't be added to it` },
    ]);
    expect(p.applied).toBe(3);
    // the phone's status drives the soft delete of an imported workout too; source stays server-owned
    const w = render(p.statements).find((s) => s.sql.startsWith('insert into "lift_workouts"'))!;
    expect(w.sql).toContain('"deleted_at" = excluded."deleted_at"');
    expect(w.sql).not.toContain('"source" = ');
    expect(workoutRow(workout({ id: sw, status: "discarded" })).deletedAt).toBeInstanceOf(Date);
    expect(workoutRow(workout({ id: sw, status: "finished" })).deletedAt).toBeNull();
    // app workouts are unaffected
    expect(plan([mut("set", "insert", set())], emptyState({ workoutExercises: new Map([["we1", { workoutId: "w1", exerciseId: "bench-press-barbell", tracking: "weight_reps" }]]) })).rejected).toEqual([]);
  });

  it("after a merge in the same batch, later sets use the merge target's tracking", () => {
    const cid = "custom-aaaaaaaaaaaa";
    const state = emptyState({
      workouts: new Set(["w1"]),
      workoutExercises: new Map([["we1", { workoutId: "w1", exerciseId: cid, tracking: "weight_reps" }]]),
      exercises: new Map([[cid, { name: "Ring Dip", tracking: "weight_reps" }]]),
    });
    const p = plan([mut("custom_exercise", "update", custom({ mergedInto: "pull-up" })), mut("set", "update", set({ weight: 25 }))], state);
    expect(p.rejected).toEqual([]);
    const s = render(p.statements).find((x) => x.sql.startsWith('insert into "lift_sets"'))!;
    // pull-up is bodyweight-relative: flagged, and no e1rm
    expect(s.params).toContain(true);
    expect(s.params).not.toContain(false);
  });

  it("rejects bad or orphaned mutations without failing the rest, and logs the reason", () => {
    const bad = mut("set", "insert", { ...set(), reps: "five" } as unknown as SetPayload);
    const orphan = mut("set", "insert", set({ workoutExerciseId: "nope" }));
    const noWorkout = mut("workout_exercise", "insert", we({ workoutId: "w404" }));
    const unknownExercise = mut("workout_exercise", "insert", we({ id: "we2", exerciseId: "not-a-thing" }));
    const ok = mut("bodyweight", "insert", bodyweight());
    const p = plan([bad, orphan, noWorkout, unknownExercise, ok], emptyState({ workouts: new Set(["w1"]) }));
    expect(p.applied).toBe(1);
    expect(p.rejected).toEqual([
      { seq: bad.seq, reason: "payload.reps must be an integer" },
      { seq: orphan.seq, reason: "workout exercise nope not found" },
      { seq: noWorkout.seq, reason: "workout w404 not found" },
      { seq: unknownExercise.seq, reason: "exercise not-a-thing not found" },
    ]);
    expect(p.appliedThrough).toBe(ok.seq);
    const sqls = render(p.statements);
    expect(sqls.map((s) => s.sql.split(" ").slice(0, 3).join(" "))).toEqual([
      'insert into "lift_bodyweights"',
      'insert into "lift_sync_log"',
    ]);
    expect(sqls[1].params).toContain("workout w404 not found");
  });

  it("accepts children whose parents exist in the db or earlier in the batch", () => {
    const p = plan(
      [mut("workout_exercise", "insert", we({ id: "we2", exerciseId: "custom-aaaaaaaaaaaa" })), mut("set", "insert", set({ workoutExerciseId: "we2" }))],
      emptyState({ workouts: new Set(["w1"]), exercises: new Map([["custom-aaaaaaaaaaaa", { name: "Landmine Press", tracking: "weight_reps" }]]) })
    );
    expect(p.rejected).toEqual([]);
    // a custom exercise needs no catalog insert
    expect(render(p.statements)[0].sql).toMatch(/^insert into "lift_workout_exercises"/);
    expect(render(p.statements)[0].params).toContain("Landmine Press");
  });

  it("flags sets of bodyweight exercises so they never get an e1rm", () => {
    const p = plan(
      [mut("set", "insert", set({ weight: 25 }))],
      emptyState({ workoutExercises: new Map([["we1", { workoutId: "w1", exerciseId: "pull-up", tracking: "weighted_bodyweight" }]]) })
    );
    const params = render(p.statements)[0].params;
    expect(params).toContain(true); // bodyweight
    expect(p.touchedWorkoutIds).toEqual(["w1"]);
  });

  it("forgets cascaded children after a parent delete", () => {
    const p = plan(
      [mut("workout", "delete", null, "w1"), mut("set", "insert", set())],
      emptyState({ workouts: new Set(["w1"]), workoutExercises: new Map([["we1", { workoutId: "w1", exerciseId: "bench-press-barbell", tracking: null }]]) })
    );
    expect(p.rejected).toEqual([{ seq: seq, reason: "workout exercise we1 not found" }]);
    expect(render(p.statements)[0].sql).toBe('delete from "lift_workouts" where "lift_workouts"."id" = $1');
    expect(p.touchedWorkoutIds).toEqual([]);
  });

  it("deletes by id, touching the parent workout for set/exercise deletes", () => {
    const p = plan(
      [
        mut("set", "delete", null, "s1"),
        mut("workout_exercise", "delete", null, "we5"),
        mut("template_folder", "delete", null, "f1"),
        mut("template", "delete", null, "t1"),
        mut("template_exercise", "delete", null, "te1"),
        mut("bodyweight", "delete", null, "bw1"),
      ],
      emptyState({
        sets: new Map([["s1", "w1"]]),
        workoutExercises: new Map([["we5", { workoutId: "w2", exerciseId: "x", tracking: null }]]),
      })
    );
    expect(p.applied).toBe(6);
    expect(p.touchedWorkoutIds.sort()).toEqual(["w1", "w2"]);
    const sqls = render(p.statements).map((s) => s.sql);
    expect(sqls.slice(0, 6)).toEqual([
      'delete from "lift_sets" where "lift_sets"."id" = $1',
      'delete from "lift_workout_exercises" where "lift_workout_exercises"."id" = $1',
      'delete from "lift_template_folders" where "lift_template_folders"."id" = $1',
      'delete from "lift_templates" where "lift_templates"."id" = $1',
      'delete from "lift_template_exercises" where "lift_template_exercises"."id" = $1',
      'delete from "lift_bodyweights" where "lift_bodyweights"."id" = $1',
    ]);
  });

  it("upserts a custom exercise, replacing its muscles only when the push won", () => {
    const p = plan([mut("custom_exercise", "insert", custom())]);
    const [upsert, del, ins] = render(p.statements);
    expect(upsert.sql).toMatch(/^insert into "exercises" .* on conflict \("id"\) do update set /);
    expect(upsert.sql).toMatch(/ where \("exercises"."updated_at" <= excluded."updated_at" and "exercises"."source" <> 'catalog'\)$/);
    expect(upsert.sql).not.toContain('"source" = ');
    expect(upsert.params).toEqual(expect.arrayContaining(["custom-aaaaaaaaaaaa", "Landmine Press", "app", true]));
    expect(del.sql).toMatch(/^delete from "exercise_muscles" where \("exercise_muscles"."exercise_id" = \$1 and exists \(select 1 from "exercises" e where e."id" = \$2 and e."updated_at" = \$3::timestamptz\)\)$/);
    expect(del.params[2]).toBe(new Date(T0 + 1000).toISOString());
    expect(ins.sql).toMatch(/^insert into "exercise_muscles" \("exercise_id", "region", "role"\) select v.exercise_id, v.region, v.role from \(values \(\$1, \$2, \$3\), \(\$4, \$5, \$6\)\) as v/);
    expect(ins.sql).toMatch(/on conflict do nothing$/);
    // a region listed both ways is primary only
    expect(ins.params.slice(0, 6)).toEqual(["custom-aaaaaaaaaaaa", "front_delts", "primary", "custom-aaaaaaaaaaaa", "triceps", "secondary"]);
  });

  it("refuses custom pushes onto catalog ids", () => {
    const p = plan([mut("custom_exercise", "update", custom({ id: "bench-press-barbell" })), mut("custom_exercise", "delete", null, "pull-up")]);
    expect(p.rejected.map((r) => r.reason)).toEqual(["bench-press-barbell is a catalog exercise", "pull-up is a catalog exercise"]);
  });

  it("re-points history on merge, guarded on the merge having landed", () => {
    const p = plan([mut("custom_exercise", "update", custom({ mergedInto: "bench-press-barbell" }))]);
    expect(p.mergeTargetIds).toEqual(["bench-press-barbell"]);
    const sqls = render(p.statements);
    // the catalog target is ensured first
    expect(sqls[0].sql).toMatch(/^insert into "exercises"/);
    expect(sqls[0].params).toContain("bench-press-barbell");
    const repoints = sqls.filter((s) => s.sql.startsWith("update"));
    expect(repoints.map((s) => s.sql)).toEqual([
      'update "lift_workout_exercises" set "exercise_id" = $1 where ("lift_workout_exercises"."exercise_id" = $2 and exists (select 1 from "exercises" e where e."id" = $3 and e."merged_into" = $4))',
      'update "lift_template_exercises" set "exercise_id" = $1 where ("lift_template_exercises"."exercise_id" = $2 and exists (select 1 from "exercises" e where e."id" = $3 and e."merged_into" = $4))',
    ]);
    expect(repoints[0].params).toEqual(["bench-press-barbell", "custom-aaaaaaaaaaaa", "custom-aaaaaaaaaaaa", "bench-press-barbell"]);
  });

  it("rejects a merge into an unknown exercise", () => {
    const p = plan([mut("custom_exercise", "update", custom({ mergedInto: "custom-ffffffffffff" }))]);
    expect(p.rejected[0].reason).toBe("merge target custom-ffffffffffff not found");
  });

  it("archives a custom exercise on delete and only drops it when nothing references it", () => {
    const p = plan([mut("custom_exercise", "delete", null, "custom-aaaaaaaaaaaa")]);
    const [archiveQ, delQ] = render(p.statements);
    const [archive, del] = [archiveQ.sql, delQ.sql];
    // stamped with the mutation's own time (phone clock), and only over an older row
    expect(archive).toMatch(
      /^update "exercises" set "archived" = \$1, "updated_at" = \$2 where \("exercises"."id" = \$3 and "exercises"."is_custom" = \$4 and "exercises"."updated_at" <= \$5\)$/
    );
    expect(archive).not.toContain("now()");
    expect(archiveQ.params[1]).toBe(new Date(T0).toISOString());
    expect(del).toMatch(/^delete from "exercises" where \("exercises"."id" = \$1 and "exercises"."is_custom" = \$2 and not exists \(select 1 from "lift_workout_exercises" x/);
    expect(del).toContain('not exists (select 1 from "lift_template_exercises" x');
  });

  it("maps templates: folder must exist, planned sets become jsonb, legacy folder untouched", () => {
    const p = plan([
      mut("template_folder", "insert", folder()),
      mut("template", "insert", template()),
      mut("template_exercise", "insert", templateExercise()),
      mut("template", "insert", template({ id: "t9", folderId: "f404" })),
      mut("template_exercise", "insert", templateExercise({ id: "te9", templateId: "t404" })),
    ]);
    expect(p.rejected.map((r) => r.reason)).toEqual(["folder f404 not found", "template t404 not found"]);
    const sqls = render(p.statements);
    const byTable = (t: string) => sqls.find((s) => s.sql.startsWith(`insert into "${t}"`))!;
    expect(byTable("lift_template_folders").sql).toMatch(/where "lift_template_folders"."updated_at" <= excluded."updated_at"$/);
    const tp = byTable("lift_templates");
    expect(tp.sql).toContain('"folder_id" = excluded."folder_id"');
    expect(tp.sql).not.toContain('"folder" = ');
    expect(tp.sql).toMatch(/where "lift_templates"."updated_at" <= excluded."updated_at"$/);
    const te = byTable("lift_template_exercises");
    expect(te.sql).toMatch(/where "lift_template_exercises"."updated_at" <= excluded."updated_at"$/);
    expect(te.params).toContain(JSON.stringify([{ kind: "normal", weight: 185, unit: "lb", reps: 5, durationS: null, distanceM: null }]));
  });

  it("upserts bodyweights last-write-wins", () => {
    const [bw] = render(plan([mut("bodyweight", "insert", bodyweight())]).statements);
    expect(bw.sql).toMatch(/^insert into "lift_bodyweights" .* where "lift_bodyweights"."updated_at" <= excluded."updated_at"$/);
    expect(bw.params).toContain(180.5);
  });

  it("is empty for an empty push", () => {
    expect(plan([])).toMatchObject({ statements: [], applied: 0, appliedThrough: 0 });
  });
});

describe("programs", () => {
  const data =
    '{"version":1,"weeks":[{"days":[{"templateId":"t1"},{"templateId":null}]}],"rules":{"te1":{"kind":"linear","sets":5,"reps":5}},"startedAt":null,"skipped":0,"repeat":false}';
  const program = (over: Partial<ProgramPayload> = {}): ProgramPayload => ({ id: "p1", name: " 5x5 ", data, active: 1, ...ts, ...over });

  it("maps the payload: trimmed name, parsed jsonb, boolean active", () => {
    expect(programRow(program())).toEqual({
      id: "p1",
      name: "5x5",
      data: JSON.parse(data),
      active: true,
      createdAt: new Date(ts.createdAt),
      updatedAt: new Date(ts.updatedAt),
    });
  });

  it("upserts last-write-wins without needing the templates it names", () => {
    const p = plan([mut("program", "insert", program())]);
    expect(p).toMatchObject({ applied: 1, rejected: [] });
    const sqls = render(p.statements).map((s) => s.sql);
    expect(sqls[0]).toMatch(
      /^insert into "lift_programs" .* on conflict \("id"\) do update set .* where "lift_programs"."updated_at" <= excluded."updated_at"$/
    );
    expect(sqls[0]).toContain('"data" = excluded."data"');
    expect(sqls[0]).toContain('"active" = excluded."active"');
    expect(sqls[0]).not.toContain('"created_at" = ');
    expect(sqls[1]).toMatch(/^insert into "lift_sync_log"/);
    expect(sqls).toHaveLength(2);
    expect(p.touchedWorkoutIds).toEqual([]);
  });

  it("deletes by id", () => {
    const p = plan([mut("program", "delete", null, "p1")]);
    const [del] = render(p.statements);
    expect(del.sql).toBe('delete from "lift_programs" where "lift_programs"."id" = $1');
    expect(del.params).toEqual(["p1"]);
  });

  it("collects no refs", () => {
    expect(collectRefs([mut("program", "insert", program())])).toMatchObject({ templateIds: [], workoutIds: [], exerciseIds: [] });
  });
});
