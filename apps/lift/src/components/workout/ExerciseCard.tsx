import { useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import type { SetRow, WorkoutExerciseRow } from "../../db/schema";
import {
  addSet,
  linkWithNextExercise,
  moveWorkoutExercise,
  removeExercise,
  setExerciseRest,
  unlinkFromNextExercise,
} from "../../db/workouts";
import { flushPendingWrites } from "../../lib/pending";
import { REST_STEP_S, formatRest } from "../../lib/rest";
import type { SetPrKind } from "../../lib/prs";
import { formatPrevious, setLabels, type GroupEdge } from "../../lib/sets";
import { Button } from "../Button";
import { PrBadge } from "../pr/PrBadge";
import { SetRowEditor } from "../SetRowEditor";
import { useColors } from "../theme";

interface Props {
  workoutId: string;
  row: WorkoutExerciseRow;
  sets: SetRow[];
  name: string;
  /** completed sets from the last finished session of this exercise */
  previous: SetRow[];
  edge: GroupEdge;
  isFirst: boolean;
  isLast: boolean;
  /** already in the same superset as the next card */
  linkedToNext: boolean;
  defaultRestS: number;
  onSetCompleted: (set: SetRow) => void;
  /** set id -> records it beats this session */
  prFlags?: Record<string, SetPrKind[]>;
  /** the set that just became a pr, to animate once */
  celebrate?: { setId: string; n: number } | null;
}

export function ExerciseCard(p: Props) {
  const c = useColors();
  const [menu, setMenu] = useState(false);
  const labels = setLabels(p.sets);
  const rest = p.row.restS ?? p.defaultRestS;

  // structural edits read sqlite, so debounced inputs land first
  const act = (fn: () => void) => () => {
    flushPendingWrites();
    fn();
  };

  const onRemove = () =>
    Alert.alert(`remove ${p.name.toLowerCase()}?`, p.sets.length ? "its sets are deleted too." : undefined, [
      { text: "cancel", style: "cancel" },
      { text: "remove", style: "destructive", onPress: act(() => removeExercise(p.workoutId, p.row.id)) },
    ]);

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: c.card, borderColor: c.border },
        p.edge.grouped && [styles.grouped, { borderLeftColor: c.accent }],
        p.edge.grouped && !p.edge.last && styles.groupedNotLast,
      ]}
    >
      {p.edge.first ? <Text style={[styles.superset, { color: c.accent }]}>superset</Text> : null}
      <View style={styles.head}>
        <Text style={[styles.exName, { color: c.accent }]} numberOfLines={2}>
          {p.name}
        </Text>
        <Pressable accessibilityLabel="exercise options" hitSlop={8} onPress={() => setMenu((m) => !m)} style={styles.more}>
          <Text style={[styles.moreText, { color: menu ? c.accent : c.muted }]}>•••</Text>
        </Pressable>
      </View>

      {menu ? (
        <View style={[styles.menu, { borderColor: c.border }]}>
          <View style={styles.menuRow}>
            {!p.isFirst ? <Chip text="move up" onPress={act(() => moveWorkoutExercise(p.workoutId, p.row.id, -1))} /> : null}
            {!p.isLast ? <Chip text="move down" onPress={act(() => moveWorkoutExercise(p.workoutId, p.row.id, 1))} /> : null}
            <Chip
              text="replace"
              onPress={act(() =>
                router.push({ pathname: "/add-exercise", params: { workoutId: p.workoutId, replace: p.row.id, current: p.row.exerciseId } })
              )}
            />
            {!p.isLast ? (
              p.linkedToNext ? (
                <Chip text="unlink next" onPress={act(() => unlinkFromNextExercise(p.workoutId, p.row.id))} />
              ) : (
                <Chip text="superset with next" onPress={act(() => linkWithNextExercise(p.workoutId, p.row.id))} />
              )
            ) : null}
            <Chip text="remove" danger onPress={onRemove} />
          </View>
          <View style={styles.menuRow}>
            <Text style={[styles.restText, { color: c.text }]}>
              rest {formatRest(rest)}
              {p.row.restS == null ? <Text style={{ color: c.muted }}> default</Text> : null}
            </Text>
            <Chip text={`-${REST_STEP_S}`} onPress={() => setExerciseRest(p.row.id, Math.max(0, rest - REST_STEP_S))} />
            <Chip text={`+${REST_STEP_S}`} onPress={() => setExerciseRest(p.row.id, rest + REST_STEP_S)} />
            {p.row.restS != null ? <Chip text="reset" onPress={() => setExerciseRest(p.row.id, null)} /> : null}
          </View>
        </View>
      ) : null}

      <View style={styles.colHeads}>
        <Text style={[styles.colHead, styles.colLabel, { color: c.muted }]}>set</Text>
        <Text style={[styles.colHead, styles.colKind, { color: c.muted }]}>type</Text>
        <Text style={[styles.colHead, styles.colFlex, { color: c.muted }]}>{p.sets[0]?.unit ?? "lb"}</Text>
        <Text style={[styles.colHead, styles.colFlex, { color: c.muted }]}>reps</Text>
        <Text style={[styles.colHead, styles.colDone, { color: c.muted }]}>done</Text>
      </View>
      {p.sets.map((s, i) => {
        // ghost text compares like for like: same position only
        const prev = p.previous[i];
        const kinds = p.prFlags?.[s.id];
        return (
          <View key={s.id}>
            <SetRowEditor
              set={s}
              label={labels[i]!}
              previous={prev ? formatPrevious(prev) : null}
              onCompleted={p.onSetCompleted}
            />
            {kinds ? <PrBadge kinds={kinds} celebrate={p.celebrate?.setId === s.id ? p.celebrate.n : 0} /> : null}
          </View>
        );
      })}
      <Button label="add set" variant="plain" onPress={act(() => addSet(p.row.id))} style={styles.addSet} />
    </View>
  );
}

function Chip({ text, onPress, danger }: { text: string; onPress: () => void; danger?: boolean }) {
  const c = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.chip, { backgroundColor: c.input, opacity: pressed ? 0.6 : 1 }]}
    >
      <Text style={[styles.chipText, { color: danger ? c.danger : c.text }]}>{text}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, paddingVertical: 10, gap: 4 },
  grouped: { borderLeftWidth: 3 },
  // pull the next card of the same superset up so the group reads as one block
  groupedNotLast: { marginBottom: -8 },
  superset: { fontSize: 11, fontWeight: "700", paddingHorizontal: 12, letterSpacing: 0.5 },
  head: { flexDirection: "row", alignItems: "center", paddingHorizontal: 12, marginBottom: 4, gap: 8 },
  exName: { flex: 1, fontSize: 16, fontWeight: "600" },
  more: { paddingHorizontal: 4 },
  moreText: { fontSize: 14, fontWeight: "700", letterSpacing: 1 },
  menu: { marginHorizontal: 12, marginBottom: 6, paddingTop: 6, borderTopWidth: StyleSheet.hairlineWidth, gap: 6 },
  menuRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 },
  restText: { fontSize: 14, fontVariant: ["tabular-nums"], marginRight: 4 },
  chip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  chipText: { fontSize: 13, fontWeight: "500" },
  colHeads: { flexDirection: "row", gap: 8, paddingHorizontal: 12 },
  colHead: { fontSize: 12, textAlign: "center" },
  colLabel: { width: 22 },
  colKind: { width: 30 },
  colFlex: { flex: 1 },
  colDone: { width: 30 + 8 + 18 },
  addSet: { marginHorizontal: 12, marginTop: 6, paddingVertical: 8 },
});
