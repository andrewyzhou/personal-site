import { useCallback, useMemo, useState } from "react";
import { FlatList, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { MUSCLE_REGIONS, MUSCLE_REGION_LABELS, nlSearchExercises, type Exercise } from "lift-core";
import { getCatalog, getUsageCounts, listCustomRows } from "../db/exercises";
import { isCustomId } from "../lib/custom";
import { formatList, humanize } from "../lib/format";
import { equipmentInUse, filterKey, matchesFilter, type ExerciseFilter } from "../lib/library";
import { Chip } from "./library/Chip";
import { useColors } from "./theme";
import { useDbVersion } from "./useDbVersion";

interface Props {
  onSelect: (exercise: Exercise) => void;
  autoFocus?: boolean;
  /** filter chips (all / custom / muscle / equipment) and the archived toggle */
  showFilters?: boolean;
  /** ids to leave out, e.g. the exercise being merged */
  excludeIds?: readonly string[];
  /** shows a "new exercise" row above the results */
  onCreate?: () => void;
  onLongPress?: (exercise: Exercise) => void;
}

const ALL: ExerciseFilter = { kind: "all" };

/** search + results list, shared by the exercises tab and the add-exercise modal */
export function ExercisePicker({ onSelect, autoFocus, showFilters, excludeIds, onCreate, onLongPress }: Props) {
  const c = useColors();
  const version = useDbVersion();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ExerciseFilter>(ALL);
  const [showArchived, setShowArchived] = useState(false);
  const [usage, setUsage] = useState<Record<string, number>>({});
  const [focusTick, setFocusTick] = useState(0);

  // re-read on focus: counts change after every workout
  useFocusEffect(
    useCallback(() => {
      setUsage(getUsageCounts());
      setFocusTick((n) => n + 1);
    }, [])
  );

  const { catalog, archivedIds } = useMemo(() => {
    const rows = listCustomRows();
    const archived = new Set(rows.filter((r) => r.archived && !r.mergedInto).map((r) => r.id));
    return { catalog: getCatalog({ includeArchived: showArchived }), archivedIds: archived };
    // version: a create/edit/merge elsewhere changes the custom rows
  }, [showArchived, version, focusTick]);

  const equipment = useMemo(() => (showFilters ? equipmentInUse(catalog) : []), [catalog, showFilters]);

  const results = useMemo(() => {
    const excluded = new Set(excludeIds ?? []);
    const keep = (e: Exercise) => !excluded.has(e.id) && matchesFilter(e, filter);
    if (query.trim()) {
      // a filter can drop most hits, so search wider before filtering
      const limit = filter.kind === "all" && !excluded.size ? 50 : 500;
      // reads "cable shoulders" or "back no equipment" as filters, plain names as before
      return nlSearchExercises(query, { limit, usage, catalog })
        .map((r) => r.exercise)
        .filter(keep)
        .slice(0, 50);
    }
    // empty query: most used first, then alphabetical
    return catalog
      .filter(keep)
      .sort((a, b) => (usage[b.id] ?? 0) - (usage[a.id] ?? 0) || a.name.localeCompare(b.name));
  }, [query, usage, catalog, filter, excludeIds]);

  const chips: { f: ExerciseFilter; label: string }[] = showFilters
    ? [
        { f: ALL, label: "all" },
        { f: { kind: "custom" }, label: "custom" },
        ...MUSCLE_REGIONS.map((region) => ({ f: { kind: "region", region } as ExerciseFilter, label: MUSCLE_REGION_LABELS[region] })),
        ...equipment.map((eq) => ({ f: { kind: "equipment", equipment: eq } as ExerciseFilter, label: humanize(eq) })),
      ]
    : [];
  const activeKey = filterKey(filter);

  return (
    <View style={styles.flex}>
      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder="search, e.g. cable shoulders"
        placeholderTextColor={c.muted}
        autoFocus={autoFocus}
        autoCorrect={false}
        autoCapitalize="none"
        clearButtonMode="while-editing"
        returnKeyType="search"
        style={[styles.search, { backgroundColor: c.input, color: c.text }]}
      />
      {showFilters ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          style={styles.chipScroll}
          contentContainerStyle={styles.chips}
        >
          {archivedIds.size ? (
            <Chip label="archived" selected={showArchived} onPress={() => setShowArchived((v) => !v)} />
          ) : null}
          {chips.map(({ f, label }) => {
            const key = filterKey(f);
            return <Chip key={key} label={label} selected={key === activeKey} onPress={() => setFilter(key === activeKey ? ALL : f)} />;
          })}
        </ScrollView>
      ) : null}
      <FlatList
        data={results}
        keyExtractor={(e) => e.id}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        ListHeaderComponent={
          onCreate ? (
            <Pressable onPress={onCreate} style={({ pressed }) => [styles.row, { opacity: pressed ? 0.6 : 1 }]}>
              <Text style={[styles.name, { color: c.accent }]}>+ new exercise</Text>
            </Pressable>
          ) : undefined
        }
        ItemSeparatorComponent={() => <View style={[styles.sep, { backgroundColor: c.border }]} />}
        ListEmptyComponent={<Text style={[styles.empty, { color: c.muted }]}>no matches</Text>}
        renderItem={({ item }) => (
          <Pressable
            onPress={() => onSelect(item)}
            onLongPress={onLongPress ? () => onLongPress(item) : undefined}
            style={({ pressed }) => [styles.row, { opacity: pressed ? 0.6 : 1 }]}
          >
            <Text style={[styles.name, { color: archivedIds.has(item.id) ? c.muted : c.text }]}>{item.name}</Text>
            <Text style={[styles.meta, { color: c.muted }]} numberOfLines={1}>
              {humanize(item.equipment)}
              {item.primary.length ? ` · ${formatList(item.primary)}` : ""}
              {usage[item.id] ? ` · ${usage[item.id]} sets` : ""}
              {isCustomId(item.id) ? " · custom" : ""}
              {archivedIds.has(item.id) ? " · archived" : ""}
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
  chipScroll: { flexGrow: 0 },
  chips: { paddingHorizontal: 12, paddingBottom: 8, gap: 6 },
  row: { paddingHorizontal: 16, paddingVertical: 12 },
  name: { fontSize: 16, fontWeight: "500" },
  meta: { fontSize: 13, marginTop: 2 },
  sep: { height: StyleSheet.hairlineWidth, marginLeft: 16 },
  empty: { textAlign: "center", marginTop: 32 },
});
