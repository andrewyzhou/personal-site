import { useEffect, useMemo, useState } from "react";
import { Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import * as Haptics from "expo-haptics";
import type { SessionSet } from "lift-core";
import { getPreferredUnit } from "../db/bodyweight";
import { getExerciseLookup } from "../db/exercises";
import { programForTemplate, recentSessions, templateExerciseRefs } from "../db/programs";
import { clearPriorBests, getPriorBests } from "../db/prs";
import type { SetRow } from "../db/schema";
import { getDefaultRestS } from "../db/settings";
import { discardWorkout, finishWorkout, getActiveWorkout, getPreviousSessions, getWorkoutDetail } from "../db/workouts";
import { Button } from "../components/Button";
import { useColors } from "../components/theme";
import { useDbVersion } from "../components/useDbVersion";
import { ExerciseCard } from "../components/workout/ExerciseCard";
import { RestBar } from "../components/workout/RestBar";
import { clearRest, startRest, useRestTimer } from "../components/workout/restTimer";
import { countUncompleted, decideFinish } from "../lib/finish";
import { formatElapsed } from "../lib/format";
import { flushPendingWrites } from "../lib/pending";
import { resolveRestS, shouldStartRest } from "../lib/rest";
import { sessionPrFlags, type SetPrKind } from "../lib/prs";
import { groupEdges } from "../lib/sets";
import { progressionHint, ruleFor } from "../lib/programs";

type Detail = NonNullable<ReturnType<typeof getWorkoutDetail>>;

/** pr flags for every set in the workout; repeat entries of one exercise share a running best */
function prFlagsOf(detail: Detail): Record<string, SetPrKind[]> {
  const byExercise = new Map<string, SetRow[]>();
  for (const e of detail.exercises) {
    const list = byExercise.get(e.row.exerciseId) ?? [];
    list.push(...e.sets);
    byExercise.set(e.row.exerciseId, list);
  }
  const out: Record<string, SetPrKind[]> = {};
  for (const [exerciseId, list] of byExercise) {
    Object.assign(out, sessionPrFlags(getPriorBests(detail.workout.id, exerciseId), list));
  }
  return out;
}

/** workout exercise id -> "next: 190 lb × 5", for exercises the active program has a rule for */
function useProgressionHints(detail: Detail | undefined, exerciseKey: string, version: number): Record<string, string> {
  const workoutId = detail?.workout.id;
  const templateId = detail?.workout.templateId ?? null;
  const setup = useMemo(() => {
    const program = programForTemplate(templateId);
    if (!program || !templateId || !Object.keys(program.data.rules).length) return null;
    return { rules: program.data.rules, refs: templateExerciseRefs(templateId), unit: getPreferredUnit() };
  }, [templateId, version]);
  // history only changes when the exercise list does, not per keystroke
  const histories = useMemo(() => {
    const out: Record<string, SessionSet[][]> = {};
    if (!setup || !detail) return out;
    for (const e of detail.exercises) {
      if (!out[e.row.exerciseId] && ruleFor(setup.rules, setup.refs, e.row.exerciseId)) {
        out[e.row.exerciseId] = recentSessions(e.row.exerciseId, detail.workout.id, 5);
      }
    }
    return out;
  }, [setup, workoutId, exerciseKey]);
  return useMemo(() => {
    const out: Record<string, string> = {};
    if (!setup || !detail) return out;
    for (const e of detail.exercises) {
      const rule = ruleFor(setup.rules, setup.refs, e.row.exerciseId);
      if (rule) out[e.row.id] = progressionHint(rule, e.sets, histories[e.row.exerciseId] ?? [], setup.unit);
    }
    return out;
  }, [setup, histories, detail]);
}

function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

function Elapsed({ since }: { since: number }) {
  const c = useColors();
  const now = useNow();
  return <Text style={[styles.timer, { color: c.muted }]}>{formatElapsed(now - since)}</Text>;
}

export default function Workout() {
  const c = useColors();
  const version = useDbVersion();
  const detail = useMemo(() => {
    const active = getActiveWorkout();
    return active ? getWorkoutDetail(active.id) : undefined;
  }, [version]);
  // archived/merged customs still need names here, so not the search catalog
  const lookup = useMemo(() => getExerciseLookup(), [version]);
  const exerciseKey = detail?.exercises.map((e) => e.row.exerciseId).join("|") ?? "";
  // only re-query history when the exercise list changes, not on every keystroke
  const previous = useMemo(
    () => (detail ? getPreviousSessions(detail.workout.id, detail.exercises.map((e) => e.row.exerciseId)) : {}),
    [detail?.workout.id, exerciseKey]
  );
  const defaultRestS = useMemo(() => getDefaultRestS(), [version]);
  const hints = useProgressionHints(detail, exerciseKey, version);
  const timer = useRestTimer();
  // prior bests are cached per workout, so this is only in-memory math per write
  const prFlags = useMemo(() => (detail ? prFlagsOf(detail) : {}), [detail]);
  const [celebrate, setCelebrate] = useState<{ setId: string; n: number } | null>(null);

  if (!detail) {
    return (
      <View style={[styles.empty, { backgroundColor: c.bg }]}>
        <Text style={{ color: c.muted }}>no active workout</Text>
      </View>
    );
  }

  const { workout, exercises } = detail;
  const nameOf = (id: string): string => lookup(id)?.name ?? id;
  const edges = groupEdges(exercises.map((e) => e.row));
  const restLabel = timer?.workoutExerciseId
    ? exercises.find((e) => e.row.id === timer.workoutExerciseId)?.row.exerciseId
    : undefined;

  const onSetCompleted = (set: SetRow) => {
    // re-read: the toggle just committed, and the superset rule needs every partner's state
    const fresh = getWorkoutDetail(workout.id);
    if (!fresh) return;
    const list = fresh.exercises.map((e) => ({ id: e.row.id, supersetGroup: e.row.supersetGroup, sets: e.sets }));
    const owner = fresh.exercises.find((e) => e.row.id === set.workoutExerciseId);
    if (!owner) return;
    if (prFlagsOf(fresh)[set.id]) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setCelebrate((prev) => ({ setId: set.id, n: (prev?.n ?? 0) + 1 }));
    }
    if (shouldStartRest(list, set.id)) {
      startRest(resolveRestS(owner.row.restS, getDefaultRestS()), owner.row.id);
    } else {
      // mid-superset: straight to the partner, any older rest is moot
      clearRest();
    }
  };

  const close = (fn: () => void) => {
    flushPendingWrites();
    fn();
    clearRest();
    clearPriorBests();
    router.back();
  };

  const finish = () => {
    flushPendingWrites();
    const decision = finishWorkout(workout.id);
    clearRest();
    clearPriorBests();
    if (decision === "finish") {
      // replace, so back from the summary goes home rather than to a closed workout
      router.replace({ pathname: "/summary/[id]", params: { id: workout.id, fresh: "1" } });
    } else {
      router.back();
    }
  };

  const onFinish = () => {
    flushPendingWrites();
    const current = getWorkoutDetail(workout.id);
    const all = current?.exercises.flatMap((e) => e.sets) ?? [];
    if (decideFinish(all) === "discard") {
      Alert.alert("nothing completed", "discard this workout?", [
        { text: "keep logging", style: "cancel" },
        { text: "discard", style: "destructive", onPress: () => close(() => finishWorkout(workout.id)) },
      ]);
      return;
    }
    const undone = countUncompleted(current?.exercises ?? []);
    if (undone === 0) return finish();
    Alert.alert("finish workout?", `${undone} unchecked ${undone === 1 ? "set is" : "sets are"} removed.`, [
      { text: "cancel", style: "cancel" },
      { text: "finish", onPress: finish },
    ]);
  };

  const onDiscard = () => {
    Alert.alert("discard workout?", "logged sets will not be saved to history.", [
      { text: "cancel", style: "cancel" },
      { text: "discard", style: "destructive", onPress: () => close(() => discardWorkout(workout.id)) },
    ]);
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: c.bg }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <Text style={[styles.title, { color: c.text }]}>{workout.title}</Text>
          <Elapsed since={workout.startedAt} />
        </View>

        {exercises.map(({ row, sets }, i) => (
          <ExerciseCard
            key={row.id}
            workoutId={workout.id}
            row={row}
            sets={sets}
            name={nameOf(row.exerciseId)}
            previous={previous[row.exerciseId] ?? []}
            edge={edges[i]!}
            isFirst={i === 0}
            isLast={i === exercises.length - 1}
            linkedToNext={row.supersetGroup != null && exercises[i + 1]?.row.supersetGroup === row.supersetGroup}
            defaultRestS={defaultRestS}
            onSetCompleted={onSetCompleted}
            prFlags={prFlags}
            celebrate={celebrate}
            hint={hints[row.id]}
          />
        ))}

        <Button
          label="add exercise"
          variant="plain"
          onPress={() => {
            flushPendingWrites();
            router.push({ pathname: "/add-exercise", params: { workoutId: workout.id } });
          }}
        />
        <Button label="finish" onPress={onFinish} />
        <Button label="discard" variant="danger" onPress={onDiscard} />
      </ScrollView>
      <RestBar label={restLabel ? nameOf(restLabel).toLowerCase() : undefined} />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  empty: { flex: 1, alignItems: "center", justifyContent: "center" },
  body: { padding: 12, gap: 12, paddingBottom: 48 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", paddingHorizontal: 4 },
  title: { fontSize: 20, fontWeight: "700" },
  timer: { fontSize: 16, fontVariant: ["tabular-nums"] },
});
