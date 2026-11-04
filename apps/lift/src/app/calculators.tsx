import { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Stack } from "expo-router";
import { platesFor, warmupSets, type PlateResult, type WarmupSet, type WeightUnit } from "lift-core";
import { getUnit } from "../db/history";
import { round } from "../components/charts/units";
import { useColors, type Palette } from "../components/theme";
import { parseDecimal } from "../lib/numbers";

const DEFAULT_BAR: Record<WeightUnit, string> = { lb: "45", kg: "20" };

function safe<T>(fn: () => T): T | null {
  try {
    return fn();
  } catch {
    return null;
  }
}

function UnitToggle({ unit, onChange, c }: { unit: WeightUnit; onChange: (u: WeightUnit) => void; c: Palette }) {
  return (
    <View style={styles.toggle}>
      {(["lb", "kg"] as const).map((u) => (
        <Pressable
          key={u}
          onPress={() => onChange(u)}
          style={[styles.toggleItem, { backgroundColor: u === unit ? c.accent : c.input }]}
        >
          <Text style={{ color: u === unit ? c.accentText : c.text, fontWeight: "600" }}>{u}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function Field(props: { label: string; value: string; onChange: (s: string) => void; c: Palette }) {
  const { c } = props;
  return (
    <View style={styles.field}>
      <Text style={[styles.label, { color: c.muted }]}>{props.label}</Text>
      <TextInput
        value={props.value}
        onChangeText={props.onChange}
        keyboardType="decimal-pad"
        selectTextOnFocus
        style={[styles.input, { backgroundColor: c.input, color: c.text }]}
      />
    </View>
  );
}

// plate sizes get a height so the stack reads like a loaded sleeve
function chipHeight(plate: number, unit: WeightUnit): number {
  const kg = unit === "kg" ? plate : plate / 2.2046226218;
  return 22 + Math.min(1, kg / 25) * 34;
}

export default function Calculators() {
  const c = useColors();
  const [unit, setUnit] = useState<WeightUnit>(() => safe(getUnit) ?? "lb");
  const [target, setTarget] = useState("");
  const [bar, setBar] = useState(DEFAULT_BAR[unit]);
  const [working, setWorking] = useState("");

  const changeUnit = (u: WeightUnit) => {
    setUnit(u);
    setBar(DEFAULT_BAR[u]);
  };

  const barN = parseDecimal(bar);
  const targetN = parseDecimal(target);
  const workingN = parseDecimal(working);
  const opts = barN !== null && barN >= 0 ? { bar: barN } : {};

  const plates: PlateResult | null = useMemo(
    () => (targetN !== null && targetN > 0 ? safe(() => platesFor(targetN, unit, opts)) : null),
    [targetN, unit, barN]
  );
  const warmups: WarmupSet[] | null = useMemo(
    () => (workingN !== null && workingN > 0 ? safe(() => warmupSets(workingN, unit, opts)) : null),
    [workingN, unit, barN]
  );

  return (
    <ScrollView style={{ backgroundColor: c.bg }} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: "calculators" }} />
      <UnitToggle unit={unit} onChange={changeUnit} c={c} />

      <Text style={[styles.section, { color: c.text }]}>plates</Text>
      <View style={styles.fields}>
        <Field label={`target (${unit})`} value={target} onChange={setTarget} c={c} />
        <Field label={`bar (${unit})`} value={bar} onChange={setBar} c={c} />
      </View>
      {plates ? (
        <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
          <Text style={{ color: c.muted }}>per side</Text>
          {plates.perSide.length === 0 ? (
            <Text style={{ color: c.text }}>just the bar</Text>
          ) : (
            <View style={styles.stack}>
              {plates.perSide.map((p, i) => (
                <View
                  key={i}
                  style={[styles.chip, { backgroundColor: c.accent, height: chipHeight(p, unit) }]}
                >
                  <Text style={[styles.chipText, { color: c.accentText }]}>{round(p, 2)}</Text>
                </View>
              ))}
            </View>
          )}
          <Text style={{ color: c.text }}>
            {round(plates.achieved, 2)} {unit}
            {plates.remainder > 0 ? `  ·  ${round(plates.remainder, 2)} ${unit} short` : ""}
          </Text>
        </View>
      ) : null}

      <Text style={[styles.section, { color: c.text }]}>warm-up</Text>
      <Field label={`working weight (${unit})`} value={working} onChange={setWorking} c={c} />
      {warmups ? (
        <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
          {warmups.length === 0 ? <Text style={{ color: c.muted }}>no warm-up needed</Text> : null}
          {warmups.map((w, i) => (
            <View key={i} style={styles.warmRow}>
              <Text style={{ color: c.muted, width: 48 }}>{Math.round(w.pct * 100)}%</Text>
              <Text style={{ color: c.text, flex: 1 }}>
                {round(w.weight, 2)} {unit} × {w.reps}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  body: { padding: 16, paddingBottom: 48, gap: 8 },
  section: { fontSize: 17, fontWeight: "600", marginTop: 16 },
  toggle: { flexDirection: "row", gap: 8 },
  toggleItem: { paddingVertical: 8, paddingHorizontal: 18, borderRadius: 8 },
  fields: { flexDirection: "row", gap: 12 },
  field: { flex: 1, gap: 4 },
  label: { fontSize: 13 },
  input: { fontSize: 18, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 8 },
  card: { padding: 14, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, gap: 8, marginTop: 4 },
  stack: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 4 },
  chip: { minWidth: 34, paddingHorizontal: 6, borderRadius: 6, alignItems: "center", justifyContent: "center" },
  chipText: { fontSize: 13, fontWeight: "700" },
  warmRow: { flexDirection: "row" },
});
