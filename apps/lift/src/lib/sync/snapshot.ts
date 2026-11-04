// server snapshot -> ordered insert plan for a reinstall restore. pure.

import { SYNC_PROTOCOL_VERSION, type SyncPayloads, type SyncSnapshot } from "lift-core";
import { endpoint } from "./mutations";
import type { FetchLike } from "./push";

const KEYS = [
  "customExercises",
  "templateFolders",
  "templates",
  "templateExercises",
  "workouts",
  "workoutExercises",
  "sets",
  "bodyweights",
] as const;

/** validates the shape we rely on; throws with a short message otherwise */
export function parseSnapshot(body: unknown): SyncSnapshot {
  if (typeof body !== "object" || body === null) throw new Error("bad snapshot");
  const b = body as Record<string, unknown>;
  if (b.protocol !== SYNC_PROTOCOL_VERSION) throw new Error(`unsupported snapshot protocol ${String(b.protocol)}`);
  for (const k of KEYS) {
    if (!Array.isArray(b[k])) throw new Error(`bad snapshot: ${k} missing`);
    for (const row of b[k] as unknown[]) {
      if (typeof row !== "object" || row === null || typeof (row as { id?: unknown }).id !== "string") {
        throw new Error(`bad snapshot: ${k} row without id`);
      }
    }
  }
  return body as SyncSnapshot;
}

export interface RestoreStep<E extends keyof SyncPayloads = keyof SyncPayloads> {
  entity: E;
  rows: SyncPayloads[E][];
}

export interface RestorePlan {
  /** parents before children, so every fk resolves on insert */
  steps: RestoreStep[];
  /** child rows whose parent isn't in the snapshot; inserting them would abort the transaction */
  dropped: number;
  counts: { workouts: number; sets: number };
}

function dedupe<T extends { id: string }>(rows: readonly T[]): T[] {
  // last one wins, matching how the server would have applied them
  const byId = new Map<string, T>();
  for (const r of rows) byId.set(r.id, r);
  return [...byId.values()];
}

export function restorePlan(s: SyncSnapshot): RestorePlan {
  let dropped = 0;
  const keep = <T>(rows: T[], ok: (r: T) => boolean): T[] => {
    const out = rows.filter(ok);
    dropped += rows.length - out.length;
    return out;
  };

  const folders = dedupe(s.templateFolders);
  const folderIds = new Set(folders.map((f) => f.id));
  // a missing folder mirrors on delete set null instead of losing the template
  const templates = dedupe(s.templates).map((t) =>
    t.folderId !== null && !folderIds.has(t.folderId) ? { ...t, folderId: null } : t
  );
  const templateIds = new Set(templates.map((t) => t.id));
  const templateExercises = keep(dedupe(s.templateExercises), (te) => templateIds.has(te.templateId));
  const workouts = dedupe(s.workouts);
  const workoutIds = new Set(workouts.map((w) => w.id));
  const workoutExercises = keep(dedupe(s.workoutExercises), (we) => workoutIds.has(we.workoutId));
  const weIds = new Set(workoutExercises.map((we) => we.id));
  const sets = keep(dedupe(s.sets), (st) => weIds.has(st.workoutExerciseId));

  const steps: RestoreStep[] = [
    { entity: "custom_exercise", rows: dedupe(s.customExercises) },
    { entity: "template_folder", rows: folders },
    { entity: "template", rows: templates },
    { entity: "template_exercise", rows: templateExercises },
    { entity: "workout", rows: workouts },
    { entity: "workout_exercise", rows: workoutExercises },
    { entity: "set", rows: sets },
    { entity: "bodyweight", rows: dedupe(s.bodyweights) },
  ];
  return { steps, dropped, counts: { workouts: workouts.length, sets: sets.length } };
}

/** reverse of the insert order, for wiping */
export function wipeOrder(plan: RestorePlan): (keyof SyncPayloads)[] {
  return plan.steps.map((s) => s.entity).reverse();
}

export function chunk<T>(rows: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

export async function fetchSnapshot(
  fetchFn: FetchLike,
  baseUrl: string,
  token: string,
  timeoutMs = 60_000
): Promise<SyncSnapshot> {
  const url = endpoint(baseUrl, "/api/lift/sync/snapshot");
  if (!url) throw new Error("invalid server url");
  if (!token) throw new Error("no app token");
  const controller = typeof AbortController === "undefined" ? null : new AbortController();
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    let r;
    try {
      r = await fetchFn(url, {
        method: "GET",
        headers: { authorization: `Bearer ${token}` },
        signal: controller?.signal,
      });
    } catch {
      throw new Error("network error");
    }
    if (r.status === 401 || r.status === 403) throw new Error("unauthorized: check the app token");
    if (r.status !== 200) throw new Error(`server error ${r.status}`);
    return parseSnapshot(await r.json());
  } finally {
    if (timer) clearTimeout(timer);
  }
}
