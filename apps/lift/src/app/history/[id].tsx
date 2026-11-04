import { useMemo } from "react";
import { Alert, ScrollView, StyleSheet, Text, View } from "react-native";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { getExerciseLookup } from "../../db/exercises";
import { deleteFinishedWorkout, getHistoryDetail } from "../../db/history";
import { clearPriorBests } from "../../db/prs";
import { Button } from "../../components/Button";
import { formatDay, formatDuration, round } from "../../components/charts/units";
import { useColors } from "../../components/theme";
import { useDbVersion } from "../../components/useDbVersion";
import type { SetRow } from "../../db/schema";

const KIND_LABEL: Record<SetRow["kind"], string> = { warmup: "w", normal: "", drop: "d", failure: "f" };

function describeSet(s: SetRow): string {
  const parts: string[] = [];
  if (s.weight !== null) parts.push(`${round(s.weight)} ${s.unit}`);
  if (s.reps !== null) parts.push(s.weight !== null ? `× ${s.reps}` : `${s.reps} reps`);
  if (s.durationS !== null) parts.push(`${s.durationS}s`);
  if (s.distanceM !== null) parts.push(`${round(s.distanceM)} m`);
  if (s.rpe !== null) parts.push(`@${round(s.rpe)}`);
  return parts.join(" ") || "—";
}

export default function HistoryDetail() {
  const c = useColors();
  const version = useDbVersion();
  const { id } = useLocalSearchParams<{ id: string }>();
  const detail = useMemo(() => (id ? getHistoryDetail(id) : undefined), [id, version]);
  const lookup = useMemo(() => getExerciseLookup(), [version]);

  if (!detail || detail.workout.status !== "finished") {
    return (
      <View style={[styles.body, { flex: 1, backgroundColor: c.bg }]}>
        <Stack.Screen options={{ title: "" }} />
        <Text style={{ color: c.muted }}>workout not found</Text>
      </View>
    );
  }

  const w = detail.workout;
  const confirmDelete = () =>
    Alert.alert("delete workout?", "it is removed from history and from the server.", [
      { text: "cancel", style: "cancel" },
      {
        text: "delete",
        style: "destructive",
        onPress: () => {
          deleteFinishedWorkout(w.id);
          clearPriorBests();
          router.back();
        },
      },
    ]);

  return (
    <ScrollView style={{ backgroundColor: c.bg }} contentContainerStyle={styles.body}>
      <Stack.Screen options={{ title: w.title || "workout" }} />
      <Text style={[styles.title, { color: c.text }]}>{w.title || "workout"}</Text>
      <Text style={{ color: c.muted }}>
        {formatDay(w.startedAt)}
        {w.endedAt ? ` · ${formatDuration(w.endedAt - w.startedAt)}` : ""}
      </Text>
      {w.notes ? <Text style={[styles.notes, { color: c.text }]}>{w.notes}</Text> : null}

      {detail.exercises.map(({ row, sets }) => (
        <View key={row.id} style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
          <Text
            style={[styles.exercise, { color: c.accent }]}
            onPress={() => router.push({ pathname: "/exercises/[id]", params: { id: row.exerciseId } })}
          >
            {lookup(row.exerciseId)?.name ?? row.exerciseId}
          </Text>
          {row.notes ? <Text style={{ color: c.muted }}>{row.notes}</Text> : null}
          {sets.map((s, i) => (
            <View key={s.id} style={styles.setRow}>
              <Text style={[styles.setNo, { color: c.muted }]}>{KIND_LABEL[s.kind] || String(i + 1)}</Text>
              <Text style={{ color: s.completed ? c.text : c.muted, flex: 1 }}>{describeSet(s)}</Text>
              {s.completed ? null : <Text style={{ color: c.muted }}>skipped</Text>}
            </View>
          ))}
        </View>
      ))}

      <Button
        label="summary"
        variant="plain"
        onPress={() => router.push({ pathname: "/summary/[id]", params: { id: w.id } })}
        style={styles.gap}
      />
      <Button label="delete workout" variant="danger" onPress={confirmDelete} style={styles.small} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  body: { padding: 16, paddingBottom: 48, gap: 4 },
  title: { fontSize: 22, fontWeight: "700" },
  notes: { marginTop: 8 },
  card: { marginTop: 12, padding: 14, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, gap: 4 },
  exercise: { fontSize: 16, fontWeight: "600", marginBottom: 4 },
  setRow: { flexDirection: "row", gap: 12 },
  setNo: { width: 20 },
  gap: { marginTop: 24 },
  small: { marginTop: 8 },
});
