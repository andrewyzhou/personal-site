import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import * as Haptics from "expo-haptics";
import type { SetRow } from "../db/schema";
import { deleteSet, toggleComplete, updateSet, type SetPatch } from "../db/workouts";
import { createDebouncedCommit, type DebouncedCommit } from "../lib/debounce";
import { formatCount, formatDecimal, parseCount, parseDecimal } from "../lib/numbers";
import { flushPendingWrites, registerFlush } from "../lib/pending";
import { KIND_LABEL, RPE_VALUES, formatRpe, nextKind } from "../lib/sets";
import { useColors } from "./theme";

interface Props {
  set: SetRow;
  label: string;
  /** ghost text from the last finished session, e.g. "185×5" */
  previous?: string | null;
  /** called after the set was checked complete (not when unchecked) */
  onCompleted?: (set: SetRow) => void;
}

type Field = "weight" | "reps" | "note";

/**
 * one set line. inputs keep their own text (so "22," survives while typing)
 * and write the parsed value to sqlite through a 300ms debounce, flushed on
 * blur, on unmount and before any structural action. tapping the set number
 * opens rpe and a note.
 */
export function SetRowEditor({ set, label, previous, onCompleted }: Props) {
  const c = useColors();
  const [weight, setWeight] = useState(() => formatDecimal(set.weight));
  const [reps, setReps] = useState(() => formatCount(set.reps));
  const [note, setNote] = useState(() => set.note ?? "");
  const [open, setOpen] = useState(false);

  const commits = useRef<Record<Field, DebouncedCommit<string>> | null>(null);
  if (!commits.current) {
    const save = (patch: SetPatch) => updateSet(set.id, patch);
    commits.current = {
      weight: createDebouncedCommit((t) => save({ weight: parseDecimal(t) })),
      reps: createDebouncedCommit((t) => save({ reps: parseCount(t) })),
      note: createDebouncedCommit((t) => save({ note: t.trim() ? t : null })),
    };
  }

  useEffect(() => {
    const cm = commits.current!;
    const flush = () => {
      cm.weight.flush();
      cm.reps.flush();
      cm.note.flush();
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
    const row = toggleComplete(set.id);
    if (row?.completed) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
      onCompleted?.(row);
    }
  };

  const onDelete = () => {
    for (const cm of Object.values(commits.current!)) cm.cancel();
    deleteSet(set.id);
  };

  const inputStyle = [styles.input, { backgroundColor: c.input, color: c.text }];
  const extras = [previous ? `prev ${previous}` : null, set.rpe != null ? `rpe ${formatRpe(set.rpe)}` : null, set.note ? "note" : null]
    .filter(Boolean)
    .join(" · ");

  return (
    <View style={[styles.wrap, done && { backgroundColor: c.done }]}>
      <View style={styles.row}>
        <Pressable accessibilityLabel={`set ${label} details`} onPress={() => setOpen((o) => !o)} hitSlop={6} style={styles.labelBox}>
          <Text style={[styles.label, { color: open ? c.accent : c.muted }]}>{label}</Text>
        </Pressable>
        <Pressable
          accessibilityLabel={`set type ${set.kind}`}
          onPress={() => updateSet(set.id, { kind: nextKind(set.kind) })}
          style={[styles.kind, { borderColor: c.border }]}
        >
          <Text style={[styles.kindText, { color: set.kind === "normal" ? c.muted : c.accent }]}>{KIND_LABEL[set.kind]}</Text>
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

      {extras && !open ? (
        <Pressable onPress={() => setOpen(true)} style={styles.extras}>
          <Text style={[styles.extrasText, { color: c.muted }]} numberOfLines={1}>
            {extras}
          </Text>
        </Pressable>
      ) : null}

      {open ? (
        <View style={styles.detail}>
          {previous ? <Text style={[styles.extrasText, { color: c.muted }]}>prev {previous}</Text> : null}
          <View style={styles.chips}>
            <Text style={[styles.chipLabel, { color: c.muted }]}>rpe</Text>
            {RPE_VALUES.map((v) => {
              const on = set.rpe === v;
              return (
                <Pressable
                  key={v}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  // tapping the selected value clears it
                  onPress={() => updateSet(set.id, { rpe: on ? null : v })}
                  style={[styles.chip, { borderColor: on ? c.accent : c.border, backgroundColor: on ? c.accent : "transparent" }]}
                >
                  <Text style={[styles.chipText, { color: on ? c.accentText : c.text }]}>{formatRpe(v)}</Text>
                </Pressable>
              );
            })}
          </View>
          <TextInput
            value={note}
            onChangeText={(t) => {
              setNote(t);
              commits.current!.note.set(t);
            }}
            onBlur={() => commits.current!.note.flush()}
            placeholder="note"
            placeholderTextColor={c.muted}
            multiline
            style={[styles.note, { backgroundColor: c.input, color: c.text }]}
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { borderRadius: 8, paddingVertical: 2 },
  row: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 4 },
  labelBox: { width: 22, alignItems: "center" },
  label: { fontVariant: ["tabular-nums"], fontWeight: "600" },
  kind: { width: 30, height: 30, borderRadius: 6, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  kindText: { fontWeight: "700" },
  input: { flex: 1, paddingVertical: 6, paddingHorizontal: 8, borderRadius: 6, fontSize: 16, textAlign: "center" },
  check: { width: 30, height: 30, borderRadius: 6, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  checkText: { fontWeight: "700" },
  del: { width: 18, alignItems: "center" },
  extras: { paddingLeft: 12 + 22 + 8, paddingRight: 12, paddingBottom: 2 },
  extrasText: { fontSize: 12 },
  detail: { paddingLeft: 12 + 22 + 8, paddingRight: 12, paddingBottom: 6, gap: 6 },
  chips: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 4 },
  chipLabel: { fontSize: 12, marginRight: 2 },
  chip: { minWidth: 30, paddingHorizontal: 5, paddingVertical: 4, borderRadius: 6, borderWidth: 1, alignItems: "center" },
  chipText: { fontSize: 12, fontVariant: ["tabular-nums"] },
  note: { paddingVertical: 6, paddingHorizontal: 8, borderRadius: 6, fontSize: 14, minHeight: 32 },
});
