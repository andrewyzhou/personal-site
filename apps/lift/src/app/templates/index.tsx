import { useMemo, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Stack, router } from "expo-router";
import {
  createFolder,
  createTemplate,
  deleteFolder,
  deleteTemplate,
  duplicateTemplate,
  listFolders,
  listTemplates,
  moveTemplateToFolder,
  renameFolder,
  reorderFolders,
  reorderTemplates,
  setTemplateArchived,
  templateExerciseCounts,
} from "../../db/templates";
import { Button } from "../../components/Button";
import { Chip } from "../../components/library/Chip";
import { NamePrompt } from "../../components/library/NamePrompt";
import { useColors } from "../../components/theme";
import { useDbVersion } from "../../components/useDbVersion";
import type { TemplateFolderRow, TemplateRow } from "../../db/schema";
import { groupTemplates, moveItem } from "../../lib/templates";
import { startTemplate } from "../../components/library/startTemplate";

type Prompt =
  | { kind: "new-folder" }
  | { kind: "new-template"; folderId: string | null }
  | { kind: "rename-folder"; folder: TemplateFolderRow };

export default function Templates() {
  const c = useColors();
  const version = useDbVersion();
  const [showArchived, setShowArchived] = useState(false);
  const [prompt, setPrompt] = useState<Prompt | null>(null);

  const { sections, folders, counts, archivedCount } = useMemo(() => {
    const folders = listFolders();
    const all = listTemplates({ includeArchived: true });
    const visible = showArchived ? all : all.filter((t) => !t.archived);
    return {
      folders,
      sections: groupTemplates(folders, visible),
      counts: templateExerciseCounts(),
      archivedCount: all.filter((t) => t.archived).length,
    };
  }, [version, showArchived]);

  const folderActions = (folder: TemplateFolderRow) => {
    const i = folders.findIndex((f) => f.id === folder.id);
    const move = (to: number) => reorderFolders(moveItem(folders, i, to).map((f) => f.id));
    Alert.alert(folder.name, undefined, [
      { text: "new template here", onPress: () => setPrompt({ kind: "new-template", folderId: folder.id }) },
      { text: "rename", onPress: () => setPrompt({ kind: "rename-folder", folder }) },
      ...(i > 0 ? [{ text: "move up", onPress: () => move(i - 1) }] : []),
      ...(i < folders.length - 1 ? [{ text: "move down", onPress: () => move(i + 1) }] : []),
      {
        text: "delete folder",
        style: "destructive" as const,
        onPress: () =>
          Alert.alert("delete folder?", "its templates are kept, without a folder.", [
            { text: "cancel", style: "cancel" },
            { text: "delete", style: "destructive", onPress: () => deleteFolder(folder.id) },
          ]),
      },
      { text: "cancel", style: "cancel" },
    ]);
  };

  const moveToFolder = (t: TemplateRow) => {
    Alert.alert("move to", undefined, [
      ...folders.filter((f) => f.id !== t.folderId).map((f) => ({ text: f.name, onPress: () => moveTemplateToFolder(t.id, f.id) })),
      ...(t.folderId ? [{ text: "no folder", onPress: () => moveTemplateToFolder(t.id, null) }] : []),
      { text: "cancel", style: "cancel" as const },
    ]);
  };

  const templateActions = (t: TemplateRow, siblings: TemplateRow[]) => {
    const i = siblings.findIndex((s) => s.id === t.id);
    const move = (to: number) => reorderTemplates(moveItem(siblings, i, to).map((s) => s.id));
    Alert.alert(t.name, undefined, [
      { text: "start workout", onPress: () => startTemplate(t.id) },
      { text: "edit", onPress: () => router.push({ pathname: "/templates/[id]", params: { id: t.id } }) },
      { text: "duplicate", onPress: () => duplicateTemplate(t.id) },
      ...(folders.length ? [{ text: "move to folder", onPress: () => moveToFolder(t) }] : []),
      ...(i > 0 ? [{ text: "move up", onPress: () => move(i - 1) }] : []),
      ...(i < siblings.length - 1 ? [{ text: "move down", onPress: () => move(i + 1) }] : []),
      { text: t.archived ? "unarchive" : "archive", onPress: () => setTemplateArchived(t.id, !t.archived) },
      {
        text: "delete",
        style: "destructive" as const,
        onPress: () =>
          Alert.alert("delete template?", t.name, [
            { text: "cancel", style: "cancel" },
            { text: "delete", style: "destructive", onPress: () => deleteTemplate(t.id) },
          ]),
      },
      { text: "cancel", style: "cancel" },
    ]);
  };

  const submitPrompt = (name: string) => {
    const p = prompt;
    setPrompt(null);
    if (!p) return;
    if (p.kind === "new-folder") createFolder(name);
    else if (p.kind === "rename-folder") renameFolder(p.folder.id, name);
    else {
      const t = createTemplate({ name, folderId: p.folderId });
      router.push({ pathname: "/templates/[id]", params: { id: t.id } });
    }
  };

  return (
    <ScrollView style={{ backgroundColor: c.bg }} contentContainerStyle={styles.body}>
      <Stack.Screen options={{ title: "templates" }} />
      <View style={styles.row}>
        <Button label="new template" onPress={() => setPrompt({ kind: "new-template", folderId: null })} style={styles.flex} />
        <Button label="new folder" variant="plain" onPress={() => setPrompt({ kind: "new-folder" })} style={styles.flex} />
      </View>
      {archivedCount ? (
        <View style={styles.row}>
          <Chip label={`show archived (${archivedCount})`} selected={showArchived} onPress={() => setShowArchived((v) => !v)} />
        </View>
      ) : null}
      {sections.map((s) => (
        <View key={s.folder?.id ?? "none"} style={styles.section}>
          {s.folder ? (
            <Pressable onPress={() => folderActions(s.folder!)} style={styles.folderHeader} hitSlop={6}>
              <Text style={[styles.folderName, { color: c.muted }]}>{s.folder.name}</Text>
              <Text style={{ color: c.accent }}>•••</Text>
            </Pressable>
          ) : folders.length ? (
            <Text style={[styles.folderName, styles.folderHeader, { color: c.muted }]}>no folder</Text>
          ) : null}
          {s.templates.length ? (
            s.templates.map((t) => (
              <Pressable
                key={t.id}
                onPress={() => router.push({ pathname: "/templates/[id]", params: { id: t.id } })}
                onLongPress={() => templateActions(t, s.templates)}
                style={({ pressed }) => [
                  styles.card,
                  { backgroundColor: c.card, borderColor: c.border, opacity: pressed ? 0.7 : t.archived ? 0.5 : 1 },
                ]}
              >
                <View style={styles.flex}>
                  <Text style={[styles.name, { color: c.text }]}>{t.name}</Text>
                  <Text style={{ color: c.muted, fontSize: 13 }}>
                    {counts[t.id] ?? 0} exercises{t.archived ? " · archived" : ""}
                  </Text>
                </View>
                <Pressable onPress={() => templateActions(t, s.templates)} hitSlop={10}>
                  <Text style={{ color: c.accent }}>•••</Text>
                </Pressable>
              </Pressable>
            ))
          ) : (
            <Text style={{ color: c.muted }}>{s.folder ? "empty folder" : "no templates yet"}</Text>
          )}
        </View>
      ))}
      <NamePrompt
        visible={!!prompt}
        title={prompt?.kind === "new-folder" ? "new folder" : prompt?.kind === "rename-folder" ? "rename folder" : "new template"}
        initial={prompt?.kind === "rename-folder" ? prompt.folder.name : ""}
        confirmLabel={prompt?.kind === "rename-folder" ? "save" : "create"}
        onCancel={() => setPrompt(null)}
        onSubmit={submitPrompt}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  body: { padding: 16, gap: 12, paddingBottom: 48 },
  row: { flexDirection: "row", gap: 8 },
  flex: { flex: 1 },
  section: { gap: 8 },
  folderHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 8 },
  folderName: { fontSize: 13, fontWeight: "600" },
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
