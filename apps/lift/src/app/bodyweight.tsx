import { useMemo, useState } from "react";
import { Alert, FlatList, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Stack } from "expo-router";
import type { WeightUnit } from "lift-core";
import { addBodyweight, deleteBodyweight, getPreferredUnit, listBodyweights } from "../db/bodyweight";
import { Button } from "../components/Button";
import { Chip } from "../components/library/Chip";
import { TrendLine } from "../components/library/TrendLine";
import { useColors } from "../components/theme";
import { useDbVersion } from "../components/useDbVersion";
import { MAX_NOTE_LENGTH } from "../lib/numbers";
import { convertWeight, formatWeight, parseBodyweight, parseDateInput, toDateInput } from "../lib/bodyweight";

const TREND_POINTS = 60;

export default function Bodyweight() {
  const c = useColors();
  const version = useDbVersion();
  const entries = useMemo(() => listBodyweights(), [version]);
  const preferred = useMemo(() => getPreferredUnit(), [version]);
  const [unit, setUnit] = useState<WeightUnit>(preferred);
  const [weight, setWeight] = useState("");
  const [date, setDate] = useState(() => toDateInput(Date.now()));
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  const trend = entries.slice(0, TREND_POINTS);
  const latest = entries[0];

  const add = () => {
    const now = Date.now();
    const w = parseBodyweight(weight);
    if (w === null) return setError("enter a weight");
    const at = parseDateInput(date, now);
    if (at === null) return setError("date must be yyyy-mm-dd, not in the future");
    addBodyweight({ weight: w, unit, measuredAt: at, note }, now);
    setWeight("");
    setNote("");
    setDate(toDateInput(now));
    setError(null);
  };

  const remove = (id: string, label: string) =>
    Alert.alert("delete entry?", label, [
      { text: "cancel", style: "cancel" },
      { text: "delete", style: "destructive", onPress: () => deleteBodyweight(id) },
    ]);

  const header = (
    <View style={styles.form}>
      <View style={styles.row}>
        <TextInput
          value={weight}
          onChangeText={(t) => {
            setWeight(t);
            setError(null);
          }}
          placeholder="weight"
          placeholderTextColor={c.muted}
          keyboardType="decimal-pad"
          style={[styles.input, styles.flex, { backgroundColor: c.input, color: c.text }]}
        />
        <Chip label="lb" selected={unit === "lb"} onPress={() => setUnit("lb")} />
        <Chip label="kg" selected={unit === "kg"} onPress={() => setUnit("kg")} />
      </View>
      <TextInput
        value={date}
        onChangeText={(t) => {
          setDate(t);
          setError(null);
        }}
        placeholder="yyyy-mm-dd"
        placeholderTextColor={c.muted}
        autoCorrect={false}
        style={[styles.input, { backgroundColor: c.input, color: c.text }]}
      />
      <TextInput
        value={note}
        onChangeText={setNote}
        maxLength={MAX_NOTE_LENGTH}
        placeholder="note"
        placeholderTextColor={c.muted}
        style={[styles.input, { backgroundColor: c.input, color: c.text }]}
      />
      {error ? <Text style={{ color: c.danger }}>{error}</Text> : null}
      <Button label="add" onPress={add} />
      {latest ? (
        <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
          <Text style={{ color: c.muted }}>
            latest {formatWeight(convertWeight(latest.weight, latest.unit, preferred))} {preferred}
          </Text>
          <TrendLine entries={trend} unit={preferred} />
        </View>
      ) : null}
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <Stack.Screen options={{ title: "bodyweight" }} />
      <FlatList
        data={entries}
        keyExtractor={(e) => e.id}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={header}
        ListEmptyComponent={<Text style={[styles.empty, { color: c.muted }]}>no entries yet</Text>}
        ItemSeparatorComponent={() => <View style={[styles.sep, { backgroundColor: c.border }]} />}
        renderItem={({ item }) => {
          const label = `${formatWeight(item.weight)} ${item.unit}`;
          return (
            <View style={styles.item}>
              <View style={styles.flex}>
                <Text style={{ color: c.text, fontSize: 16 }}>{label}</Text>
                <Text style={{ color: c.muted, fontSize: 13 }} numberOfLines={1}>
                  {new Date(item.measuredAt).toLocaleDateString()}
                  {item.note ? ` · ${item.note}` : ""}
                </Text>
              </View>
              <Pressable onPress={() => remove(item.id, label)} hitSlop={12} accessibilityLabel="delete entry">
                <Text style={{ color: c.danger }}>delete</Text>
              </Pressable>
            </View>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  form: { padding: 16, gap: 10 },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  flex: { flex: 1 },
  input: { paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10, fontSize: 16 },
  card: { padding: 12, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, gap: 8, marginTop: 6 },
  item: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 12, gap: 12 },
  sep: { height: StyleSheet.hairlineWidth, marginLeft: 16 },
  empty: { textAlign: "center", marginTop: 24 },
});
