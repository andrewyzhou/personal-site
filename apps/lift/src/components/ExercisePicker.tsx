import { useCallback, useMemo, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { searchExercises, type Exercise } from "lift-core";
import { getCatalog, getUsageCounts } from "../db/exercises";
import { formatList, humanize } from "../lib/format";
import { useColors } from "./theme";

interface Props {
  onSelect: (exercise: Exercise) => void;
  autoFocus?: boolean;
}

/** search + results list, shared by the exercises tab and the add-exercise modal */
export function ExercisePicker({ onSelect, autoFocus }: Props) {
  const c = useColors();
  const [query, setQuery] = useState("");
  const [usage, setUsage] = useState<Record<string, number>>({});
  const [catalog, setCatalog] = useState<readonly Exercise[]>([]);

  // re-read on focus: counts change after every workout
  useFocusEffect(
    useCallback(() => {
      setUsage(getUsageCounts());
      setCatalog(getCatalog());
    }, [])
  );

  const results = useMemo(() => {
    if (query.trim()) {
      return searchExercises(query, { limit: 50, usage, catalog }).map((r) => r.exercise);
    }
    // empty query: most used first, then alphabetical
    return [...catalog].sort((a, b) => (usage[b.id] ?? 0) - (usage[a.id] ?? 0) || a.name.localeCompare(b.name));
  }, [query, usage, catalog]);

  return (
    <View style={styles.flex}>
      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder="search"
        placeholderTextColor={c.muted}
        autoFocus={autoFocus}
        autoCorrect={false}
        autoCapitalize="none"
        clearButtonMode="while-editing"
        returnKeyType="search"
        style={[styles.search, { backgroundColor: c.input, color: c.text }]}
      />
      <FlatList
        data={results}
        keyExtractor={(e) => e.id}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        ItemSeparatorComponent={() => <View style={[styles.sep, { backgroundColor: c.border }]} />}
        ListEmptyComponent={<Text style={[styles.empty, { color: c.muted }]}>no matches</Text>}
        renderItem={({ item }) => (
          <Pressable
            onPress={() => onSelect(item)}
            style={({ pressed }) => [styles.row, { opacity: pressed ? 0.6 : 1 }]}
          >
            <Text style={[styles.name, { color: c.text }]}>{item.name}</Text>
            <Text style={[styles.meta, { color: c.muted }]} numberOfLines={1}>
              {humanize(item.equipment)}
              {item.primary.length ? ` · ${formatList(item.primary)}` : ""}
              {usage[item.id] ? ` · ${usage[item.id]} sets` : ""}
            </Text>
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  search: { margin: 12, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10, fontSize: 16 },
  row: { paddingHorizontal: 16, paddingVertical: 12 },
  name: { fontSize: 16, fontWeight: "500" },
  meta: { fontSize: 13, marginTop: 2 },
  sep: { height: StyleSheet.hairlineWidth, marginLeft: 16 },
  empty: { textAlign: "center", marginTop: 32 },
});
