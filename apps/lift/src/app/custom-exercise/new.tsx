import { useState } from "react";
import { Alert, ScrollView, StyleSheet, Text } from "react-native";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { checkNewCustomName, createCustomExercise } from "../../db/exercises";
import { Button } from "../../components/Button";
import { CustomExerciseForm, EMPTY_CUSTOM, type CustomExerciseValues } from "../../components/library/CustomExerciseForm";
import { useColors } from "../../components/theme";

export default function NewCustomExercise() {
  const c = useColors();
  const params = useLocalSearchParams<{ name?: string }>();
  const [value, setValue] = useState<CustomExerciseValues>({ ...EMPTY_CUSTOM, name: params.name ?? "" });
  const [error, setError] = useState<string | null>(null);

  const openCustom = (id: string) => router.replace({ pathname: "/custom-exercise/[id]", params: { id } });

  const create = () => {
    try {
      const result = createCustomExercise(value);
      if (result.status === "exists") return openCustom(result.row.id);
      router.back();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const save = () => {
    const check = checkNewCustomName(value.name);
    if (check.error || !check.name) return setError(check.error ?? "name is required");
    if (check.existing) {
      // same name-derived id: reuse the row rather than make a second one
      const ex = check.existing;
      const state = ex.mergedInto ? " (merged)" : ex.archived ? " (archived)" : "";
      return Alert.alert("already exists", `"${ex.name}"${state} has this name.`, [
        { text: "cancel", style: "cancel" },
        { text: "open it", onPress: () => openCustom(ex.id) },
      ]);
    }
    if (check.catalog) {
      const cat = check.catalog;
      return Alert.alert("in the catalog", `this matches "${cat.name}". using it keeps history in one place.`, [
        { text: "cancel", style: "cancel" },
        { text: `use ${cat.name}`, onPress: () => router.replace({ pathname: "/exercises/[id]", params: { id: cat.id } }) },
        { text: "create anyway", onPress: create },
      ]);
    }
    if (check.sameName) {
      const same = check.sameName;
      return Alert.alert("name in use", `another custom exercise is called "${same.name}".`, [
        { text: "cancel", style: "cancel" },
        { text: "open it", onPress: () => openCustom(same.id) },
        { text: "create anyway", onPress: create },
      ]);
    }
    create();
  };

  return (
    <ScrollView style={{ backgroundColor: c.bg }} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: "new exercise" }} />
      <CustomExerciseForm
        value={value}
        onChange={(v) => {
          setValue(v);
          setError(null);
        }}
        autoFocus={!params.name}
      />
      {error ? <Text style={{ color: c.danger }}>{error}</Text> : null}
      <Button label="create" onPress={save} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  body: { padding: 16, gap: 16, paddingBottom: 48 },
});
