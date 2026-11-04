// custom exercise merge: follow merge chains and plan the re-pointing.

export interface MergeLink {
  id: string;
  mergedInto: string | null;
}

/**
 * final id after following mergedInto links. a cycle (only possible from bad
 * synced data) stops at the last id seen before repeating.
 */
export function resolveMergedId(id: string, links: ReadonlyMap<string, string | null>): string {
  const seen = new Set<string>([id]);
  let cur = id;
  for (;;) {
    const next = links.get(cur);
    if (!next || seen.has(next)) return cur;
    seen.add(next);
    cur = next;
  }
}

export function mergeLinkMap(rows: readonly MergeLink[]): Map<string, string | null> {
  return new Map(rows.map((r) => [r.id, r.mergedInto]));
}

export interface Pointer {
  id: string;
  exerciseId: string;
}

export interface MergePlan {
  /** where the source really ends up (target with its own merges followed) */
  targetId: string;
  workoutExercises: string[];
  templateExercises: string[];
}

export type MergeCheck = { ok: true; plan: MergePlan } | { ok: false; error: string };

/**
 * plan merging custom `sourceId` into `targetId`. refuses self-merges and
 * merges whose target already resolves back to the source.
 */
export function planMerge(
  sourceId: string,
  targetId: string,
  links: ReadonlyMap<string, string | null>,
  workoutExercises: readonly Pointer[],
  templateExercises: readonly Pointer[]
): MergeCheck {
  if (sourceId === targetId) return { ok: false, error: "can't merge an exercise into itself" };
  if (links.get(sourceId)) return { ok: false, error: "already merged" };
  const finalTarget = resolveMergedId(targetId, links);
  if (finalTarget === sourceId) return { ok: false, error: "that exercise was merged into this one" };
  return {
    ok: true,
    plan: {
      targetId: finalTarget,
      workoutExercises: workoutExercises.filter((w) => w.exerciseId === sourceId).map((w) => w.id),
      templateExercises: templateExercises.filter((t) => t.exerciseId === sourceId).map((t) => t.id),
    },
  };
}
