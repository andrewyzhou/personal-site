import { useMemo } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { Stack, router } from "expo-router";
import { getUnit, listFinishedWorkouts } from "../../db/history";
import { formatDay, formatDuration, formatVolume } from "../../components/charts/units";
import { useColors } from "../../components/theme";
import { useDbVersion } from "../../components/useDbVersion";

export default function HistoryList() {
  const c = useColors();
  const version = useDbVersion();
  const items = useMemo(() => listFinishedWorkouts(), [version]);
  const unit = useMemo(() => getUnit(), [version]);

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <Stack.Screen options={{ title: "history" }} />
      <FlatList
        data={items}
        keyExtractor={(i) => i.workout.id}
        contentContainerStyle={styles.body}
        ListEmptyComponent={<Text style={{ color: c.muted }}>no finished workouts yet</Text>}
        renderItem={({ item }) => {
          const w = item.workout;
          const meta = [
            w.endedAt ? formatDuration(w.endedAt - w.startedAt) : null,
            `${item.sets} sets`,
            item.volumeKg > 0 ? formatVolume(item.volumeKg, unit) : null,
          ]
            .filter(Boolean)
            .join(" · ");
          return (
            <Pressable
              onPress={() => router.push({ pathname: "/history/[id]", params: { id: w.id } })}
              style={({ pressed }) => [
                styles.card,
                { backgroundColor: c.card, borderColor: c.border, opacity: pressed ? 0.7 : 1 },
              ]}
            >
              <Text style={[styles.date, { color: c.muted }]}>{formatDay(w.startedAt)}</Text>
              <Text style={[styles.title, { color: c.text }]}>{w.title || "workout"}</Text>
              <Text style={{ color: c.muted }}>{meta}</Text>
            </Pressable>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  body: { padding: 16, gap: 10 },
  card: { padding: 14, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, gap: 2 },
  date: { fontSize: 13 },
  title: { fontSize: 17, fontWeight: "600" },
});
