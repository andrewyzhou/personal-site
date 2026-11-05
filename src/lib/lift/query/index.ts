// question text -> reply text for the lift bot. parsing and formatting are pure
// (intent.ts, answer.ts); this file only picks the query and the formatter.

import { resolveExerciseName, type Exercise } from "lift-core";
import { addDays, liftTimezone, utcToLocal } from "../time";
import {
  HELP_TEXT,
  answerExerciseBest,
  answerExerciseCount,
  answerExerciseE1rm,
  answerExerciseHistory,
  answerExerciseLast,
  answerExerciseSets,
  answerExerciseVolume,
  answerWorkoutCount,
  answerWorkoutLast,
  answerWorkoutVolume,
  answerWorkoutsIn,
  unknownExerciseText,
  unknownText,
  type AnswerContext,
} from "./answer";
import { dbStore, type QueryStore } from "./db";
import { parseLiftQuestion, resolveExerciseTerm, type LiftIntent } from "./intent";
import { mondayOf, type DateWindow } from "./window";

export { HELP_TEXT } from "./answer";
export { parseLiftQuestion } from "./intent";

// enough for years of training; older workouts drop out of "all time" counts past this
const WORKOUT_SCAN_LIMIT = 5000;
// "last leg day" only needs to look back so far
const LAST_SCAN_LIMIT = 500;

export interface AnswerOptions {
  now?: Date;
  store?: QueryStore;
}

/** local 'YYYY-MM-DD' in the lift timezone */
export function localToday(now: Date = new Date()): string {
  return utcToLocal(now, liftTimezone()).slice(0, 10);
}

function thisWeek(today: string): DateWindow {
  const mon = mondayOf(today);
  return { label: "this week", start: mon, end: addDays(mon, 7) };
}

async function resolve(term: string, store: QueryStore, strict: boolean): Promise<Exercise | null> {
  // catalog names and aliases need no db; the owner's own list is only read for the rest
  const exact = resolveExerciseName(term);
  if (exact) return exact;
  return resolveExerciseTerm(term, await store.knownExercises(), { strict });
}

export async function answerIntent(intent: LiftIntent, today: string, store: QueryStore): Promise<string> {
  if (intent.kind === "help") return HELP_TEXT;
  if (intent.kind === "unknown") return unknownText();
  const ctx: AnswerContext = { today };
  const { subject, window } = intent;

  if (subject.type === "exercise") {
    const exercise = await resolve(subject.term, store, intent.bare === true);
    if (!exercise) return intent.bare ? unknownText() : unknownExerciseText(subject.term);
    const { workouts, sets } = await store.exerciseSets(exercise.id);
    switch (intent.kind) {
      case "sets":
        return answerExerciseSets(exercise, window, workouts, sets, ctx);
      case "last":
        return answerExerciseLast(exercise, workouts, sets, ctx);
      case "best":
        return answerExerciseBest(exercise, window, workouts, sets, ctx);
      case "e1rm":
        return answerExerciseE1rm(exercise, window, workouts, sets, ctx);
      case "history":
        return answerExerciseHistory(exercise, window, workouts, sets, ctx);
      case "volume":
        return answerExerciseVolume(exercise, window ?? thisWeek(today), workouts, sets);
      case "count":
        return answerExerciseCount(exercise, window, workouts, sets);
    }
  }

  switch (intent.kind) {
    case "sets":
      return answerWorkoutsIn(subject, window!, await store.workouts(window, WORKOUT_SCAN_LIMIT), ctx);
    case "last":
      return answerWorkoutLast(subject, await store.workouts(null, LAST_SCAN_LIMIT), ctx);
    case "count":
      return answerWorkoutCount(subject, window, await store.workouts(window, WORKOUT_SCAN_LIMIT));
    case "volume": {
      const w = window ?? thisWeek(today);
      return answerWorkoutVolume(subject, w, await store.workouts(w, WORKOUT_SCAN_LIMIT));
    }
    default:
      return unknownText();
  }
}

/** the bot's answer to a non-workout message */
export async function answerLiftQuestion(text: string, options: AnswerOptions = {}): Promise<string> {
  const today = localToday(options.now);
  return answerIntent(parseLiftQuestion(text, today), today, options.store ?? dbStore);
}
