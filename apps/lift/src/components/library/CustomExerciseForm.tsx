import { StyleSheet, Text, TextInput, View } from "react-native";
import { MUSCLE_REGIONS, MUSCLE_REGION_LABELS, type Equipment, type MuscleRegion, type TrackingType } from "lift-core";
import { humanize } from "../../lib/format";
import { EQUIPMENT_OPTIONS, TRACKING_OPTIONS, toggleRegion } from "../../lib/library";
import { useColors } from "../theme";
import { Chip } from "./Chip";

export interface CustomExerciseValues {
  name: string;
  equipment: Equipment;
  tracking: TrackingType;
  primary: MuscleRegion[];
  secondary: MuscleRegion[];
}

export const EMPTY_CUSTOM: CustomExerciseValues = {
  name: "",
  equipment: "other",
  tracking: "weight_reps",
  primary: [],
  secondary: [],
};

interface Props {
  value: CustomExerciseValues;
  onChange: (value: CustomExerciseValues) => void;
  autoFocus?: boolean;
}

export function CustomExerciseForm({ value, onChange, autoFocus }: Props) {
  const c = useColors();
  const set = (patch: Partial<CustomExerciseValues>) => onChange({ ...value, ...patch });
  return (
    <View style={styles.gap}>
      <Text style={[styles.label, { color: c.muted }]}>name</Text>
      <TextInput
        value={value.name}
        onChangeText={(name) => set({ name })}
        autoFocus={autoFocus}
        placeholder="e.g. landmine press"
        placeholderTextColor={c.muted}
        style={[styles.input, { backgroundColor: c.input, color: c.text }]}
      />
      <Text style={[styles.label, { color: c.muted }]}>equipment</Text>
      <View style={styles.wrap}>
        {EQUIPMENT_OPTIONS.map((e) => (
          <Chip key={e} label={humanize(e)} selected={value.equipment === e} onPress={() => set({ equipment: e })} />
        ))}
      </View>
      <Text style={[styles.label, { color: c.muted }]}>tracking</Text>
      <View style={styles.wrap}>
        {TRACKING_OPTIONS.map((t) => (
          <Chip key={t} label={humanize(t)} selected={value.tracking === t} onPress={() => set({ tracking: t })} />
        ))}
      </View>
      <Text style={[styles.label, { color: c.muted }]}>primary muscles</Text>
      <View style={styles.wrap}>
        {MUSCLE_REGIONS.map((r) => (
          <Chip
            key={r}
            label={MUSCLE_REGION_LABELS[r]}
            selected={value.primary.includes(r)}
            onPress={() => {
              const next = toggleRegion(value.primary, value.secondary, r);
              set({ primary: next.list, secondary: next.other });
            }}
          />
        ))}
      </View>
      <Text style={[styles.label, { color: c.muted }]}>secondary muscles</Text>
      <View style={styles.wrap}>
        {MUSCLE_REGIONS.map((r) => (
          <Chip
            key={r}
            label={MUSCLE_REGION_LABELS[r]}
            selected={value.secondary.includes(r)}
            onPress={() => {
              const next = toggleRegion(value.secondary, value.primary, r);
              set({ secondary: next.list, primary: next.other });
            }}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  gap: { gap: 8 },
  label: { fontSize: 13, marginTop: 8 },
  input: { paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10, fontSize: 16 },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
});
