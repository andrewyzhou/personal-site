// what re-running the linker over existing workouts would change. pure: the
// script (scripts/lift-relink-report.mts) reads the rows, this decides, and
// only workouts with no links at all are ever written (by linkWorkout, the
// same path the daily cron takes). existing links, auto or manual, stay put.

import { linkWorkoutToActivities, type ActivityLink, type LinkRole } from "lift-core";
import { addDays } from "./time";

export interface RelinkWorkout {
  id: string;
  startedLocal: string;
  title: string;
}

export interface RelinkLink {
  workoutId: string;
  activityId: number;
  role: LinkRole;
  method: "auto" | "manual";
}

export interface RelinkActivity {
  id: number;
  sportType: string;
  name: string;
  localDate: string;
  localTime: string;
  elapsedS: number;
}

export type RelinkChange =
  /** unlinked today and would gain a link (the only case --apply writes) */
  | "new-link"
  /** auto-linked today, and the new rule would pick something else (reported, not rewritten) */
  | "would-change"
  /** has a manual link: never touched */
  | "manual"
  | "unchanged";

export interface RelinkRow {
  workout: RelinkWorkout;
  change: RelinkChange;
  current: { activityId: number; role: LinkRole }[];
  proposed: ActivityLink[];
}

const key = (links: readonly { activityId: number; role: LinkRole }[]) =>
  links
    .map((l) => `${l.activityId}:${l.role}`)
    .sort()
    .join(",");

/** one row per workout, oldest first; unlinked workouts claim their recordings in order, as the cron would */
export function planRelink(
  workouts: readonly RelinkWorkout[],
  links: readonly RelinkLink[],
  recordings: readonly RelinkActivity[],
): RelinkRow[] {
  const byWorkout = new Map<string, RelinkLink[]>();
  const claimedBy = new Map<number, string>();
  for (const l of links) {
    byWorkout.set(l.workoutId, [...(byWorkout.get(l.workoutId) ?? []), l]);
    claimedBy.set(l.activityId, l.workoutId);
  }

  const rows: RelinkRow[] = [];
  for (const w of [...workouts].sort((a, b) => a.startedLocal.localeCompare(b.startedLocal) || a.id.localeCompare(b.id))) {
    const current = (byWorkout.get(w.id) ?? []).map((l) => ({ activityId: l.activityId, role: l.role }));
    const day = w.startedLocal.slice(0, 10);
    const [from, to] = [addDays(day, -1), addDays(day, 1)];
    // same pool as candidateRecordingsQuery: a day either side, not claimed by another workout
    const candidates = recordings
      .filter((a) => a.localDate >= from && a.localDate <= to)
      .filter((a) => {
        const owner = claimedBy.get(a.id);
        return owner === undefined || owner === w.id;
      })
      .map((a) => ({ id: a.id, sportType: a.sportType, localStart: `${a.localDate}T${a.localTime}`, elapsedS: a.elapsedS }));
    const proposed = linkWorkoutToActivities(w.startedLocal, candidates);

    let change: RelinkChange;
    if ((byWorkout.get(w.id) ?? []).some((l) => l.method === "manual")) change = "manual";
    else if (current.length === 0) change = proposed.length ? "new-link" : "unchanged";
    else change = key(current) === key(proposed) ? "unchanged" : "would-change";

    // a new link claims its recordings for the workouts after it
    if (change === "new-link") for (const p of proposed) claimedBy.set(p.activityId, w.id);
    rows.push({ workout: w, change, current, proposed });
  }
  return rows;
}

/** plain-text report for the terminal */
export function formatRelinkReport(rows: readonly RelinkRow[], recordings: readonly RelinkActivity[]): string {
  const act = new Map(recordings.map((a) => [a.id, a]));
  const describe = (l: { activityId: number; role: LinkRole }) => {
    const a = act.get(l.activityId);
    return a ? `#${l.activityId} ${l.role} (${a.sportType} ${a.localDate} ${a.localTime}${a.name ? ` "${a.name}"` : ""})` : `#${l.activityId} ${l.role}`;
  };
  const count = (c: RelinkChange) => rows.filter((r) => r.change === c).length;
  const out = [
    `workouts: ${rows.length}`,
    `  new link (unlinked today, would link): ${count("new-link")}`,
    `  would change (auto-linked today; reported only, never rewritten): ${count("would-change")}`,
    `  manual links (left alone): ${count("manual")}`,
    `  unchanged: ${count("unchanged")}`,
  ];
  for (const c of ["new-link", "would-change"] as const) {
    const list = rows.filter((r) => r.change === c);
    if (!list.length) continue;
    out.push("", c === "new-link" ? "would link:" : "would change:");
    for (const r of list) {
      out.push(`  ${r.workout.startedLocal} ${r.workout.title} [${r.workout.id}]`);
      if (r.current.length) out.push(`    now:      ${r.current.map(describe).join(", ")}`);
      out.push(`    proposed: ${r.proposed.length ? r.proposed.map(describe).join(", ") : "lift-only"}`);
    }
  }
  return out.join("\n");
}
