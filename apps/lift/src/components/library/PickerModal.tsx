import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import type { Exercise } from "lift-core";
import { ExercisePicker } from "../ExercisePicker";
import { useColors } from "../theme";

interface Props {
  visible: boolean;
  title: string;
  excludeIds?: readonly string[];
  onClose: () => void;
  onSelect: (exercise: Exercise) => void;
}

/** exercise search in a sheet, for screens that keep a draft in state */
export function PickerModal({ visible, title, excludeIds, onClose, onSelect }: Props) {
  const c = useColors();
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[styles.flex, { backgroundColor: c.bg }]}>
        <View style={[styles.header, { borderColor: c.border }]}>
          <Text style={[styles.title, { color: c.text }]}>{title}</Text>
          <Pressable onPress={onClose} hitSlop={12}>
            <Text style={{ color: c.accent, fontSize: 16 }}>close</Text>
          </Pressable>
        </View>
        {visible ? <ExercisePicker autoFocus showFilters excludeIds={excludeIds} onSelect={onSelect} /> : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: { fontSize: 17, fontWeight: "600" },
});
