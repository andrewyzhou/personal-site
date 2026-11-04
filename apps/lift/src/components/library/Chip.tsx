import { Pressable, StyleSheet, Text } from "react-native";
import { useColors } from "../theme";

interface Props {
  label: string;
  selected?: boolean;
  onPress: () => void;
}

export function Chip({ label, selected, onPress }: Props) {
  const c = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        { backgroundColor: selected ? c.accent : c.input, opacity: pressed ? 0.7 : 1 },
      ]}
    >
      <Text style={[styles.label, { color: selected ? c.accentText : c.text }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16 },
  label: { fontSize: 14 },
});
