// the kv table: small local device state. never written to the outbox, so
// nothing here syncs. writes don't notify() either: the sync loop listens to
// that feed and also writes here, which would make it chase its own tail.

import { eq } from "drizzle-orm";
import type { WeightUnit } from "lift-core";
import { db } from "./client";
import { kv } from "./schema";
import { DEFAULT_REST_S, clampRestS, parseRestTimer, type RestTimer } from "../lib/rest";
import { parseUnit } from "../lib/sets";

export type SettingKey =
  /** seconds of rest after a set when the exercise has no override */
  | "defaultRestS"
  /** "lb" | "kg" for new sets with nothing to copy from */
  | "unit"
  /** json RestTimer while one runs, so it survives the app being killed */
  | "restTimer"
  | "serverUrl"
  | "deviceId"
  | "lastSyncResult"
  /** json {workoutId, programId}: the program "start next day" last opened a workout for */
  | "programWorkout"
  | "lastSyncAt";

export function getSetting(key: SettingKey): string | null {
  return db.select({ value: kv.value }).from(kv).where(eq(kv.key, key)).get()?.value ?? null;
}

/** null clears the key, so the default applies again */
export function setSetting(key: SettingKey, value: string | null): void {
  if (value == null) {
    db.delete(kv).where(eq(kv.key, key)).run();
    return;
  }
  db.insert(kv).values({ key, value }).onConflictDoUpdate({ target: kv.key, set: { value } }).run();
}

// typed views over the raw strings

export function getDefaultRestS(): number {
  const raw = getSetting("defaultRestS");
  const n = raw == null ? NaN : Number(raw);
  return Number.isFinite(n) ? clampRestS(n) : DEFAULT_REST_S;
}

export function setDefaultRestS(s: number | null): void {
  setSetting("defaultRestS", s == null ? null : String(clampRestS(s)));
}

export function getDefaultUnit(): WeightUnit {
  return parseUnit(getSetting("unit"));
}

export function setDefaultUnit(unit: WeightUnit): void {
  setSetting("unit", unit);
}

export function getRestTimer(): RestTimer | null {
  return parseRestTimer(getSetting("restTimer"));
}

export function setRestTimer(timer: RestTimer | null): void {
  setSetting("restTimer", timer ? JSON.stringify(timer) : null);
}
