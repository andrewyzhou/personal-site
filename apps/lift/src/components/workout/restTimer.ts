// the running rest timer. one per app: state lives in kv (endsAt) so it
// survives a kill, a local notification covers the end while backgrounded,
// and a js timeout gives the haptic when the app is open.

import { useSyncExternalStore } from "react";
import { AppState, Platform } from "react-native";
import * as Haptics from "expo-haptics";
import * as Notifications from "expo-notifications";
import { getRestTimer, setRestTimer } from "../../db/settings";
import { adjustTimer, endedJustNow, isOver, startTimer, type RestTimer } from "../../lib/rest";

const NOTIFICATION_ID = "rest-timer";
const CHANNEL_ID = "rest";
export const REST_NOTIFICATION_KIND = "rest";

let current: RestTimer | null = null;
let timeout: ReturnType<typeof setTimeout> | null = null;
let started = false;
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of [...listeners]) l();
}

function set(next: RestTimer | null): void {
  current = next;
  setRestTimer(next);
  armTimeout();
  emit();
}

function armTimeout(): void {
  if (timeout) clearTimeout(timeout);
  timeout = null;
  if (!current) return;
  timeout = setTimeout(onTimeout, Math.max(0, current.endsAt - Date.now()));
}

function onTimeout(): void {
  timeout = null;
  if (!current) return;
  const now = Date.now();
  if (!isOver(current, now)) return armTimeout();
  // a timeout that fires late (app was suspended) already got the notification
  if (endedJustNow(current, now) && AppState.currentState === "active") {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  }
  set(null);
}

// --- notifications ----------------------------------------------------------
// ops are chained so a skip right after a start cancels after the schedule
// lands, not before it. the fixed identifier means a reschedule replaces.

let queue: Promise<unknown> = Promise.resolve();
let permission: Promise<boolean> | null = null;

function enqueue(op: () => Promise<unknown>): void {
  queue = queue.then(op).catch(() => {});
}

async function ensurePermission(): Promise<boolean> {
  // asked lazily: the first completed set is when the prompt makes sense
  permission ??= (async () => {
    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
        name: "rest timer",
        importance: Notifications.AndroidImportance.HIGH,
      });
    }
    const current = await Notifications.getPermissionsAsync();
    if (current.granted) return true;
    if (!current.canAskAgain) return false;
    const asked = await Notifications.requestPermissionsAsync();
    return asked.granted;
  })().catch(() => false);
  const ok = await permission;
  // a denial is not cached forever: the user may flip it in settings
  if (!ok) permission = null;
  return ok;
}

function schedule(timer: RestTimer): void {
  enqueue(async () => {
    if (!(await ensurePermission())) return;
    // still the same timer? a skip/adjust may have happened during the prompt
    if (current?.endsAt !== timer.endsAt) return;
    // too close to fire: drop the one an earlier start left behind, or it rings late
    if (timer.endsAt - Date.now() < 1000) return Notifications.cancelScheduledNotificationAsync(NOTIFICATION_ID);
    await Notifications.scheduleNotificationAsync({
      identifier: NOTIFICATION_ID,
      content: {
        title: "rest over",
        body: "next set",
        sound: "default",
        data: { kind: REST_NOTIFICATION_KIND },
        // shows through focus modes with the time-sensitive entitlement; a normal alert without it
        interruptionLevel: "timeSensitive",
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: timer.endsAt,
        channelId: CHANNEL_ID,
      },
    });
  });
}

function unschedule(): void {
  enqueue(() => Notifications.cancelScheduledNotificationAsync(NOTIFICATION_ID));
}

// --- public api -------------------------------------------------------------

/** load the persisted timer once the db is migrated; resumes it after a kill */
export function initRestTimer(): void {
  if (started) return;
  started = true;
  const saved = getRestTimer();
  if (saved && !isOver(saved, Date.now())) {
    current = saved;
    armTimeout();
    emit();
  } else if (saved) {
    setRestTimer(null);
  }
  // js timers stall while suspended; re-check on the way back
  AppState.addEventListener("change", (state) => {
    if (state === "active") onTimeout();
  });
}

export function startRest(durationS: number, workoutExerciseId: string | null): void {
  if (durationS <= 0) return clearRest();
  const timer = startTimer(durationS, Date.now(), workoutExerciseId);
  set(timer);
  schedule(timer);
}

export function adjustRest(deltaS: number): void {
  if (!current) return;
  const next = adjustTimer(current, deltaS, Date.now());
  if (!next) return clearRest();
  set(next);
  schedule(next);
}

/** skip, or the workout ended */
export function clearRest(): void {
  const had = current != null;
  set(null);
  if (had) unschedule();
}

export function useRestTimer(): RestTimer | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current
  );
}
