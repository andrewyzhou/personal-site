import { useEffect, useMemo, useState } from "react";
import { Alert, ScrollView, StyleSheet, Text, View } from "react-native";
import { Stack, router, useLocalSearchParams } from "expo-router";
import {
  deleteCustomExercise,
  getCustomRow,
  getCustomUsage,
  lookupExercise,
  mergeCustomExercise,
  setCustomArchived,
  updateCustomExercise,
} from "../../db/exercises";
import { Button } from "../../components/Button";
import { CustomExerciseForm, type CustomExerciseValues } from "../../components/library/CustomExerciseForm";
import { PickerModal } from "../../components/library/PickerModal";
import { useColors } from "../../components/theme";
import { useDbVersion } from "../../components/useDbVersion";
import { customToExercise } from "../../lib/custom";

export default function EditCustomExercise() {
  const c = useColors();
  const { id } = useLocalSearchParams<{ id: string }>();
  const version = useDbVersion();
  const row = useMemo(() => (id ? getCustomRow(id) : undefined), [id, version]);
  const [value, setValue] = useState<CustomExerciseValues | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [merging, setMerging] = useState(false);

  // seed the form once per row id; later db bumps must not clobber typing
  useEffect(() => {
    if (!row) return;
    const e = customToExercise(row);
    setValue({ name: e.name, equipment: e.equipment, tracking: e.tracking, primary: e.primary, secondary: e.secondary });
  }, [row?.id]);

  if (!row || !value) {
    return (
      <View style={[styles.body, { backgroundColor: c.bg, flex: 1 }]}>
        <Text style={{ color: c.muted }}>exercise not found</Text>
      </View>
    );
  }

  const mergedTarget = row.mergedInto ? lookupExercise(row.mergedInto) : undefined;

  const save = () => {
    try {
      updateCustomExercise(row.id, value);
      router.back();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const remove = () => {
    const usage = getCustomUsage(row.id);
    if (usage.workoutExercises || usage.templateExercises) {
      const parts = [
        usage.workoutExercises ? `${usage.workoutExercises} workout entries` : "",
        usage.templateExercises ? `${usage.templateExercises} template entries` : "",
      ].filter(Boolean);
      return Alert.alert("in use", `used by ${parts.join(" and ")}. archive it instead?`, [
        { text: "cancel", style: "cancel" },
        ...(row.archived ? [] : [{ text: "archive", onPress: () => setCustomArchived(row.id, true) }]),
      ]);
    }
    Alert.alert("delete exercise?", row.name, [
      { text: "cancel", style: "cancel" },
      {
        text: "delete",
        style: "destructive",
        onPress: () => {
          deleteCustomExercise(row.id);
          router.back();
        },
      },
    ]);
  };

  return (
    <ScrollView style={{ backgroundColor: c.bg }} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: row.name }} />
      {mergedTarget ? (
        <Text style={{ color: c.muted }}>
          merged into{" "}
          <Text
            style={{ color: c.accent }}
            onPress={() => router.push({ pathname: "/exercises/[id]", params: { id: mergedTarget.id } })}
          >
            {mergedTarget.name}
          </Text>
        </Text>
      ) : row.archived ? (
        <Text style={{ color: c.muted }}>archived · hidden from search</Text>
      ) : null}
      <CustomExerciseForm
        value={value}
        onChange={(v) => {
          setValue(v);
          setError(null);
        }}
      />
      {error ? <Text style={{ color: c.danger }}>{error}</Text> : null}
      <Button label="save" onPress={save} />
      {!row.mergedInto ? (
        <>
          <Button
            label={row.archived ? "unarchive" : "archive"}
            variant="plain"
            onPress={() => setCustomArchived(row.id, !row.archived)}
          />
          <Button label="merge into…" variant="plain" onPress={() => setMerging(true)} />
        </>
      ) : null}
      <Button label="delete" variant="danger" onPress={remove} />
      <PickerModal
        visible={merging}
        title={`merge ${row.name} into`}
        excludeIds={[row.id]}
        onClose={() => setMerging(false)}
        onSelect={(target) => {
          Alert.alert(
            "merge?",
            `workouts and templates using "${row.name}" will use "${target.name}". "${row.name}" is archived.`,
            [
              { text: "cancel", style: "cancel" },
              {
                text: "merge",
                style: "destructive",
                onPress: () => {
                  const result = mergeCustomExercise(row.id, target.id);
                  setMerging(false);
                  if (!result.ok) Alert.alert("can't merge", result.error);
                },
              },
            ]
          );
        }}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  body: { padding: 16, gap: 12, paddingBottom: 48 },
});
