import { useMemo, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Stack, router } from "expo-router";
import {
  createProgram,
  deleteProgram,
  getProgramProgress,
  listPrograms,
  restartProgram,
  setActiveProgram,
  skipProgramDay,
  type ProgramDetail,
} from "../../db/programs";
import { useActionMenu } from "../../components/ActionMenu";
import { Button } from "../../components/Button";
import { NamePrompt } from "../../components/library/NamePrompt";
import { startProgramDay } from "../../components/library/startProgramDay";
import { useColors } from "../../components/theme";
import { useDbVersion } from "../../components/useDbVersion";
import { progressLabel } from "../../lib/programs";

export default function Programs() {
  const c = useColors();
  const version = useDbVersion();
  const [creating, setCreating] = useState(false);
  const { show: showMenu, menu } = useActionMenu();

  const rows = useMemo(() => listPrograms().map((p) => ({ p, progress: getProgramProgress(p) })), [version]);

  const open = (id: string) => router.push({ pathname: "/programs/[id]", params: { id } });

  const actions = (p: ProgramDetail, done: boolean) =>
    showMenu(p.row.name, [
      !done && { label: "start next day", onPress: () => startProgramDay(p.row.id) },
      { label: "edit", onPress: () => open(p.row.id) },
      p.row.active
        ? { label: "stop following", onPress: () => setActiveProgram(null) }
        : { label: "follow this program", onPress: () => setActiveProgram(p.row.id) },
      !done && { label: "skip next day", onPress: () => skipProgramDay(p.row.id) },
      { label: "restart from week 1", onPress: () => restartProgram(p.row.id) },
      {
        label: "delete",
        destructive: true,
        onPress: () =>
          Alert.alert("delete program?", "its templates and workouts are kept.", [
            { text: "cancel", style: "cancel" },
            { text: "delete", style: "destructive", onPress: () => deleteProgram(p.row.id) },
          ]),
      },
    ]);

  return (
    <ScrollView style={{ backgroundColor: c.bg }} contentContainerStyle={styles.body}>
      <Stack.Screen options={{ title: "programs" }} />
      <Button label="new program" onPress={() => setCreating(true)} />
      {!rows.length ? (
        <Text style={{ color: c.muted }}>
          no programs yet. a program lays your templates out over weeks, and can raise the weight for you as you go.
        </Text>
      ) : null}
      {rows.map(({ p, progress }) => (
        <Pressable
          key={p.row.id}
          onPress={() => open(p.row.id)}
          onLongPress={() => actions(p, progress.done)}
          style={({ pressed }) => [styles.card, { backgroundColor: c.card, borderColor: c.border, opacity: pressed ? 0.7 : 1 }]}
        >
          <View style={styles.flex}>
            <Text style={[styles.name, { color: c.text }]}>{p.row.name}</Text>
            <Text style={{ color: c.muted, fontSize: 13 }}>
              {p.row.active ? "following · " : ""}
              {p.data.weeks.length} {p.data.weeks.length === 1 ? "week" : "weeks"} · {progressLabel(progress)}
            </Text>
          </View>
          <Pressable onPress={() => actions(p, progress.done)} hitSlop={10} accessibilityLabel="program options">
            <Text style={{ color: c.accent }}>•••</Text>
          </Pressable>
        </Pressable>
      ))}
      <NamePrompt
        visible={creating}
        title="new program"
        confirmLabel="create"
        onCancel={() => setCreating(false)}
        onSubmit={(name) => {
          setCreating(false);
          const row = createProgram(name);
          open(row.id);
        }}
      />
      {menu}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  body: { padding: 16, gap: 12, paddingBottom: 48 },
  flex: { flex: 1 },
  card: {
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  name: { fontSize: 16, fontWeight: "600" },
});
