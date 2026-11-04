import { Pressable, StyleSheet, Text, type StyleProp, type ViewStyle } from "react-native";
import { useColors } from "./theme";

interface Props {
  label: string;
  onPress: () => void;
  variant?: "primary" | "plain" | "danger";
  style?: StyleProp<ViewStyle>;
}

export function Button({ label, onPress, variant = "primary", style }: Props) {
  const c = useColors();
  const bg = variant === "primary" ? c.accent : c.input;
  const fg = variant === "primary" ? c.accentText : variant === "danger" ? c.danger : c.text;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.base, { backgroundColor: bg, opacity: pressed ? 0.7 : 1 }, style]}
    >
      <Text style={[styles.label, { color: fg }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { paddingVertical: 12, paddingHorizontal: 16, borderRadius: 10, alignItems: "center" },
  label: { fontSize: 16, fontWeight: "600" },
});
