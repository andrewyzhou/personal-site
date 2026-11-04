import { useMemo } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Stack, useLocalSearchParams } from "expo-router";
import { getExercise } from "lift-core";
import { getCatalog } from "../../db/exercises";
import { useColors } from "../../components/theme";
import { formatList, humanize } from "../../lib/format";

export default function ExerciseDetail() {
  const c = useColors();
  const { id } = useLocalSearchParams<{ id: string }>();
  const exercise = useMemo(() => (id ? getExercise(id, getCatalog()) : undefined), [id]);

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

  return (
    <ScrollView style={{ backgroundColor: c.bg }} contentContainerStyle={styles.body}>
      <Stack.Screen options={{ title: exercise.name }} />
      <Text style={[styles.name, { color: c.text }]}>{exercise.name}</Text>
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
  body: { padding: 16 },
  name: { fontSize: 22, fontWeight: "700", marginBottom: 12 },
  row: { paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  key: { fontSize: 13 },
  value: { fontSize: 16, marginTop: 2 },
});
