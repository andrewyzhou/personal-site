import { useEffect, useState } from "react";
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Button } from "../Button";
import { useColors } from "../theme";
import { validateName } from "../../lib/names";

interface Props {
  visible: boolean;
  title: string;
  initial?: string;
  confirmLabel?: string;
  onCancel: () => void;
  onSubmit: (name: string) => void;
}

/** small cross-platform text prompt (Alert.prompt is ios only) */
export function NamePrompt({ visible, title, initial = "", confirmLabel = "save", onCancel, onSubmit }: Props) {
  const c = useColors();
  const [value, setValue] = useState(initial);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setValue(initial);
      setError(null);
    }
  }, [visible, initial]);

  const submit = () => {
    const v = validateName(value);
    if (!v.ok) return setError(v.error);
    onSubmit(v.name);
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <KeyboardAvoidingView style={styles.backdrop} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onCancel} />
        <View style={[styles.card, { backgroundColor: c.card }]}>
          <Text style={[styles.title, { color: c.text }]}>{title}</Text>
          <TextInput
            value={value}
            onChangeText={(t) => {
              setValue(t);
              setError(null);
            }}
            autoFocus
            returnKeyType="done"
            onSubmitEditing={submit}
            placeholder="name"
            placeholderTextColor={c.muted}
            style={[styles.input, { backgroundColor: c.input, color: c.text }]}
          />
          {error ? <Text style={{ color: c.danger }}>{error}</Text> : null}
          <View style={styles.row}>
            <Button label="cancel" variant="plain" onPress={onCancel} style={styles.flex} />
            <Button label={confirmLabel} onPress={submit} style={styles.flex} />
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: "center", padding: 24, backgroundColor: "rgba(0,0,0,0.4)" },
  card: { borderRadius: 14, padding: 16, gap: 12 },
  title: { fontSize: 17, fontWeight: "600" },
  input: { paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10, fontSize: 16 },
  row: { flexDirection: "row", gap: 8 },
  flex: { flex: 1 },
});
