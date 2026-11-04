import { useMemo, useState } from "react";
import { Alert, ScrollView, StyleSheet, Text, View } from "react-native";
import { Stack, router, useLocalSearchParams } from "expo-router";
import type { PrHit, WeightUnit } from "lift-core";
import { getExerciseLookup } from "../../db/exercises";
import { getHistoryDetail, getUnit } from "../../db/history";
import { getWorkoutPrs } from "../../db/prs";
import { templateFromWorkout } from "../../db/templates";
import { BodyFigure } from "../../components/BodyFigure";
import { Button } from "../../components/Button";
import { formatDay, formatDuration, formatKg, formatVolume, round } from "../../components/charts/units";
import { NamePrompt } from "../../components/library/NamePrompt";
import { useColors } from "../../components/theme";
import { useDbVersion } from "../../components/useDbVersion";
import { prKindLabel } from "../../lib/prs";
import { summarize, summaryMuscleLoad } from "../../lib/summary";

function prValue(hit: PrHit, unit: WeightUnit): string {
  switch (hit.kind) {
    case "e1rm":
    case "weight":
      return formatKg(hit.value, unit);
    case "volume":
      return formatVolume(hit.value, unit);
    case "reps_at_weight":
      return `${hit.value} reps @ ${formatKg(hit.atWeightKg ?? 0, unit)}`;
  }
}

function prPrevious(hit: PrHit, unit: WeightUnit): string | null {
  if (hit.previous === null) return null;
  if (hit.kind === "reps_at_weight") return `was ${hit.previous}`;
  return `was ${hit.kind === "volume" ? formatVolume(hit.previous, unit) : formatKg(hit.previous, unit)}`;
}

export default function WorkoutSummary() {
  const c = useColors();
  const version = useDbVersion();
  // fresh = just finished: no back to the closed workout, only "done"
  const { id, fresh } = useLocalSearchParams<{ id: string; fresh?: string }>();
  const detail = useMemo(() => (id ? getHistoryDetail(id) : undefined), [id, version]);
  const lookup = useMemo(() => getExerciseLookup(), [version]);
  const unit = useMemo(() => getUnit(), [version]);
  const [naming, setNaming] = useState(false);

  const data = useMemo(() => {
    if (!detail) return null;
    const summary = summarize({
      startedAt: detail.workout.startedAt,
      endedAt: detail.workout.endedAt,
      exercises: detail.exercises.map((e) => ({ exerciseId: e.row.exerciseId, sets: e.sets })),
    });
    const ids = summary.exercises.map((e) => e.exerciseId);
    return {
      summary,
      prs: getWorkoutPrs(detail.workout.id, ids),
      load: summaryMuscleLoad(summary.exercises, lookup).normalized,
    };
  }, [detail, lookup]);

  const done = () => (router.canGoBack() ? router.back() : router.replace("/"));

  if (!detail || !data || detail.workout.status !== "finished") {
    return (
      <View style={[styles.body, { flex: 1, backgroundColor: c.bg }]}>
        <Stack.Screen options={{ title: "summary" }} />
        <Text style={{ color: c.muted }}>workout not found</Text>
        <Button label="done" onPress={done} style={styles.gap} />
      </View>
    );
  }

  const w = detail.workout;
  const { summary, prs, load } = data;
  const nameOf = (exerciseId: string) => lookup(exerciseId)?.name ?? exerciseId;

  const saveTemplate = (name: string) => {
    setNaming(false);
    try {
      const t = templateFromWorkout(w.id, name);
      if (t) Alert.alert("template saved", t.name);
    } catch (e) {
      Alert.alert("could not save template", e instanceof Error ? e.message : String(e));
    }
  };

  const stats: [string, string][] = [
    ["duration", summary.durationMs !== null ? formatDuration(summary.durationMs) : "—"],
    ["sets", String(summary.workingSets)],
    ["volume", summary.volumeKg > 0 ? formatVolume(summary.volumeKg, unit) : "—"],
    ["prs", String(prs.length)],
  ];

  return (
    <ScrollView style={{ backgroundColor: c.bg }} contentContainerStyle={styles.body}>
      <Stack.Screen options={{ title: "summary", headerBackVisible: !fresh, gestureEnabled: !fresh }} />
      <Text style={[styles.title, { color: c.text }]}>{w.title || "workout"}</Text>
      <Text style={{ color: c.muted }}>{formatDay(w.startedAt)}</Text>

      <View style={styles.stats}>
        {stats.map(([k, v]) => (
          <View key={k} style={[styles.stat, { backgroundColor: c.card, borderColor: c.border }]}>
            <Text style={[styles.statValue, { color: c.text }]}>{v}</Text>
            <Text style={[styles.statKey, { color: c.muted }]}>{k}</Text>
          </View>
        ))}
      </View>

      {prs.length > 0 ? (
        <>
          <Text style={[styles.section, { color: c.text }]}>personal records</Text>
          {prs.map((hit) => {
            const was = prPrevious(hit, unit);
            return (
              <View key={`${hit.exerciseId}:${hit.kind}`} style={[styles.row, { borderColor: c.border }]}>
                <View style={styles.rowHead}>
                  <Text style={[styles.pill, { backgroundColor: c.accent, color: c.accentText }]}>{prKindLabel(hit.kind)}</Text>
                  <Text style={[styles.rowTitle, { color: c.text }]} numberOfLines={1}>
                    {nameOf(hit.exerciseId)}
                  </Text>
                </View>
                <Text style={{ color: c.text }}>
                  {prValue(hit, unit)}
                  {hit.set && hit.kind !== "reps_at_weight" ? `  ·  ${round(hit.set.weight)} ${hit.set.unit} × ${hit.set.reps}` : ""}
                </Text>
                {was ? <Text style={{ color: c.muted, fontSize: 13 }}>{was}</Text> : null}
              </View>
            );
          })}
        </>
      ) : null}

      <Text style={[styles.section, { color: c.text }]}>exercises</Text>
      {summary.exercises.map((e) => (
        <View key={e.exerciseId} style={[styles.row, { borderColor: c.border }]}>
          <Text
            style={[styles.rowTitle, { color: c.accent }]}
            onPress={() => router.push({ pathname: "/exercises/[id]", params: { id: e.exerciseId } })}
          >
            {nameOf(e.exerciseId)}
          </Text>
          <Text style={{ color: c.muted }}>
            {[
              `${e.workingSets} ${e.workingSets === 1 ? "set" : "sets"}`,
              e.best ? `best ${round(e.best.weight)} ${e.best.unit} × ${e.best.reps}` : null,
              e.best?.e1rmKg ? `e1rm ${formatKg(e.best.e1rmKg, unit)}` : null,
            ]
              .filter(Boolean)
              .join("  ·  ")}
          </Text>
        </View>
      ))}

      {Object.keys(load).length > 0 ? (
        <>
          <Text style={[styles.section, { color: c.text }]}>muscles</Text>
          <View style={styles.figure}>
            <BodyFigure load={load} size={240} />
          </View>
        </>
      ) : null}

      <Button label="save as template" variant="plain" onPress={() => setNaming(true)} style={styles.gap} />
      <Button label="done" onPress={done} />

      <NamePrompt
        visible={naming}
        title="template name"
        initial={w.title || ""}
        onCancel={() => setNaming(false)}
        onSubmit={saveTemplate}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  body: { padding: 16, paddingBottom: 48, gap: 6 },
  title: { fontSize: 22, fontWeight: "700" },
  stats: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 12 },
  stat: { flexGrow: 1, flexBasis: "22%", padding: 10, borderRadius: 10, borderWidth: StyleSheet.hairlineWidth, alignItems: "center" },
  statValue: { fontSize: 18, fontWeight: "700", fontVariant: ["tabular-nums"] },
  statKey: { fontSize: 12, marginTop: 2 },
  section: { fontSize: 17, fontWeight: "600", marginTop: 20, marginBottom: 2 },
  row: { paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, gap: 2 },
  rowHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  rowTitle: { fontSize: 16, fontWeight: "600", flexShrink: 1 },
  pill: { fontSize: 11, fontWeight: "700", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, overflow: "hidden" },
  figure: { alignItems: "center", paddingVertical: 8 },
  gap: { marginTop: 24 },
});
