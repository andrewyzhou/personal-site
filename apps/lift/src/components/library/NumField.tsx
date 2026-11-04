import { useEffect, useState } from "react";
import { StyleSheet, TextInput, type StyleProp, type TextStyle } from "react-native";
import { formatCount, formatDecimal, parseCount, parseDecimal } from "../../lib/numbers";
import { useColors } from "../theme";

interface Props {
  value: number | null;
  onChange: (value: number | null) => void;
  integer?: boolean;
  placeholder?: string;
  style?: StyleProp<TextStyle>;
}

/** numeric input that keeps its own text, so "22." survives while typing */
export function NumField({ value, onChange, integer, placeholder, style }: Props) {
  const c = useColors();
  const format = integer ? formatCount : formatDecimal;
  const parse = integer ? parseCount : parseDecimal;
  const [text, setText] = useState(() => format(value));

  // follow outside changes (e.g. a copied set) without fighting the typist
  useEffect(() => {
    if (parse(text) !== value) setText(format(value));
  }, [value]);

  return (
    <TextInput
      value={text}
      onChangeText={(t) => {
        setText(t);
        onChange(parse(t));
      }}
      placeholder={placeholder}
      placeholderTextColor={c.muted}
      keyboardType={integer ? "number-pad" : "decimal-pad"}
      selectTextOnFocus
      style={[styles.input, { backgroundColor: c.input, color: c.text }, style]}
    />
  );
}

const styles = StyleSheet.create({
  input: { paddingHorizontal: 8, paddingVertical: 8, borderRadius: 8, fontSize: 16, textAlign: "center", minWidth: 64 },
});
