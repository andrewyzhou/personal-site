import { useEffect, useState } from "react";
import { StyleSheet, TextInput, type StyleProp, type TextStyle } from "react-native";
import { clampNumber, formatCount, formatDecimal, parseCount, parseDecimal, type NumericField } from "../../lib/numbers";
import { useColors } from "../theme";

interface Props {
  value: number | null;
  onChange: (value: number | null) => void;
  integer?: boolean;
  /** clamps to the server range for this field, so a typo can't make an unsyncable row */
  field?: NumericField;
  /** extra ceiling on top of the field's own (e.g. rest seconds) */
  max?: number;
  placeholder?: string;
  style?: StyleProp<TextStyle>;
}

/** numeric input that keeps its own text, so "22." survives while typing */
export function NumField({ value, onChange, integer, field, max, placeholder, style }: Props) {
  const c = useColors();
  const format = integer ? formatCount : formatDecimal;
  const parse = (t: string) => {
    let n = (integer ? parseCount : parseDecimal)(t);
    if (field) n = clampNumber(n, field);
    return n != null && max != null ? Math.min(n, max) : n;
  };
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
      // a clamped typo shows the stored value once the field is left
      onBlur={() => setText(format(parse(text)))}
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
