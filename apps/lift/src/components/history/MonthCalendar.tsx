import { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { dayKey, monthGrid, monthLabel, weekdayLabels, type MonthRef } from "../../lib/calendar";
import { useColors } from "../theme";

interface Props {
  month: MonthRef;
  /** day key -> finished workouts that day */
  counts: ReadonlyMap<string, number>;
  selected: string | null;
  onSelect: (key: string | null) => void;
  onShift: (delta: -1 | 1) => void;
  /** today, for the outline (injected so tests and the clock agree) */
  now: number;
}

export function MonthCalendar({ month, counts, selected, onSelect, onShift, now }: Props) {
  const c = useColors();
  const weeks = useMemo(() => monthGrid(month), [month]);
  const today = dayKey(now);

  return (
    <View style={[styles.wrap, { backgroundColor: c.card, borderColor: c.border }]}>
      <View style={styles.head}>
        <Pressable accessibilityLabel="previous month" hitSlop={10} onPress={() => onShift(-1)} style={styles.nav}>
          <Text style={[styles.navText, { color: c.accent }]}>‹</Text>
        </Pressable>
        <Text style={[styles.month, { color: c.text }]}>{monthLabel(month)}</Text>
        <Pressable accessibilityLabel="next month" hitSlop={10} onPress={() => onShift(1)} style={styles.nav}>
          <Text style={[styles.navText, { color: c.accent }]}>›</Text>
        </Pressable>
      </View>
      <View style={styles.week}>
        {weekdayLabels().map((l, i) => (
          <Text key={i} style={[styles.weekday, { color: c.muted }]}>
            {l}
          </Text>
        ))}
      </View>
      {weeks.map((week, wi) => (
        <View key={wi} style={styles.week}>
          {week.map((cell, ci) => {
            if (!cell) return <View key={ci} style={styles.cell} />;
            const n = counts.get(cell.key) ?? 0;
            const on = selected === cell.key;
            return (
              <Pressable
                key={ci}
                accessibilityRole="button"
                accessibilityLabel={`${monthLabel(month)} ${cell.day}${n ? `, ${n} workout${n === 1 ? "" : "s"}` : ""}`}
                accessibilityState={{ selected: on }}
                // tapping the selected day again clears the filter
                onPress={() => onSelect(on ? null : cell.key)}
                style={styles.cell}
              >
                <View
                  style={[
                    styles.day,
                    on && { backgroundColor: c.accent },
                    !on && cell.key === today && { borderColor: c.accent, borderWidth: 1 },
                  ]}
                >
                  <Text style={[styles.dayText, { color: on ? c.accentText : n ? c.text : c.muted }]}>{cell.day}</Text>
                </View>
                <View style={[styles.dot, { backgroundColor: n ? c.accent : "transparent" }]} />
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, padding: 10, gap: 2 },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 6 },
  nav: { paddingHorizontal: 10 },
  navText: { fontSize: 24, fontWeight: "600" },
  month: { fontSize: 16, fontWeight: "600" },
  week: { flexDirection: "row" },
  weekday: { flex: 1, textAlign: "center", fontSize: 12 },
  cell: { flex: 1, alignItems: "center", paddingVertical: 2 },
  day: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  dayText: { fontSize: 15, fontVariant: ["tabular-nums"] },
  dot: { width: 5, height: 5, borderRadius: 3, marginTop: 1 },
});
