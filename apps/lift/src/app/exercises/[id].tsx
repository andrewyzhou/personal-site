import { useMemo } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { exerciseSessions, fromKg, personalRecords, type PersonalRecords, type SessionPoint } from "lift-core";
import { lookupExercise } from "../../db/exercises";
import { getUnit, loadExerciseHistory, loadExerciseNotes } from "../../db/history";
import { LineChart } from "../../components/charts/LineChart";
import { formatDay, formatKg, round } from "../../components/charts/units";
import { useColors } from "../../components/theme";
import { useDbVersion } from "../../components/useDbVersion";
import { formatList, humanize } from "../../lib/format";
import { bestSetsByE1rm, noteTimeline, type NoteEntry, type RankedSet } from "../../lib/records";

interface History {
  sessions: SessionPoint[];
  prs: PersonalRecords;
  best: RankedSet[];
  notes: NoteEntry[];
}

function loadHistory(id: string): History | null {
  try {
    const rows = loadExerciseHistory(id);
    return {
      sessions: exerciseSessions(rows, id),
      prs: personalRecords(rows, id),
      best: bestSetsByE1rm(rows, id, 5),
      notes: noteTimeline(loadExerciseNotes(id)),
    };
  } catch {
    // keeps the details readable if the history math throws
    return null;
  }
}

export default function ExerciseDetail() {
  const c = useColors();
  const version = useDbVersion();
  const { id } = useLocalSearchParams<{ id: string }>();
  // version too: a rename of a custom exercise must show here
  const exercise = useMemo(() => (id ? lookupExercise(id) : undefined), [id, version]);
  const unit = useMemo(() => getUnit(), [version]);
  const history = useMemo(() => (id ? loadHistory(id) : null), [id, version]);

  if (!exercise) {
    return (
      <View style={[styles.body, { backgroundColor: c.bg, flex: 1 }]}>
        <Text style={{ color: c.muted }}>exercise not found</Text>
      </View>
    );
  }

  const rows: [string, string][] = [
    ["equipment", humanize(exercise.equipment)],
    ["tracking", humanize(exercise.tracking)],
    ["primary", formatList(exercise.primary) || "none"],
    ["secondary", formatList(exercise.secondary) || "none"],
    ["aliases", exercise.aliases.join(", ") || "none"],
  ];

  const sessions = history?.sessions ?? [];
  const prs = history?.prs;
  const e1rmData = sessions
    .filter((s) => s.e1rmKg !== null)
    .map((s) => ({ x: s.startedAt, y: fromKg(s.e1rmKg as number, unit) }));
  const volumeData = sessions.filter((s) => s.volumeKg > 0).map((s) => ({ x: s.startedAt, y: fromKg(s.volumeKg, unit) }));
  const fmt = (v: number) => round(v, 0);

  return (
    <ScrollView style={{ backgroundColor: c.bg }} contentContainerStyle={styles.body}>
      <Stack.Screen
        options={{
          title: exercise.name,
          headerRight: !exercise.id.startsWith("custom-")
            ? undefined
            : () => (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => router.push({ pathname: "/custom-exercise/[id]", params: { id: exercise.id } })}
                >
                  <Text style={{ color: c.accent }}>edit</Text>
                </Pressable>
              ),
        }}
      />
      <Text style={[styles.name, { color: c.text }]}>{exercise.name}</Text>

      {history === null ? (
        <Text style={{ color: c.muted }}>history unavailable</Text>
      ) : sessions.length === 0 ? (
        <Text style={{ color: c.muted }}>no finished sessions yet</Text>
      ) : (
        <>
          <Text style={[styles.section, { color: c.text }]}>records</Text>
          <View style={[styles.row, { borderColor: c.border }]}>
            <Text style={[styles.key, { color: c.muted }]}>best e1rm</Text>
            <Text style={[styles.value, { color: c.text }]}>
              {prs?.bestE1rmKg
                ? `${formatKg(prs.bestE1rmKg.value, unit)} · ${formatDay(prs.bestE1rmKg.startedAt)}`
                : "none"}
            </Text>
          </View>
          <View style={[styles.row, { borderColor: c.border }]}>
            <Text style={[styles.key, { color: c.muted }]}>heaviest</Text>
            <Text style={[styles.value, { color: c.text }]}>
              {prs?.heaviest
                ? `${round(prs.heaviest.weight)} ${prs.heaviest.unit} × ${prs.heaviest.reps} · ${formatDay(prs.heaviest.startedAt)}`
                : "none"}
            </Text>
          </View>
          {prs && prs.repsAtWeight.length > 0 ? (
            <View style={[styles.row, { borderColor: c.border }]}>
              <Text style={[styles.key, { color: c.muted }]}>rep prs</Text>
              {[...prs.repsAtWeight]
                .sort((a, b) => b.weightKg - a.weightKg)
                .map((r) => (
                  <View key={r.weightKg} style={styles.repRow}>
                    <Text style={{ color: c.text }}>{formatKg(r.weightKg, unit)}</Text>
                    <Text style={{ color: c.text }}>× {r.reps}</Text>
                    <Text style={{ color: c.muted }}>{formatDay(r.startedAt)}</Text>
                  </View>
                ))}
            </View>
          ) : null}

          <LineChart title={`e1rm (${unit})`} data={e1rmData} formatY={fmt} />
          <LineChart title={`volume (${unit})`} data={volumeData} formatY={fmt} />

          {history.best.length > 0 ? (
            <>
              <Text style={[styles.section, { color: c.text }]}>best sets</Text>
              <View style={[styles.tableRow, { borderColor: c.border }]}>
                <Text style={[styles.rank, styles.th, { color: c.muted }]}>#</Text>
                <Text style={[styles.cellWide, styles.th, { color: c.muted }]}>set</Text>
                <Text style={[styles.cell, styles.th, { color: c.muted }]}>e1rm</Text>
                <Text style={[styles.cellDate, styles.th, { color: c.muted }]}>date</Text>
              </View>
              {history.best.map((b, i) => (
                <Pressable
                  key={`${b.workoutId}:${b.weight}:${b.reps}`}
                  onPress={() => router.push({ pathname: "/history/[id]", params: { id: b.workoutId } })}
                  style={({ pressed }) => [styles.tableRow, { borderColor: c.border, opacity: pressed ? 0.6 : 1 }]}
                >
                  <Text style={[styles.rank, { color: c.muted }]}>{i + 1}</Text>
                  <Text style={[styles.cellWide, { color: c.text }]}>
                    {round(b.weight)} {b.unit} × {b.reps}
                  </Text>
                  <Text style={[styles.cell, { color: c.text }]}>{formatKg(b.e1rmKg, unit)}</Text>
                  <Text style={[styles.cellDate, { color: c.muted }]}>{formatDay(b.startedAt)}</Text>
                </Pressable>
              ))}
            </>
          ) : null}

          {history.notes.length > 0 ? (
            <>
              <Text style={[styles.section, { color: c.text }]}>notes</Text>
              {history.notes.map((n, i) => (
                <Pressable
                  key={`${n.workoutId}:${n.label}:${i}`}
                  onPress={() => router.push({ pathname: "/history/[id]", params: { id: n.workoutId } })}
                  style={({ pressed }) => [styles.row, { borderColor: c.border, opacity: pressed ? 0.6 : 1 }]}
                >
                  <Text style={[styles.key, { color: c.muted }]}>
                    {formatDay(n.startedAt)} · {n.label}
                  </Text>
                  <Text style={[styles.value, { color: c.text }]}>{n.text}</Text>
                </Pressable>
              ))}
            </>
          ) : null}

          <Text style={[styles.section, { color: c.text }]}>sessions</Text>
          {[...sessions].reverse().map((s) => (
            <Pressable
              key={s.workoutId}
              onPress={() => router.push({ pathname: "/history/[id]", params: { id: s.workoutId } })}
              style={({ pressed }) => [styles.row, { borderColor: c.border, opacity: pressed ? 0.6 : 1 }]}
            >
              <Text style={[styles.key, { color: c.muted }]}>{formatDay(s.startedAt)}</Text>
              <Text style={[styles.value, { color: c.text }]}>
                {s.topSet ? `${round(s.topSet.weight)} ${s.topSet.unit} × ${s.topSet.reps}` : `${s.workingSets} sets`}
                {s.e1rmKg !== null ? `  ·  e1rm ${formatKg(s.e1rmKg, unit)}` : ""}
              </Text>
            </Pressable>
          ))}
        </>
      )}

      <Text style={[styles.section, { color: c.text }]}>details</Text>
      {rows.map(([k, v]) => (
        <View key={k} style={[styles.row, { borderColor: c.border }]}>
          <Text style={[styles.key, { color: c.muted }]}>{k}</Text>
          <Text style={[styles.value, { color: c.text }]}>{v}</Text>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  body: { padding: 16, paddingBottom: 48 },
  name: { fontSize: 22, fontWeight: "700", marginBottom: 12 },
  section: { fontSize: 17, fontWeight: "600", marginTop: 20, marginBottom: 4 },
  row: { paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  repRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 4 },
  key: { fontSize: 13 },
  value: { fontSize: 16, marginTop: 2 },
  tableRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  th: { fontSize: 12 },
  rank: { width: 16, fontVariant: ["tabular-nums"] },
  cellWide: { flex: 1.3, fontVariant: ["tabular-nums"] },
  cell: { flex: 1, fontVariant: ["tabular-nums"] },
  cellDate: { flex: 1.2, textAlign: "right", fontSize: 13 },
});
