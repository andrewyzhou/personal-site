import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import type { SetRow } from "../db/schema";
import { deleteSet, toggleComplete, updateSet, type SetPatch } from "../db/workouts";
import { createDebouncedCommit, type DebouncedCommit } from "../lib/debounce";
import { formatCount, formatDecimal, parseCount, parseDecimal } from "../lib/numbers";
import { flushPendingWrites, registerFlush } from "../lib/pending";
import { KIND_LABEL, nextKind } from "../lib/sets";
import { useColors } from "./theme";

interface Props {
  set: SetRow;
  label: string;
}

/**
 * one set line. inputs keep their own text (so "22," survives while typing)
 * and write the parsed value to sqlite through a 300ms debounce, flushed on
 * blur, on unmount and before any structural action.
 */
export function SetRowEditor({ set, label }: Props) {
  const c = useColors();
  const [weight, setWeight] = useState(() => formatDecimal(set.weight));
  const [reps, setReps] = useState(() => formatCount(set.reps));

  const commits = useRef<{ weight: DebouncedCommit<string>; reps: DebouncedCommit<string> } | null>(null);
  if (!commits.current) {
    const save = (patch: SetPatch) => updateSet(set.id, patch);
    commits.current = {
      weight: createDebouncedCommit((t) => save({ weight: parseDecimal(t) })),
      reps: createDebouncedCommit((t) => save({ reps: parseCount(t) })),
    };
  }

  useEffect(() => {
    const cm = commits.current!;
    const flush = () => {
      cm.weight.flush();
      cm.reps.flush();
    };
    const unregister = registerFlush(flush);
    return () => {
      unregister();
      flush();
    };
  }, []);

  const done = Boolean(set.completed);

  const onToggleDone = () => {
    flushPendingWrites();
    toggleComplete(set.id);
  };

  const onDelete = () => {
    commits.current!.weight.cancel();
    commits.current!.reps.cancel();
    deleteSet(set.id);
  };

  const inputStyle = [styles.input, { backgroundColor: c.input, color: c.text }];

  return (
    <View style={[styles.row, done && { backgroundColor: c.done }]}>
      <Text style={[styles.label, { color: c.muted }]}>{label}</Text>
      <Pressable
        accessibilityLabel={`set type ${set.kind}`}
        onPress={() => updateSet(set.id, { kind: nextKind(set.kind) })}
        style={[styles.kind, { borderColor: c.border }]}
      >
        <Text style={[styles.kindText, { color: set.kind === "normal" ? c.muted : c.accent }]}>
          {KIND_LABEL[set.kind]}
        </Text>
      </Pressable>
      <TextInput
        value={weight}
        onChangeText={(t) => {
          setWeight(t);
          commits.current!.weight.set(t);
        }}
        onBlur={() => commits.current!.weight.flush()}
        keyboardType="decimal-pad"
        placeholder={set.unit}
        placeholderTextColor={c.muted}
        selectTextOnFocus
        style={inputStyle}
      />
      <TextInput
        value={reps}
        onChangeText={(t) => {
          setReps(t);
          commits.current!.reps.set(t);
        }}
        onBlur={() => commits.current!.reps.flush()}
        keyboardType="number-pad"
        placeholder="reps"
        placeholderTextColor={c.muted}
        selectTextOnFocus
        style={inputStyle}
      />
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: done }}
        onPress={onToggleDone}
        style={[styles.check, { borderColor: done ? c.accent : c.border, backgroundColor: done ? c.accent : "transparent" }]}
      >
        <Text style={[styles.checkText, { color: c.accentText }]}>{done ? "✓" : ""}</Text>
      </Pressable>
      <Pressable accessibilityLabel="delete set" onPress={onDelete} hitSlop={8} style={styles.del}>
        <Text style={{ color: c.muted }}>×</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  label: { width: 22, textAlign: "center", fontVariant: ["tabular-nums"] },
  kind: { width: 30, height: 30, borderRadius: 6, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  kindText: { fontWeight: "700" },
  input: { flex: 1, paddingVertical: 6, paddingHorizontal: 8, borderRadius: 6, fontSize: 16, textAlign: "center" },
  check: { width: 30, height: 30, borderRadius: 6, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  checkText: { fontWeight: "700" },
  del: { width: 18, alignItems: "center" },
});
