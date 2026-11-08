import { and, asc, eq, gte, isNull, lte, ne, notExists } from "drizzle-orm";
import { linkWorkoutToActivities, type LinkCandidate } from "lift-core";
import { activities, getDb, liftWorkoutActivities, liftWorkouts } from "@/lib/db";
import { log } from "@/lib/log";
import type { LinkedActivity } from "./summary";
import { addDays } from "./time";

// links a workout to the watch recording it happened in (any sport, strength
// preferred: see lift-core link.ts). only ever inserts into
// lift_workout_activities and updates the workout's own timing columns; the
// activities rows are read, never written.

export interface LinkedRecording extends LinkedActivity {
  startDateUtc: Date;
  utcOffsetMin: number;
  elapsedS: number;
}

export interface WorkoutTiming {
  startedAt: Date;
  utcOffsetMin: number;
  endedAt: Date | null;
  durationS: number | null;
}

const LOCAL_START_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

/**
 * timing from the primary recording plus any continuations. with only an
 * overrun link (watch left running) the recording's offset pins the start, but
 * its end says nothing about when the workout ended.
 */
export function timingFromLinks(links: readonly LinkedRecording[], startedLocal?: string): WorkoutTiming | null {
  const primary = links.find((l) => l.role === "primary");
  if (!primary) {
    const overrun = links.find((l) => l.role === "overrun");
    const m = startedLocal ? LOCAL_START_RE.exec(startedLocal) : null;
    if (!overrun || !m) return null;
    const wallMs = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
    return {
      startedAt: new Date(wallMs - overrun.utcOffsetMin * 60_000),
      utcOffsetMin: overrun.utcOffsetMin,
      endedAt: null,
      durationS: null,
    };
  }
  const startMs = primary.startDateUtc.getTime();
  let endMs = startMs + primary.elapsedS * 1000;
  for (const l of links) {
    if (l.role !== "continuation") continue;
    endMs = Math.max(endMs, l.startDateUtc.getTime() + l.elapsedS * 1000);
  }
  return {
    startedAt: primary.startDateUtc,
    utcOffsetMin: primary.utcOffsetMin,
    endedAt: new Date(endMs),
    durationS: Math.round((endMs - startMs) / 1000),
  };
}

function toPublic(l: LinkedRecording): LinkedActivity {
  return {
    activityId: l.activityId,
    role: l.role,
    method: l.method,
    deltaMin: l.deltaMin,
    sportType: l.sportType,
    localTime: l.localTime,
    name: l.name,
  };
}

async function loadLinks(workoutId: string): Promise<LinkedRecording[]> {
  const db = getDb();
  const rows = await db
    .select({
      activityId: liftWorkoutActivities.activityId,
      role: liftWorkoutActivities.role,
      method: liftWorkoutActivities.method,
      deltaMin: liftWorkoutActivities.deltaMin,
      sportType: activities.sportType,
      name: activities.name,
      localTime: activities.localTime,
      startDateUtc: activities.startDateUtc,
      utcOffsetMin: activities.utcOffsetMin,
      elapsedS: activities.elapsedTimeS,
    })
    .from(liftWorkoutActivities)
    .innerJoin(activities, eq(activities.id, liftWorkoutActivities.activityId))
    .where(eq(liftWorkoutActivities.workoutId, workoutId))
    .orderBy(asc(activities.startDateUtc));
  return rows.map((r) => ({
    ...r,
    role: r.role as LinkedActivity["role"],
    method: r.method as LinkedActivity["method"],
  }));
}

/** public view of a workout's current links (for duplicate replies) */
export async function getWorkoutLinks(workoutId: string): Promise<LinkedActivity[]> {
  return (await loadLinks(workoutId)).map(toPublic);
}

/** recordings of any sport within a day of `startedLocal` that no other live workout has claimed */
export function candidateRecordingsQuery(db: ReturnType<typeof getDb>, workout: { id: string; startedLocal: string }) {
  const day = workout.startedLocal.slice(0, 10);
  return db
    .select({
      id: activities.id,
      sportType: activities.sportType,
      localDate: activities.localDate,
      localTime: activities.localTime,
      elapsedS: activities.elapsedTimeS,
    })
    .from(activities)
    .where(
      and(
        gte(activities.localDate, addDays(day, -1)),
        lte(activities.localDate, addDays(day, 1)),
        eq(activities.hidden, false),
        // a soft-deleted workout's links shouldn't hold a recording hostage
        notExists(
          db
            .select({ one: liftWorkoutActivities.activityId })
            .from(liftWorkoutActivities)
            .innerJoin(liftWorkouts, eq(liftWorkouts.id, liftWorkoutActivities.workoutId))
            .where(
              and(
                eq(liftWorkoutActivities.activityId, activities.id),
                ne(liftWorkoutActivities.workoutId, workout.id),
                isNull(liftWorkouts.deletedAt)
              )
            )
        )
      )
    );
}

/**
 * auto-link a workout when it has no links yet, then sync its timing columns
 * from whatever is linked. existing links (auto or manual) are left alone.
 */
export async function linkWorkout(workout: { id: string; startedLocal: string }): Promise<LinkedActivity[]> {
  const db = getDb();
  let links = await loadLinks(workout.id);

  if (links.length === 0) {
    const rows = await candidateRecordingsQuery(db, workout);
    const candidates: LinkCandidate[] = rows.map((r) => ({
      id: r.id,
      sportType: r.sportType,
      localStart: `${r.localDate}T${r.localTime}`,
      elapsedS: r.elapsedS,
    }));
    const matched = candidates.length ? linkWorkoutToActivities(workout.startedLocal, candidates) : [];
    if (matched.length === 0) return [];

    await db
      .insert(liftWorkoutActivities)
      .values(
        matched.map((m) => ({
          workoutId: workout.id,
          activityId: m.activityId,
          role: m.role,
          method: "auto",
          deltaMin: Math.round(m.deltaMin),
        }))
      )
      .onConflictDoNothing();
    links = await loadLinks(workout.id);
  }

  const timing = timingFromLinks(links, workout.startedLocal);
  if (timing) {
    await db
      .update(liftWorkouts)
      .set({ ...timing, updatedAt: new Date() })
      .where(eq(liftWorkouts.id, workout.id));
  }
  return links.map(toPublic);
}

/** retry linking for recent unlinked workouts: the watch often syncs after the share */
export async function relinkRecentWorkouts(days = 14): Promise<{ checked: number; linked: number }> {
  const db = getDb();
  const since = addDays(new Date().toISOString().slice(0, 10), -days);
  const rows = await db
    .select({ id: liftWorkouts.id, startedLocal: liftWorkouts.startedLocal })
    .from(liftWorkouts)
    .where(
      and(
        isNull(liftWorkouts.deletedAt),
        gte(liftWorkouts.startedLocal, since),
        notExists(
          db
            .select({ one: liftWorkoutActivities.activityId })
            .from(liftWorkoutActivities)
            .where(eq(liftWorkoutActivities.workoutId, liftWorkouts.id))
        )
      )
    );

  let linked = 0;
  for (const w of rows) {
    try {
      if ((await linkWorkout(w)).length > 0) linked++;
    } catch (error) {
      // one bad workout shouldn't stop the rest of the sweep
      log.error("lift:link", `relink ${w.id} failed`, error);
    }
  }
  return { checked: rows.length, linked };
}
