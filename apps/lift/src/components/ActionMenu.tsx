import { useCallback, useState, type ReactElement } from "react";
import { ActionSheetIOS, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { CANCEL_LABEL, actionAt, compactActions, sheetOptions, type MenuAction } from "../lib/actionMenu";
import { useColors } from "./theme";

export type { MenuAction };

type ActionList = readonly (MenuAction | false | null | undefined)[];

interface Request {
  title?: string;
  actions: MenuAction[];
}

/**
 * menus with any number of actions. ios uses the native action sheet; android
 * (whose Alert.alert drops everything past three buttons) gets a modal list.
 * render `menu` once in the screen, then call `show`.
 */
export function useActionMenu(): { show: (title: string | undefined, actions: ActionList) => void; menu: ReactElement } {
  const [request, setRequest] = useState<Request | null>(null);

  const show = useCallback((title: string | undefined, list: ActionList) => {
    const actions = compactActions(list);
    if (!actions.length) return;
    if (Platform.OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions({ title, ...sheetOptions(actions) }, (i) => actionAt(actions, i)?.onPress());
      return;
    }
    setRequest({ title, actions });
  }, []);

  const menu = <ActionMenu request={request} onClose={() => setRequest(null)} />;
  return { show, menu };
}

interface Props {
  request: Request | null;
  onClose: () => void;
}

export function ActionMenu({ request, onClose }: Props) {
  const c = useColors();
  return (
    <Modal visible={!!request} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="close menu" />
        <View style={[styles.sheet, { backgroundColor: c.card }]}>
          {request?.title ? (
            <Text style={[styles.title, { color: c.muted }]} numberOfLines={2}>
              {request.title}
            </Text>
          ) : null}
          <ScrollView bounces={false}>
            {request?.actions.map((a, i) => (
              <Pressable
                key={`${i}-${a.label}`}
                accessibilityRole="button"
                onPress={() => {
                  // close first: the action may open the next menu or a confirm
                  onClose();
                  a.onPress();
                }}
                style={({ pressed }) => [styles.item, { borderTopColor: c.border, opacity: pressed ? 0.6 : 1 }]}
              >
                <Text style={[styles.itemText, { color: a.destructive ? c.danger : c.text }]}>{a.label}</Text>
              </Pressable>
            ))}
          </ScrollView>
          <Pressable
            accessibilityRole="button"
            onPress={onClose}
            style={({ pressed }) => [styles.item, { borderTopColor: c.border, opacity: pressed ? 0.6 : 1 }]}
          >
            <Text style={[styles.itemText, styles.cancel, { color: c.accent }]}>{CANCEL_LABEL}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: "flex-end", padding: 12, backgroundColor: "rgba(0,0,0,0.4)" },
  sheet: { borderRadius: 14, overflow: "hidden", maxHeight: "80%" },
  title: { fontSize: 13, fontWeight: "600", textAlign: "center", paddingHorizontal: 16, paddingVertical: 12 },
  item: { paddingVertical: 14, paddingHorizontal: 16, borderTopWidth: StyleSheet.hairlineWidth },
  itemText: { fontSize: 17, textAlign: "center" },
  cancel: { fontWeight: "600" },
});
