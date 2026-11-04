import { useMemo, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { Stack, router } from "expo-router";
import { getUnit, listFinishedWorkouts } from "../../db/history";
import { formatDuration, formatVolume } from "../../components/charts/units";
import { MonthCalendar } from "../../components/history/MonthCalendar";
import { useColors } from "../../components/theme";
import { useDbVersion } from "../../components/useDbVersion";
import { useToday } from "../../components/useToday";
import { countByDay, dayKeyLabel, monthOf, shiftMonth, workoutDayKey, type MonthRef } from "../../lib/calendar";

export default function HistoryList() {
  const c = useColors();
  const version = useDbVersion();
  const items = useMemo(() => listFinishedWorkouts(), [version]);
  const unit = useMemo(() => getUnit(), [version]);
  const counts = useMemo(() => countByDay(items, (i) => workoutDayKey(i.workout)), [items]);
  const now = useToday();
  const [month, setMonth] = useState<MonthRef>(() => monthOf(now));
  const [selected, setSelected] = useState<string | null>(null);
  const shown = useMemo(
    () => (selected ? items.filter((i) => workoutDayKey(i.workout) === selected) : items),
    [items, selected]
  );

  const header = (
    <View style={styles.header}>
      <MonthCalendar
        month={month}
        counts={counts}
        selected={selected}
        onSelect={setSelected}
        onShift={(d) => setMonth((m) => shiftMonth(m, d))}
        now={now}
      />
      {selected ? (
        <Pressable accessibilityRole="button" onPress={() => setSelected(null)} hitSlop={8} style={styles.filter}>
          <Text style={{ color: c.muted }}>
            {shown.length ? `${shown.length} on ${dayKeyLabel(selected)}` : "no workouts that day"}
          </Text>
          <Text style={{ color: c.accent }}>show all</Text>
        </Pressable>
      ) : null}
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <Stack.Screen options={{ title: "history" }} />
      <FlatList
        data={shown}
        keyExtractor={(i) => i.workout.id}
        contentContainerStyle={styles.body}
        ListHeaderComponent={header}
        ListEmptyComponent={selected ? undefined : <Text style={{ color: c.muted }}>no finished workouts yet</Text>}
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
              <Text style={[styles.date, { color: c.muted }]}>{dayKeyLabel(workoutDayKey(w))}</Text>
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
  header: { gap: 10 },
  filter: { flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 4 },
  card: { padding: 14, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, gap: 2 },
  date: { fontSize: 13 },
  title: { fontSize: 17, fontWeight: "600" },
});
