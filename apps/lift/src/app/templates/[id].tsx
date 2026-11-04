import { useEffect, useMemo, useState } from "react";
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Stack, router, useLocalSearchParams } from "expo-router";
import type { WeightUnit } from "lift-core";
import { getExerciseLookup } from "../../db/exercises";
import { getPreferredUnit } from "../../db/bodyweight";
import { deleteTemplate, duplicateTemplate, getTemplateDetail, listFolders, saveTemplate, setTemplateArchived } from "../../db/templates";
import { useActionMenu } from "../../components/ActionMenu";
import { Button } from "../../components/Button";
import { MAX_NOTE_LENGTH } from "../../lib/numbers";
import { MAX_REST_S } from "../../lib/rest";
import { Chip } from "../../components/library/Chip";
import { NumField } from "../../components/library/NumField";
import { PickerModal } from "../../components/library/PickerModal";
import { startTemplate } from "../../components/library/startTemplate";
import { useColors } from "../../components/theme";
import { KIND_LABEL, nextKind, setLabels } from "../../lib/sets";
import {
  emptyPlannedSet,
  moveItem,
  normalizeSupersets,
  plannedFields,
  toggleSupersetWithPrevious,
  type PlannedField,
  type PlannedSet,
  type TemplateExerciseDraft,
} from "../../lib/templates";

interface DraftExercise extends TemplateExerciseDraft {
  key: string;
}

interface Draft {
  name: string;
  notes: string;
  folderId: string | null;
  exercises: DraftExercise[];
}

const FIELD_HINT: Record<PlannedField, string> = { weight: "", reps: "reps", durationS: "sec", distanceM: "m" };

let keySeq = 0;
const newKey = () => `k${++keySeq}`;

export default function TemplateEditor() {
  const c = useColors();
  const { id } = useLocalSearchParams<{ id: string }>();
  const unit: WeightUnit = useMemo(() => getPreferredUnit(), []);
  const folders = useMemo(() => listFolders(), []);
  const lookup = useMemo(() => getExerciseLookup(), []);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [missing, setMissing] = useState(false);
  const [archived, setArchived] = useState(false);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { show: showMenu, menu } = useActionMenu();

  // seed (and re-seed after a save) from sqlite, so new rows carry their ids
  // and a second save updates them instead of inserting copies
  const load = (): void => {
    const detail = id ? getTemplateDetail(id) : undefined;
    if (!detail) return setMissing(true);
    setArchived(!!detail.template.archived);
    setDraft({
      name: detail.template.name,
      notes: detail.template.notes ?? "",
      folderId: detail.template.folderId,
      exercises: detail.exercises.map(({ row, planned }) => ({
        key: newKey(),
        id: row.id,
        exerciseId: row.exerciseId,
        supersetGroup: row.supersetGroup,
        restS: row.restS,
        notes: row.notes,
        plannedSets: planned,
      })),
    });
  };

  useEffect(load, [id]);

  if (missing || !draft || !id) {
    return (
      <View style={[styles.body, { flex: 1, backgroundColor: c.bg }]}>
        <Text style={{ color: c.muted }}>{missing ? "template not found" : ""}</Text>
      </View>
    );
  }

  const update = (fn: (d: Draft) => Draft) => {
    setError(null);
    setDraft((d) => (d ? fn(d) : d));
  };
  const updateExercise = (key: string, fn: (e: DraftExercise) => DraftExercise) =>
    update((d) => ({ ...d, exercises: d.exercises.map((e) => (e.key === key ? fn(e) : e)) }));
  const updateSet = (key: string, i: number, patch: Partial<PlannedSet>) =>
    updateExercise(key, (e) => ({ ...e, plannedSets: e.plannedSets.map((s, j) => (j === i ? { ...s, ...patch } : s)) }));

  const save = (): boolean => {
    try {
      saveTemplate(id, { name: draft.name, notes: draft.notes, folderId: draft.folderId, exercises: draft.exercises });
      load();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    }
  };

  const groups = normalizeSupersets(draft.exercises.map((e) => e.supersetGroup));

  const more = () =>
    showMenu(draft.name, [
      {
        label: "save and start workout",
        onPress: () => {
          if (save()) startTemplate(id);
        },
      },
      {
        label: "duplicate",
        onPress: () => {
          if (!save()) return;
          const copy = duplicateTemplate(id);
          if (copy) router.replace({ pathname: "/templates/[id]", params: { id: copy.id } });
        },
      },
      {
        label: archived ? "unarchive" : "archive",
        onPress: () => {
          setTemplateArchived(id, !archived);
          setArchived(!archived);
        },
      },
      {
        label: "delete",
        destructive: true,
        onPress: () =>
          Alert.alert("delete template?", draft.name, [
            { text: "cancel", style: "cancel" },
            {
              text: "delete",
              style: "destructive",
              onPress: () => {
                deleteTemplate(id);
                router.back();
              },
            },
          ]),
      },
    ]);

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: c.bg }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <Stack.Screen
        options={{
          title: draft.name || "template",
          headerRight: () => (
            <Pressable
              hitSlop={10}
              onPress={() => {
                if (save()) router.back();
              }}
            >
              <Text style={{ color: c.accent, fontSize: 16, fontWeight: "600" }}>save</Text>
            </Pressable>
          ),
        }}
      />
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <TextInput
          value={draft.name}
          onChangeText={(name) => update((d) => ({ ...d, name }))}
          placeholder="template name"
          placeholderTextColor={c.muted}
          style={[styles.title, { color: c.text, backgroundColor: c.input }]}
        />
        <TextInput
          value={draft.notes}
          onChangeText={(notes) => update((d) => ({ ...d, notes }))}
          placeholder="notes"
          placeholderTextColor={c.muted}
          maxLength={MAX_NOTE_LENGTH}
          multiline
          style={[styles.input, { color: c.text, backgroundColor: c.input }]}
        />
        {folders.length ? (
          <View style={styles.wrap}>
            <Chip label="no folder" selected={draft.folderId === null} onPress={() => update((d) => ({ ...d, folderId: null }))} />
            {folders.map((f) => (
              <Chip key={f.id} label={f.name} selected={draft.folderId === f.id} onPress={() => update((d) => ({ ...d, folderId: f.id }))} />
            ))}
          </View>
        ) : null}
        {archived ? <Text style={{ color: c.muted }}>archived · hidden from home</Text> : null}

        {draft.exercises.map((ex, i) => {
          const exercise = lookup(ex.exerciseId);
          const fields = plannedFields(exercise?.tracking ?? "weight_reps");
          const labels = setLabels(ex.plannedSets);
          const linked = i > 0 && groups[i] != null && groups[i] === groups[i - 1];
          return (
            <View key={ex.key} style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
              {i > 0 ? (
                <Pressable
                  onPress={() =>
                    update((d) => {
                      const next = toggleSupersetWithPrevious(
                        d.exercises.map((e) => e.supersetGroup),
                        i
                      );
                      return { ...d, exercises: d.exercises.map((e, j) => ({ ...e, supersetGroup: next[j] ?? null })) };
                    })
                  }
                  hitSlop={6}
                >
                  <Text style={{ color: linked ? c.accent : c.muted, fontSize: 13 }}>
                    {linked ? "superset with above · unlink" : "link superset with above"}
                  </Text>
                </Pressable>
              ) : null}
              <View style={styles.exHeader}>
                <Text style={[styles.exName, { color: c.text }]} numberOfLines={2}>
                  {groups[i] != null ? `${String.fromCharCode(64 + groups[i]!)} · ` : ""}
                  {exercise?.name ?? ex.exerciseId}
                </Text>
                <Pressable
                  hitSlop={8}
                  onPress={() =>
                    // up + down + remove + cancel is four: past android's alert limit
                    showMenu(exercise?.name ?? "exercise", [
                      i > 0 && { label: "move up", onPress: () => update((d) => ({ ...d, exercises: moveItem(d.exercises, i, i - 1) })) },
                      i < draft.exercises.length - 1 && {
                        label: "move down",
                        onPress: () => update((d) => ({ ...d, exercises: moveItem(d.exercises, i, i + 1) })),
                      },
                      {
                        label: "remove",
                        destructive: true,
                        onPress: () => update((d) => ({ ...d, exercises: d.exercises.filter((e) => e.key !== ex.key) })),
                      },
                    ])
                  }
                >
                  <Text style={{ color: c.accent }}>•••</Text>
                </Pressable>
              </View>
              <View style={styles.restRow}>
                <Text style={{ color: c.muted }}>rest</Text>
                <NumField
                  integer
                  field="durationS"
                  max={MAX_REST_S}
                  value={ex.restS}
                  placeholder="default"
                  onChange={(restS) => updateExercise(ex.key, (e) => ({ ...e, restS }))}
                />
                <Text style={{ color: c.muted }}>sec</Text>
              </View>
              {ex.plannedSets.map((s, j) => (
                <View key={j} style={styles.setRow}>
                  <Pressable
                    onPress={() => updateSet(ex.key, j, { kind: nextKind(s.kind) })}
                    style={[styles.kind, { backgroundColor: c.input }]}
                    accessibilityLabel={`set kind ${s.kind}`}
                  >
                    <Text style={{ color: s.kind === "normal" ? c.text : c.accent, fontWeight: "600" }}>
                      {s.kind === "normal" ? labels[j] : KIND_LABEL[s.kind]}
                    </Text>
                  </Pressable>
                  {fields.map((f) => (
                    <View key={f} style={styles.field}>
                      <NumField
                        integer={f === "reps" || f === "durationS"}
                        field={f}
                        value={s[f]}
                        placeholder={f === "weight" ? s.unit : FIELD_HINT[f]}
                        onChange={(v) => updateSet(ex.key, j, { [f]: v })}
                      />
                    </View>
                  ))}
                  <Pressable
                    hitSlop={8}
                    onPress={() =>
                      updateExercise(ex.key, (e) => ({ ...e, plannedSets: e.plannedSets.filter((_, k) => k !== j) }))
                    }
                    accessibilityLabel="remove set"
                  >
                    <Text style={{ color: c.danger, fontSize: 18 }}>×</Text>
                  </Pressable>
                </View>
              ))}
              <Button
                label="add set"
                variant="plain"
                onPress={() =>
                  updateExercise(ex.key, (e) => ({
                    ...e,
                    plannedSets: [...e.plannedSets, emptyPlannedSet(unit, e.plannedSets[e.plannedSets.length - 1])],
                  }))
                }
              />
            </View>
          );
        })}

        <Button label="add exercise" variant="plain" onPress={() => setPicking(true)} />
        {error ? <Text style={{ color: c.danger }}>{error}</Text> : null}
        <Button
          label="save"
          onPress={() => {
            if (save()) router.back();
          }}
        />
        <Button label="more" variant="plain" onPress={more} />
      </ScrollView>
      {menu}
      <PickerModal
        visible={picking}
        title="add exercise"
        onClose={() => setPicking(false)}
        onSelect={(e) => {
          setPicking(false);
          update((d) => ({
            ...d,
            exercises: [
              ...d.exercises,
              {
                key: newKey(),
                exerciseId: e.id,
                supersetGroup: null,
                restS: null,
                notes: null,
                plannedSets: [emptyPlannedSet(unit)],
              },
            ],
          }));
        }}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  body: { padding: 16, gap: 12, paddingBottom: 64 },
  title: { fontSize: 20, fontWeight: "600", paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10 },
  input: { paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10, fontSize: 15, minHeight: 44 },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  card: { padding: 12, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, gap: 8 },
  exHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  exName: { fontSize: 16, fontWeight: "600", flex: 1 },
  restRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  setRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  kind: { width: 36, height: 36, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  field: { flex: 1 },
});
