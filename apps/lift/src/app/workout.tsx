import { useEffect, useMemo, useState } from "react";
import { Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { getExercise, type Exercise } from "lift-core";
import { getCatalog } from "../db/exercises";
import { addSet, discardWorkout, finishWorkout, getActiveWorkout, getWorkoutDetail } from "../db/workouts";
import { Button } from "../components/Button";
import { SetRowEditor } from "../components/SetRowEditor";
import { useColors } from "../components/theme";
import { useDbVersion } from "../components/useDbVersion";
import { formatElapsed } from "../lib/format";
import { flushPendingWrites } from "../lib/pending";
import { setLabels } from "../lib/sets";

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
  // catalog only changes when a custom exercise is created, which bumps version too
  const catalog = useMemo(() => getCatalog(), [version]);

  if (!detail) {
    return (
      <View style={[styles.empty, { backgroundColor: c.bg }]}>
        <Text style={{ color: c.muted }}>no active workout</Text>
      </View>
    );
  }

  const { workout, exercises } = detail;
  const nameOf = (id: string): Exercise | undefined => getExercise(id, catalog);

  const onFinish = () => {
    flushPendingWrites();
    const result = finishWorkout(workout.id);
    if (result === "discard") Alert.alert("nothing completed", "the workout was discarded.");
    router.back();
  };

  const onDiscard = () => {
    Alert.alert("discard workout?", "logged sets will not be saved to history.", [
      { text: "cancel", style: "cancel" },
      {
        text: "discard",
        style: "destructive",
        onPress: () => {
          flushPendingWrites();
          discardWorkout(workout.id);
          router.back();
        },
      },
    ]);
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: c.bg }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <Text style={[styles.title, { color: c.text }]}>{workout.title}</Text>
          <Elapsed since={workout.startedAt} />
        </View>

        {exercises.map(({ row, sets }) => {
          const labels = setLabels(sets);
          return (
            <View key={row.id} style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
              <Text style={[styles.exName, { color: c.accent }]}>{nameOf(row.exerciseId)?.name ?? row.exerciseId}</Text>
              <View style={styles.colHeads}>
                <Text style={[styles.colHead, styles.colLabel, { color: c.muted }]}>set</Text>
                <Text style={[styles.colHead, styles.colKind, { color: c.muted }]}>type</Text>
                <Text style={[styles.colHead, styles.colFlex, { color: c.muted }]}>{sets[0]?.unit ?? "lb"}</Text>
                <Text style={[styles.colHead, styles.colFlex, { color: c.muted }]}>reps</Text>
                <Text style={[styles.colHead, styles.colDone, { color: c.muted }]}>done</Text>
              </View>
              {sets.map((s, i) => (
                <SetRowEditor key={s.id} set={s} label={labels[i]!} />
              ))}
              <Button
                label="add set"
                variant="plain"
                onPress={() => {
                  flushPendingWrites();
                  addSet(row.id);
                }}
                style={styles.addSet}
              />
            </View>
          );
        })}

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
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  empty: { flex: 1, alignItems: "center", justifyContent: "center" },
  body: { padding: 12, gap: 12, paddingBottom: 48 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", paddingHorizontal: 4 },
  title: { fontSize: 20, fontWeight: "700" },
  timer: { fontSize: 16, fontVariant: ["tabular-nums"] },
  card: { borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, paddingVertical: 10, gap: 4 },
  exName: { fontSize: 16, fontWeight: "600", paddingHorizontal: 12, marginBottom: 4 },
  colHeads: { flexDirection: "row", gap: 8, paddingHorizontal: 12 },
  colHead: { fontSize: 12, textAlign: "center" },
  colLabel: { width: 22 },
  colKind: { width: 30 },
  colFlex: { flex: 1 },
  colDone: { width: 30 + 8 + 18 },
  addSet: { marginHorizontal: 12, marginTop: 6, paddingVertical: 8 },
});
