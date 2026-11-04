// pure template logic: planned sets, editor save planning, ordering.

import type { PlannedSetPayload, SetKind, WeightUnit } from "lift-core";
import { DEFAULT_UNIT, SET_KINDS, prefillSet, type SetValues } from "./sets";

export type PlannedSet = PlannedSetPayload;

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** tolerant parse of template_exercises.planned_sets; bad entries are dropped, not fatal */
export function parsePlannedSets(json: string | null | undefined): PlannedSet[] {
  if (!json) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  const out: PlannedSet[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const kind = SET_KINDS.includes(o.kind as SetKind) ? (o.kind as SetKind) : "normal";
    const unit: WeightUnit = o.unit === "kg" ? "kg" : "lb";
    out.push({
      kind,
      weight: num(o.weight),
      unit,
      reps: num(o.reps),
      durationS: num(o.durationS),
      distanceM: num(o.distanceM),
    });
  }
  return out;
}

/** fixed key order so an unchanged plan serializes to the same text (no spurious updates) */
export function serializePlannedSets(planned: readonly PlannedSet[]): string {
  return JSON.stringify(
    planned.map((p) => ({
      kind: p.kind,
      weight: p.weight,
      unit: p.unit,
      reps: p.reps,
      durationS: p.durationS,
      distanceM: p.distanceM,
    }))
  );
}

export function emptyPlannedSet(unit: WeightUnit = DEFAULT_UNIT, previous?: PlannedSet): PlannedSet {
  if (previous) return { ...previous, kind: previous.kind === "warmup" ? "warmup" : "normal" };
  return { kind: "normal", weight: null, unit, reps: null, durationS: null, distanceM: null };
}

/**
 * set values for a workout started from a template. an exercise with no plan
 * still gets one empty set, the same as adding it by hand.
 */
export function setsFromPlanned(planned: readonly PlannedSet[], unit: WeightUnit = DEFAULT_UNIT): SetValues[] {
  if (!planned.length) return [prefillSet(undefined, unit)];
  return planned.map((p) => ({
    kind: p.kind,
    weight: p.weight,
    unit: p.unit ?? unit,
    reps: p.reps,
    durationS: p.durationS,
    distanceM: p.distanceM,
    rpe: null,
  }));
}

export interface LoggedSetLike {
  position: number;
  kind: SetKind;
  weight: number | null;
  unit: WeightUnit;
  reps: number | null;
  durationS: number | null;
  distanceM: number | null;
  completed: number | boolean;
}

/**
 * plan from logged sets. a finished workout keeps only what was done; an
 * active one keeps everything, since nothing may be checked yet.
 */
export function plannedFromLogged(sets: readonly LoggedSetLike[], onlyCompleted: boolean): PlannedSet[] {
  return [...sets]
    .sort((a, b) => a.position - b.position)
    .filter((s) => !onlyCompleted || Boolean(s.completed))
    .map((s) => ({
      kind: s.kind,
      weight: s.weight,
      unit: s.unit,
      reps: s.reps,
      durationS: s.durationS,
      distanceM: s.distanceM,
    }));
}

/**
 * renumber superset groups 1..n by first appearance; a group with a single
 * member is not a superset, so it becomes null.
 */
export function normalizeSupersets(groups: readonly (number | null)[]): (number | null)[] {
  const counts = new Map<number, number>();
  for (const g of groups) if (g != null) counts.set(g, (counts.get(g) ?? 0) + 1);
  const remap = new Map<number, number>();
  return groups.map((g) => {
    if (g == null || (counts.get(g) ?? 0) < 2) return null;
    let n = remap.get(g);
    if (n === undefined) {
      n = remap.size + 1;
      remap.set(g, n);
    }
    return n;
  });
}

/**
 * link item i with the one above it into a superset, or split it off when
 * already linked. groups are assumed contiguous runs; the result is normalized.
 */
export function toggleSupersetWithPrevious(groups: readonly (number | null)[], i: number): (number | null)[] {
  if (i <= 0 || i >= groups.length) return normalizeSupersets(groups);
  const out = [...groups];
  const fresh = Math.max(0, ...groups.map((g) => g ?? 0)) + 1;
  const own = out[i];
  const runEnd = (g: number | null) => {
    let j = i;
    while (j < out.length && out[j] === g) j++;
    return j;
  };
  if (own != null && own === out[i - 1]) {
    // split: this item and the rest of its run start a new group
    const end = runEnd(own);
    for (let j = i; j < end; j++) out[j] = fresh;
  } else {
    const target = out[i - 1] ?? fresh;
    out[i - 1] = target;
    if (own == null) out[i] = target;
    else {
      const end = runEnd(own);
      for (let j = i; j < end; j++) out[j] = target;
    }
  }
  return normalizeSupersets(out);
}

export type PlannedField = "weight" | "reps" | "durationS" | "distanceM";

/** which planned-set inputs a tracking type uses */
export function plannedFields(tracking: string): PlannedField[] {
  switch (tracking) {
    case "reps":
      return ["reps"];
    case "duration":
      return ["durationS"];
    case "distance_duration":
      return ["distanceM", "durationS"];
    case "weight_distance":
      return ["weight", "distanceM"];
    default:
      // weight_reps, weighted_bodyweight, assisted_bodyweight
      return ["weight", "reps"];
  }
}

// ---------------------------------------------------------------------------
// editor save planning

export interface TemplateExerciseDraft {
  /** existing template_exercises id, or undefined for a new entry */
  id?: string;
  exerciseId: string;
  supersetGroup: number | null;
  restS: number | null;
  notes: string | null;
  plannedSets: PlannedSet[];
}

export interface ExistingTemplateExercise {
  id: string;
  exerciseId: string;
  position: number;
  supersetGroup: number | null;
  restS: number | null;
  plannedSets: string;
  notes: string | null;
}

export interface TemplateExerciseValues {
  exerciseId: string;
  position: number;
  supersetGroup: number | null;
  restS: number | null;
  plannedSets: string;
  notes: string | null;
}

export interface TemplateSavePlan {
  inserts: TemplateExerciseValues[];
  updates: (TemplateExerciseValues & { id: string })[];
  deletes: string[];
}

/** diff the editor draft against the stored rows; positions become the draft index */
export function planTemplateSave(
  existing: readonly ExistingTemplateExercise[],
  draft: readonly TemplateExerciseDraft[]
): TemplateSavePlan {
  const byId = new Map(existing.map((e) => [e.id, e]));
  const groups = normalizeSupersets(draft.map((d) => d.supersetGroup));
  const plan: TemplateSavePlan = { inserts: [], updates: [], deletes: [] };
  const kept = new Set<string>();
  draft.forEach((d, i) => {
    const values: TemplateExerciseValues = {
      exerciseId: d.exerciseId,
      position: i,
      supersetGroup: groups[i] ?? null,
      restS: d.restS,
      plannedSets: serializePlannedSets(d.plannedSets),
      notes: d.notes?.trim() ? d.notes.trim() : null,
    };
    const prev = d.id ? byId.get(d.id) : undefined;
    if (!prev || kept.has(prev.id)) {
      plan.inserts.push(values);
      return;
    }
    kept.add(prev.id);
    const changed =
      prev.exerciseId !== values.exerciseId ||
      prev.position !== values.position ||
      prev.supersetGroup !== values.supersetGroup ||
      prev.restS !== values.restS ||
      prev.notes !== values.notes ||
      serializePlannedSets(parsePlannedSets(prev.plannedSets)) !== values.plannedSets;
    if (changed) plan.updates.push({ id: prev.id, ...values });
  });
  for (const e of existing) if (!kept.has(e.id)) plan.deletes.push(e.id);
  return plan;
}

// ---------------------------------------------------------------------------
// ordering

export interface Orderable {
  id: string;
  position: number;
  name: string;
}

export function byPositionThenName<T extends Orderable>(a: T, b: T): number {
  return a.position - b.position || a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
}

/** move one item to a new index; out-of-range targets clamp */
export function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  const out = [...items];
  if (from < 0 || from >= out.length) return out;
  const target = Math.max(0, Math.min(out.length - 1, to));
  const [it] = out.splice(from, 1);
  out.splice(target, 0, it!);
  return out;
}

/** positions to write after a reorder: index order, only rows whose position changed */
export function positionUpdates(ordered: readonly { id: string; position: number }[]): { id: string; position: number }[] {
  const out: { id: string; position: number }[] = [];
  ordered.forEach((it, i) => {
    if (it.position !== i) out.push({ id: it.id, position: i });
  });
  return out;
}

export interface FolderSection<F, T> {
  folder: F | null;
  templates: T[];
}

/** folders in order, each with its templates; unfiled templates (or ones in a missing folder) last */
export function groupTemplates<F extends Orderable, T extends Orderable & { folderId: string | null }>(
  folders: readonly F[],
  templates: readonly T[]
): FolderSection<F, T>[] {
  const sortedFolders = [...folders].sort(byPositionThenName);
  const known = new Set(sortedFolders.map((f) => f.id));
  const sorted = [...templates].sort(byPositionThenName);
  const sections: FolderSection<F, T>[] = sortedFolders.map((f) => ({
    folder: f,
    templates: sorted.filter((t) => t.folderId === f.id),
  }));
  const loose = sorted.filter((t) => t.folderId == null || !known.has(t.folderId));
  if (loose.length || !sections.length) sections.push({ folder: null, templates: loose });
  return sections;
}
