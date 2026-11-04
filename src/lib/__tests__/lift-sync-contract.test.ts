/// <reference types="node" />
// cross-contract test: phone outbox rows (as the phone repositories write them)
// -> phone push mapper -> wire json -> server validator + planner. and the
// reverse: server snapshot mappers -> phone restore planner -> phone sqlite ddl.
// nothing here talks to a database; the planner only builds queries.

import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { getTableColumns } from "drizzle-orm";
import { getTableConfig, type SQLiteTable } from "drizzle-orm/sqlite-core";
import { customExerciseId, getExercise, type SyncEntity, type SyncMutation } from "lift-core";
import * as serverSchema from "@/lib/db/schema";
import type {
  ExerciseRow,
  LiftSetRow,
  LiftWorkoutExerciseRow,
  LiftWorkoutRow,
} from "@/lib/db/lift-schema";
import { collectRefs, planSync, workoutRow, type PreparedMutation, type SyncState } from "@/lib/lift/sync/plan";
import { buildSnapshot, parseSnapshotQuery, snapshotPage } from "@/lib/lift/sync/snapshot";
import { validateEnvelope, validateMutation } from "@/lib/lift/sync/validate";
import { buildPushRequest, type OutboxLike } from "../../../apps/lift/src/lib/sync/mutations";
import { fetchSnapshot, parseSnapshot, restorePlan } from "../../../apps/lift/src/lib/sync/snapshot";
import { MIGRATIONS } from "../../../apps/lift/src/db/migrations";
import * as phone from "../../../apps/lift/src/db/schema";

const db = drizzle(neon("postgresql://user:pass@127.0.0.1:1/none"), { schema: serverSchema });
const TZ = "America/Los_Angeles";
const T0 = Date.UTC(2026, 10, 4, 2, 12); // 2026-11-03 18:12 pst
const BENCH = "bench-press-barbell";
const DEVICE = "0b6f7f0e-5a43-4c55-9d7b-3f1f7e9a1c22";

// ---------------------------------------------------------------------------
// phone side: rows exactly as drizzle .returning() hands them to writeOutbox

type Row = Record<string, unknown>;

/** every column of the drizzle table: given value, else the column default, else null */
function drizzleRow(table: SQLiteTable, values: Row, omit: readonly string[] = []): Row {
  const out: Row = {};
  for (const [key, col] of Object.entries(getTableColumns(table))) {
    if (omit.includes(key)) continue;
    const c = col as { default?: unknown; hasDefault?: boolean };
    out[key] = key in values ? values[key] : c.hasDefault ? c.default : null;
  }
  return out;
}

// columns the m1 schema (75b33ee) did not have; m1 outbox payloads lack these keys
const M1_OMIT: Partial<Record<SyncEntity, string[]>> = {
  workout: ["utcOffsetMin", "templateId"],
  workout_exercise: ["restS"],
  custom_exercise: ["mergedInto"],
};

const TABLE: Record<SyncEntity, SQLiteTable> = {
  workout: phone.workouts,
  workout_exercise: phone.workoutExercises,
  set: phone.sets,
  custom_exercise: phone.customExercises,
  template_folder: phone.templateFolders,
  template: phone.templates,
  template_exercise: phone.templateExercises,
  bodyweight: phone.bodyweights,
};

class Outbox {
  rows: OutboxLike[] = [];
  private seq = 0;
  /** mirrors writeOutbox: payload is the full row (or {id} for deletes) */
  write(entity: SyncEntity, op: "insert" | "update" | "delete", values: Row, opts: { m1?: boolean; at?: number } = {}): Row {
    const row = op === "delete" ? { id: values.id } : drizzleRow(TABLE[entity], values, opts.m1 ? M1_OMIT[entity] : []);
    this.rows.push({
      id: ++this.seq,
      entity,
      entityId: String(values.id),
      op,
      payload: JSON.stringify(row),
      createdAt: opts.at ?? T0 + this.seq,
    });
    return row;
  }
}

// ---------------------------------------------------------------------------
// server side: a tiny fake of what loadSyncState would read back, so a stream
// can be pushed in several batches like the phone does

class FakeServer {
  seen = new Set<number>();
  workouts = new Set<string>();
  wes = new Map<string, { workoutId: string; exerciseId: string; tracking: string | null }>();
  sets = new Map<string, string>();
  templates = new Set<string>();
  folders = new Set<string>();
  exercises = new Map<string, { name: string; tracking: string }>();

  state(): SyncState {
    return {
      seenSeqs: this.seen,
      workouts: this.workouts,
      workoutExercises: this.wes,
      sets: this.sets,
      templates: this.templates,
      folders: this.folders,
      exercises: this.exercises,
    };
  }

  /** what the batch would leave in the db (accepted mutations only) */
  absorb(prepared: PreparedMutation[], rejectedSeqs: Set<number>) {
    for (const p of prepared) {
      this.seen.add(p.seq);
      if (!p.result.ok || rejectedSeqs.has(p.seq)) continue;
      const m = p.result.mutation;
      const pl = m.payload as Row | null;
      if (m.op === "delete") {
        if (m.entity === "workout") this.workouts.delete(m.id);
        if (m.entity === "workout_exercise") this.wes.delete(m.id);
        if (m.entity === "set") this.sets.delete(m.id);
        if (m.entity === "template") this.templates.delete(m.id);
        if (m.entity === "template_folder") this.folders.delete(m.id);
        continue;
      }
      switch (m.entity) {
        case "workout":
          this.workouts.add(m.id);
          break;
        case "workout_exercise": {
          const exId = pl!.exerciseId as string;
          this.wes.set(m.id, {
            workoutId: pl!.workoutId as string,
            exerciseId: exId,
            tracking: getExercise(exId)?.tracking ?? this.exercises.get(exId)?.tracking ?? null,
          });
          break;
        }
        case "set":
          this.sets.set(m.id, this.wes.get(pl!.workoutExerciseId as string)!.workoutId);
          break;
        case "custom_exercise":
          this.exercises.set(m.id, { name: pl!.name as string, tracking: pl!.tracking as string });
          break;
        case "template":
          this.templates.add(m.id);
          break;
        case "template_folder":
          this.folders.add(m.id);
          break;
      }
    }
  }
}

interface PushOutcome {
  rejected: { seq: number; reason: string; entity: string; op: string }[];
  appliedThrough: number;
  statements: number;
}

/** phone pushAll's batching -> wire -> route's envelope check -> push.ts's prepare/plan */
function push(outbox: Outbox, server = new FakeServer(), batchSize = 500): PushOutcome {
  const rejected: PushOutcome["rejected"] = [];
  let appliedThrough = 0;
  let statements = 0;
  for (let i = 0; i < outbox.rows.length; i += batchSize) {
    const rows = outbox.rows.slice(i, i + batchSize);
    const wire = JSON.parse(JSON.stringify(buildPushRequest(DEVICE, rows)));
    const env = validateEnvelope(wire);
    if (!env.ok) throw new Error(`envelope rejected: ${env.error}`);
    const prepared: PreparedMutation[] = env.mutations.map((m) => ({ seq: m.seq, raw: m.raw, result: validateMutation(m.raw) }));
    collectRefs(prepared); // must not throw on any realistic payload
    const plan = planSync(db, DEVICE, prepared, server.state(), { timezone: TZ });
    // every statement must render (a builder that throws here would 500 the whole push)
    for (const s of plan.statements) (s as unknown as { toSQL(): unknown }).toSQL();
    statements += plan.statements.length;
    appliedThrough = plan.appliedThrough;
    const byseq = new Map(prepared.map((p) => [p.seq, p.raw]));
    for (const r of plan.rejected) {
      const raw = byseq.get(r.seq)!;
      rejected.push({ ...r, entity: String(raw.entity), op: String(raw.op) });
    }
    server.absorb(prepared, new Set(plan.rejected.map((r) => r.seq)));
  }
  return { rejected, appliedThrough, statements };
}

// ---------------------------------------------------------------------------
// realistic v2 session, following the repository code paths

function v2Session(o: Outbox) {
  let t = T0;
  const tick = () => (t += 1000);
  const off = -480;

  // created before a token was configured: still sits first in the outbox
  const landmine = customExerciseId("Landmine Press");
  o.write("custom_exercise", "insert", {
    id: landmine,
    name: "Landmine Press",
    equipment: "barbell",
    tracking: "weight_reps",
    primary: JSON.stringify(["front_delts"]),
    secondary: JSON.stringify(["triceps"]),
    archived: 0,
    mergedInto: null,
    createdAt: tick(),
    updatedAt: t,
  });
  const dip = customExerciseId("Ring Dip");
  o.write("custom_exercise", "insert", {
    id: dip,
    name: "Ring Dip",
    equipment: "bodyweight",
    tracking: "weighted_bodyweight",
    primary: "[]",
    secondary: "[]",
    archived: 0,
    mergedInto: null,
    createdAt: tick(),
    updatedAt: t,
  });

  // templates.ts: createFolder, createTemplate + addTemplateExercise
  o.write("template_folder", "insert", { id: "f1", name: "PPL", position: 0, createdAt: tick(), updatedAt: t });
  o.write("template", "insert", { id: "t1", folderId: "f1", name: "Push", notes: null, position: 0, archived: 0, createdAt: tick(), updatedAt: t });
  const planned = JSON.stringify([
    { kind: "warmup", weight: 95, unit: "lb", reps: 8, durationS: null, distanceM: null },
    { kind: "normal", weight: 185, unit: "lb", reps: 5, durationS: null, distanceM: null },
  ]);
  o.write("template_exercise", "insert", {
    id: "te1", templateId: "t1", exerciseId: BENCH, position: 0, supersetGroup: null, restS: 120, plannedSets: planned, notes: null, createdAt: tick(), updatedAt: t,
  });
  o.write("template_exercise", "insert", {
    id: "te2", templateId: "t1", exerciseId: landmine, position: 1, supersetGroup: 1, restS: null, plannedSets: "[]", notes: "slow", createdAt: tick(), updatedAt: t,
  });

  // startWorkoutFromTemplate
  const ws = tick();
  o.write("workout", "insert", { id: "w1", title: "Push", startedAt: ws, utcOffsetMin: off, templateId: "t1", status: "active", notes: null, createdAt: ws, updatedAt: ws });
  o.write("workout_exercise", "insert", { id: "we1", workoutId: "w1", exerciseId: BENCH, position: 0, notes: null, supersetGroup: null, restS: 120, createdAt: ws, updatedAt: ws });
  o.write("set", "insert", { id: "s1", workoutExerciseId: "we1", position: 0, kind: "warmup", weight: 95, unit: "lb", reps: 8, completed: 0, note: null, createdAt: ws, updatedAt: ws });
  o.write("set", "insert", { id: "s2", workoutExerciseId: "we1", position: 1, kind: "normal", weight: 185, unit: "lb", reps: 5, completed: 0, note: null, createdAt: ws, updatedAt: ws });
  o.write("workout_exercise", "insert", { id: "we2", workoutId: "w1", exerciseId: landmine, position: 1, notes: "slow", supersetGroup: 1, restS: null, createdAt: ws, updatedAt: ws });

  // addExercise with a bodyweight custom + its prefilled set (insertSet)
  o.write("workout_exercise", "insert", { id: "we3", workoutId: "w1", exerciseId: dip, position: 2, createdAt: tick(), updatedAt: t });
  o.write("set", "insert", { id: "s3", workoutExerciseId: "we3", position: 0, kind: "normal", weight: null, unit: "lb", reps: null, completed: 0, createdAt: t, updatedAt: t });

  // updateSet / toggleComplete: whole row each time, updatedAt bumped
  const s1 = { id: "s1", workoutExerciseId: "we1", position: 0, kind: "warmup", weight: 95, unit: "lb", reps: 8, completed: 1, note: null, createdAt: ws };
  o.write("set", "update", { ...s1, updatedAt: tick() });
  o.write("set", "update", { id: "s2", workoutExerciseId: "we1", position: 1, kind: "normal", weight: 185, unit: "lb", reps: 5, rpe: 8.5, completed: 1, note: "grindy", createdAt: ws, updatedAt: tick() });
  // same-millisecond edits are legal: equal updatedAt
  o.write("set", "update", { id: "s3", workoutExerciseId: "we3", position: 0, kind: "normal", weight: 25, unit: "lb", reps: 10, completed: 1, createdAt: ws, updatedAt: tick() });
  o.write("set", "update", { id: "s3", workoutExerciseId: "we3", position: 0, kind: "normal", weight: -20, unit: "lb", reps: 10, completed: 1, createdAt: ws, updatedAt: t });

  // setExerciseRest, replaceExercise, relayout
  o.write("workout_exercise", "update", { id: "we1", workoutId: "w1", exerciseId: BENCH, position: 0, notes: null, supersetGroup: null, restS: 150, createdAt: ws, updatedAt: tick() });
  o.write("workout_exercise", "update", { id: "we2", workoutId: "w1", exerciseId: landmine, position: 1, notes: "slow", supersetGroup: null, restS: null, createdAt: ws, updatedAt: tick() });

  // finishWorkout: unchecked sets deleted, empty exercise deleted (sets first), relayout, close
  o.write("set", "insert", { id: "s4", workoutExerciseId: "we2", position: 0, kind: "normal", weight: 45, unit: "lb", reps: 10, completed: 0, createdAt: tick(), updatedAt: t });
  o.write("set", "delete", { id: "s4" });
  o.write("workout_exercise", "delete", { id: "we2" });
  const end = tick();
  o.write("workout", "update", { id: "w1", title: "Push", startedAt: ws, endedAt: end, utcOffsetMin: off, templateId: "t1", status: "finished", notes: null, createdAt: ws, updatedAt: end });

  // merge the bodyweight custom into a catalog exercise (mergeCustomExercise)
  o.write("workout_exercise", "update", { id: "we3", workoutId: "w1", exerciseId: "pull-up", position: 2, notes: null, supersetGroup: null, restS: null, createdAt: ws, updatedAt: tick() });
  o.write("custom_exercise", "update", {
    id: dip, name: "Ring Dip", equipment: "bodyweight", tracking: "weighted_bodyweight", primary: "[]", secondary: "[]", archived: 1, mergedInto: "pull-up", createdAt: T0, updatedAt: t,
  });
  // and a set edit after the merge
  o.write("set", "update", { id: "s3", workoutExerciseId: "we3", position: 0, kind: "normal", weight: 0, unit: "lb", reps: 12, completed: 1, createdAt: ws, updatedAt: tick() });

  // bodyweight log
  o.write("bodyweight", "insert", { id: "bw1", measuredAt: tick(), weight: 181.4, unit: "lb", note: null, createdAt: t, updatedAt: t });
  o.write("bodyweight", "insert", { id: "bw2", measuredAt: tick(), weight: 82.1, unit: "kg", note: "am", createdAt: t, updatedAt: t });
  o.write("bodyweight", "delete", { id: "bw1" });

  // deleteFolder: templates move out first, then the folder goes
  o.write("template", "update", { id: "t1", folderId: null, name: "Push", notes: null, position: 0, archived: 0, createdAt: T0, updatedAt: tick() });
  o.write("template_folder", "delete", { id: "f1" });
  // deleteTemplate: exercises explicitly first
  o.write("template_exercise", "delete", { id: "te1" });
  o.write("template_exercise", "delete", { id: "te2" });
  o.write("template", "delete", { id: "t1" });

  // history.ts deleteFinishedWorkout: soft, status discarded
  o.write("workout", "update", { id: "w1", title: "Push", startedAt: ws, endedAt: end, utcOffsetMin: off, templateId: "t1", status: "discarded", notes: null, createdAt: ws, updatedAt: tick() });

  // custom exercise created then deleted unused (deleteCustomExercise)
  const tmp = customExerciseId("Typo Exercize");
  o.write("custom_exercise", "insert", { id: tmp, name: "Typo Exercize", primary: "[]", secondary: "[]", archived: 0, mergedInto: null, createdAt: tick(), updatedAt: t });
  o.write("custom_exercise", "delete", { id: tmp });
}

describe("phone outbox -> server push (v2 rows)", () => {
  it("drizzle-shaped rows carry exactly the drizzle columns", () => {
    const o = new Outbox();
    v2Session(o);
    for (const r of o.rows) {
      if (r.op === "delete") continue;
      const keys = Object.keys(JSON.parse(r.payload)).sort();
      expect(keys).toEqual(Object.keys(getTableColumns(TABLE[r.entity as SyncEntity])).sort());
    }
  });

  it("a whole session in one push: nothing rejected", () => {
    const o = new Outbox();
    v2Session(o);
    const out = push(o);
    expect(out.rejected).toEqual([]);
    expect(out.appliedThrough).toBe(o.rows.length);
  });

  it.each([1, 2, 3, 7])("the same session split into batches of %i: nothing rejected", (size) => {
    const o = new Outbox();
    v2Session(o);
    expect(push(o, new FakeServer(), size).rejected).toEqual([]);
  });

  it("a replayed batch is all skips, nothing rejected", () => {
    const o = new Outbox();
    v2Session(o);
    const server = new FakeServer();
    push(o, server);
    const again = push(o, server);
    expect(again.rejected).toEqual([]);
  });

  it("a full 500-row batch stays under the route's 2mb body cap", () => {
    const o = new Outbox();
    for (let i = 0; i < 500; i++) {
      o.write("set", "update", { id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`, workoutExerciseId: "8c1c2a52-6a8e-4a39-9f0e-0d6c6f2a1b11", position: i, kind: "normal", weight: 225.5, unit: "lb", reps: 5, rpe: 9.5, completed: 1, note: "x".repeat(200), createdAt: T0, updatedAt: T0 });
    }
    expect(JSON.stringify(buildPushRequest(DEVICE, o.rows)).length).toBeLessThan(2 * 1024 * 1024);
  });
});

// ---------------------------------------------------------------------------
// m1-era outbox rows (written before migration 2 added columns)

function m1Session(o: Outbox) {
  // m1 createCustomExercise: "custom-" + uuid, no merged_into column yet
  const m1Custom = "custom-3f2a9c1e-8b7d-4e6f-a1b2-c3d4e5f60718";
  o.write("custom_exercise", "insert", { id: m1Custom, name: "Belt Squat", equipment: "other", tracking: "weight_reps", primary: "[]", secondary: "[]", createdAt: T0, updatedAt: T0 }, { m1: true });
  // m1 startWorkout: no utc_offset_min / template_id
  o.write("workout", "insert", { id: "m1w", title: "Tuesday Workout", startedAt: T0, status: "active", createdAt: T0, updatedAt: T0 }, { m1: true });
  // m1 addExercise: no rest_s
  o.write("workout_exercise", "insert", { id: "m1we", workoutId: "m1w", exerciseId: m1Custom, position: 0, createdAt: T0, updatedAt: T0 }, { m1: true });
  o.write("set", "insert", { id: "m1s", workoutExerciseId: "m1we", position: 0, kind: "normal", weight: 135, unit: "lb", reps: 10, completed: 0, createdAt: T0, updatedAt: T0 }, { m1: true });
  o.write("set", "update", { id: "m1s", workoutExerciseId: "m1we", position: 0, kind: "normal", weight: 135, unit: "lb", reps: 10, completed: 1, createdAt: T0, updatedAt: T0 + 5 }, { m1: true });
  o.write("workout", "update", { id: "m1w", title: "Tuesday Workout", startedAt: T0, endedAt: T0 + 3600_000, status: "finished", createdAt: T0, updatedAt: T0 + 3600_000 }, { m1: true });
  // after the app update (migration 2), a v2 edit of the old set
  o.write("set", "update", { id: "m1s", workoutExerciseId: "m1we", position: 0, kind: "normal", weight: 140, unit: "lb", reps: 10, completed: 1, createdAt: T0, updatedAt: T0 + 9_000_000 });
}

describe("phone outbox -> server push (m1-era rows)", () => {
  it("m1 payloads lack the v2 keys (as the m1 drizzle schema returned them)", () => {
    const o = new Outbox();
    m1Session(o);
    expect(JSON.parse(o.rows[1].payload)).not.toHaveProperty("utcOffsetMin");
    expect(JSON.parse(o.rows[2].payload)).not.toHaveProperty("restS");
  });

  it("m1 rows are accepted (missing v2 columns read as null), so nothing cascades", () => {
    const o = new Outbox();
    m1Session(o);
    const out = push(o);
    // real bug if this fails: every m1-era row is rejected permanently, the
    // rejection cascades to children, and the phone marks them all synced
    expect(out.rejected).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// server snapshot -> phone restore -> push back

const C = new Date("2026-10-01T01:00:00Z");
const U = new Date("2026-10-01T02:00:00Z");

function sharedWorkout(over: Partial<LiftWorkoutRow> = {}): LiftWorkoutRow {
  return {
    id: "share-Slug1",
    title: "Evening Workout",
    startedLocal: "2026-09-30T18:12",
    startedAt: new Date("2026-10-01T01:12:00Z"),
    utcOffsetMin: null,
    endedAt: null,
    durationS: 3900,
    notes: "felt good",
    source: "share-text",
    status: "finished",
    templateId: null,
    latestIngestId: "ing_x",
    shareSlug: "Slug1",
    workingSets: 3,
    volumeKg: 1000,
    muscleLoad: {},
    deletedAt: null,
    createdAt: C,
    updatedAt: U,
    ...over,
  };
}

function snapshotRows() {
  const importedCustom: ExerciseRow = {
    id: customExerciseId("Belt Squat (Machine)"),
    name: "Belt Squat (Machine)",
    equipment: "machine",
    category: "strength",
    tracking: "weight_reps",
    source: "import",
    isCustom: true,
    archived: false,
    freeDbId: null,
    mergedInto: null,
    createdAt: C,
    updatedAt: U,
  };
  const old = sharedWorkout({ id: "share-0123456789abcdef", shareSlug: null, startedAt: null, startedLocal: "2025-03-09T07:30", durationS: null });
  const app = sharedWorkout({ id: "w-app", source: "app", status: "discarded", deletedAt: U, utcOffsetMin: -420, title: "Push", latestIngestId: null, shareSlug: null, startedLocal: "2026-09-30T18:12" });
  const wes: LiftWorkoutExerciseRow[] = [
    { id: "share-Slug1:0", workoutId: "share-Slug1", exerciseId: BENCH, position: 0, nameRaw: "Bench Press (Barbell)", notes: null, supersetGroup: null, restS: null, createdAt: C, updatedAt: U },
    { id: "share-Slug1:1", workoutId: "share-Slug1", exerciseId: importedCustom.id, position: 1, nameRaw: "Belt Squat (Machine)", notes: "pin 4", supersetGroup: 1, restS: null, createdAt: C, updatedAt: U },
    { id: "share-0123456789abcdef:0", workoutId: old.id, exerciseId: "pull-up", position: 0, nameRaw: "Pull Up", notes: null, supersetGroup: null, restS: null, createdAt: C, updatedAt: U },
  ];
  const set = (id: string, weId: string, over: Partial<LiftSetRow> = {}): LiftSetRow => ({
    id, workoutExerciseId: weId, position: 0, kind: "normal", weight: 185, unit: "lb", weightKg: 83.9, reps: 5, durationS: null, distanceM: null, rpe: null, bodyweight: false, note: null, e1rmKg: 97.9, completed: true, createdAt: C, updatedAt: U, ...over,
  });
  return {
    customExercises: [importedCustom],
    muscles: [{ exerciseId: importedCustom.id, region: "quads", role: "primary" }],
    templateFolders: [],
    templates: [],
    templateExercises: [],
    workouts: [sharedWorkout(), old, app],
    workoutExercises: wes,
    sets: [
      set("share-Slug1:0:0", "share-Slug1:0", { kind: "warmup" }),
      set("share-Slug1:1:0", "share-Slug1:1", { unit: null, weight: null, rpe: 9 }),
      set("share-0123456789abcdef:0:0", "share-0123456789abcdef:0", { weight: 25, bodyweight: true, kind: "failure" }),
    ],
    bodyweights: [{ id: "bw1", measuredAt: C, weight: 180, unit: "lb", note: null, createdAt: C, updatedAt: U }],
  };
}

const ENTITY_OF_STEP = (e: SyncEntity) => e;

describe("server snapshot -> phone restore", () => {
  it("restore plan accepts every row and drops nothing", () => {
    const snap = parseSnapshot(JSON.parse(JSON.stringify(buildSnapshot(snapshotRows(), new Date(), TZ))));
    const plan = restorePlan(snap);
    expect(plan.dropped).toBe(0);
    expect(plan.counts).toEqual({ workouts: 3, sets: 3 });
  });

  it("every restored row inserts into the phone's migrated sqlite schema (checks + fks)", () => {
    const sqlite = new DatabaseSync(":memory:");
    sqlite.exec("PRAGMA foreign_keys = ON");
    for (const m of MIGRATIONS) for (const s of m) sqlite.exec(s);
    const plan = restorePlan(parseSnapshot(JSON.parse(JSON.stringify(buildSnapshot(snapshotRows(), new Date(), TZ)))));
    for (const step of plan.steps) {
      const cfg = getTableConfig(TABLE[ENTITY_OF_STEP(step.entity)]);
      const cols = Object.entries(getTableColumns(TABLE[step.entity])) as [string, { name: string; notNull: boolean }][];
      for (const row of step.rows as unknown as Row[]) {
        // drizzle drops unknown keys silently, so an extra snapshot key is harmless; a missing not-null one isn't
        for (const [key, col] of cols) {
          if (col.notNull && !(key in row)) throw new Error(`${step.entity}.${key} missing in snapshot row`);
        }
        const names = cols.map(([, c]) => `"${c.name}"`).join(", ");
        const marks = cols.map(() => "?").join(", ");
        sqlite.prepare(`INSERT INTO ${cfg.name} (${names}) VALUES (${marks})`).run(...cols.map(([k]) => (row[k] ?? null) as never));
      }
    }
    expect((sqlite.prepare("SELECT count(*) AS n FROM sets").get() as { n: number }).n).toBe(3);
  });

  it("restored rows pushed back (edits of share-ingested workouts) are accepted", () => {
    const snap = buildSnapshot(snapshotRows(), new Date(), TZ);
    const server = new FakeServer();
    // what the server already holds
    for (const w of snap.workouts) server.workouts.add(w.id);
    for (const we of snap.workoutExercises) {
      server.wes.set(we.id, { workoutId: we.workoutId, exerciseId: we.exerciseId, tracking: getExercise(we.exerciseId)?.tracking ?? "weight_reps" });
    }
    for (const s of snap.sets) server.sets.set(s.id, snap.workoutExercises.find((we) => we.id === s.workoutExerciseId)!.workoutId);
    for (const c of snap.customExercises) server.exercises.set(c.id, { name: c.name, tracking: c.tracking });

    const o = new Outbox();
    const later = U.getTime() + 60_000;
    for (const s of snap.sets) o.write("set", "update", { ...s, reps: 6, updatedAt: later });
    for (const w of snap.workouts) o.write("workout", "update", { ...w, status: "discarded", updatedAt: later });
    for (const we of snap.workoutExercises) o.write("workout_exercise", "update", { ...we, restS: 90, updatedAt: later });
    for (const c of snap.customExercises) o.write("custom_exercise", "update", { ...c, archived: 1, updatedAt: later });
    expect(push(o, server).rejected).toEqual([]);
  });

  it("pushing back a restored shared workout keeps its wall-clock start", () => {
    const rows = snapshotRows();
    const snap = buildSnapshot(rows, new Date(), TZ);
    for (const [i, p] of snap.workouts.entries()) {
      expect(workoutRow(p, TZ).startedLocal).toBe(rows.workouts[i].startedLocal);
    }
    // and a linked duration survives the round trip
    expect(workoutRow(snap.workouts[0], TZ).durationS).toBe(3900);
  });
});

describe("paged snapshot: server pages -> phone fetchSnapshot", () => {
  it("pages of 1 reassemble into the same restore as the whole snapshot", async () => {
    const whole = buildSnapshot(snapshotRows(), new Date(5), TZ);
    // the server's pager over the same mapped rows, in id order like the sql
    const fetchFn = async (url: string) => {
      const q = parseSnapshotQuery(new URL(url).searchParams);
      if (!q.ok) return { status: 400, json: async () => ({ ok: false, error: q.error }) };
      const { entity, after, limit } = q.query;
      const all = [...(whole[entity] as { id: string }[])].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      const rest = after == null ? all : all.filter((r) => r.id > after);
      const page = snapshotPage(entity, rest.slice(0, limit + 1) as never, limit, new Date(5));
      return { status: 200, json: async () => JSON.parse(JSON.stringify(page)) };
    };
    const paged = await fetchSnapshot(fetchFn, "https://x.org", "tok", { pageSize: 1 });
    const a = restorePlan(paged);
    const b = restorePlan(whole);
    expect(a.counts).toEqual(b.counts);
    expect(a.dropped).toBe(0);
    for (const [i, step] of a.steps.entries()) {
      const ids = (s: typeof step) => (s.rows as { id: string }[]).map((r) => r.id).sort();
      expect(ids(step)).toEqual(ids(b.steps[i]));
    }
  });
});

// sanity: the catalog ids used above exist, or the planner would reject for the wrong reason
it("fixture catalog ids exist", () => {
  expect(getExercise(BENCH)).toBeTruthy();
  expect(getExercise("pull-up")).toBeTruthy();
  const _m: SyncMutation | null = null;
  void _m;
});
