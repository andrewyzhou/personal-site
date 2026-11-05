import { useEffect, useMemo, useState } from "react";
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { describeRule, programTemplateIds, type ProgramData, type WeightUnit } from "lift-core";
import { getPreferredUnit } from "../../db/bodyweight";
import { getExerciseLookup } from "../../db/exercises";
import {
  deleteProgram,
  getProgram,
  getProgramProgress,
  restartProgram,
  saveProgram,
  setActiveProgram,
  skipProgramDay,
} from "../../db/programs";
import { getTemplateDetail, listTemplates } from "../../db/templates";
import { useActionMenu } from "../../components/ActionMenu";
import { Button } from "../../components/Button";
import { Chip } from "../../components/library/Chip";
import { startProgramDay } from "../../components/library/startProgramDay";
import { RuleEditor } from "../../components/program/RuleEditor";
import { useColors } from "../../components/theme";
import { addWeek, daysPerWeek, MAX_DAYS, progressLabel, pruneRules, removeWeek, setDay, setDayCount, setRule } from "../../lib/programs";

interface Draft {
  name: string;
  data: ProgramData;
}

export default function ProgramEditor() {
  const c = useColors();
  const { id } = useLocalSearchParams<{ id: string }>();
  const unit: WeightUnit = useMemo(() => getPreferredUnit(), []);
  const lookup = useMemo(() => getExerciseLookup(), []);
  const templates = useMemo(() => listTemplates({ includeArchived: true }), []);
  const templateName = (tid: string) => templates.find((t) => t.id === tid)?.name ?? "missing template";
  const [draft, setDraft] = useState<Draft | null>(null);
  const [active, setActive] = useState(false);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openRules, setOpenRules] = useState<string | null>(null);
  const { show: showMenu, menu } = useActionMenu();

  const load = () => {
    const p = id ? getProgram(id) : undefined;
    if (!p) return setMissing(true);
    setActive(!!p.row.active);
    setDraft({ name: p.row.name, data: p.data });
  };
  useEffect(load, [id]);

  const used = useMemo(() => (draft ? programTemplateIds(draft.data) : []), [draft?.data.weeks]);
  // exercises of every template the program uses, for the rule pickers
  const details = useMemo(
    () => used.map((tid) => ({ tid, detail: getTemplateDetail(tid) })),
    [used.join("|")]
  );
  const progress = useMemo(() => (draft ? getProgramProgress(draft) : null), [draft?.data]);

  if (missing || !draft || !progress || !id) {
    return (
      <View style={[styles.body, { flex: 1, backgroundColor: c.bg }]}>
        <Text style={{ color: c.muted }}>{missing ? "program not found" : ""}</Text>
      </View>
    );
  }

  const update = (fn: (d: ProgramData) => ProgramData) => {
    setError(null);
    setDraft((d) => (d ? { ...d, data: fn(d.data) } : d));
  };

  const save = (): boolean => {
    try {
      const keep = new Set(details.flatMap(({ detail }) => detail?.exercises.map((e) => e.row.id) ?? []));
      saveProgram(id, { name: draft.name, data: pruneRules(draft.data, keep) });
      load();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    }
  };

  const pickDay = (week: number, day: number) =>
    showMenu(`week ${week + 1} · day ${day + 1}`, [
      { label: "rest day", onPress: () => update((d) => setDay(d, week, day, null)) },
      ...templates
        .filter((t) => !t.archived)
        .map((t) => ({ label: t.name, onPress: () => update((d) => setDay(d, week, day, t.id)) })),
    ]);

  const weekMenu = (week: number) =>
    showMenu(`week ${week + 1}`, [
      { label: "remove week", destructive: true, onPress: () => update((d) => removeWeek(d, week)) },
    ]);

  const days = Math.max(1, daysPerWeek(draft.data));

  const more = () =>
    showMenu(draft.name, [
      !progress.done && {
        label: "save and start next day",
        onPress: () => {
          if (save()) startProgramDay(id);
        },
      },
      !progress.done && {
        label: "skip next day",
        onPress: () => {
          if (!save()) return;
          skipProgramDay(id);
          load();
        },
      },
      {
        label: "restart from week 1",
        onPress: () => {
          if (!save()) return;
          restartProgram(id);
          load();
        },
      },
      {
        label: "delete",
        destructive: true,
        onPress: () =>
          Alert.alert("delete program?", draft.name, [
            { text: "cancel", style: "cancel" },
            {
              text: "delete",
              style: "destructive",
              onPress: () => {
                deleteProgram(id);
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
          title: draft.name || "program",
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
          onChangeText={(name) => setDraft((d) => (d ? { ...d, name } : d))}
          placeholder="program name"
          placeholderTextColor={c.muted}
          style={[styles.title, { color: c.text, backgroundColor: c.input }]}
        />
        <Text style={{ color: c.muted }}>
          {active ? "following · " : ""}
          {progressLabel(progress)}
        </Text>

        <View style={styles.headerRow}>
          <Text style={[styles.heading, { color: c.text }]}>schedule</Text>
          <View style={styles.row}>
            <Text style={{ color: c.muted }}>{days} days / week</Text>
            <Chip label="−" onPress={() => update((d) => setDayCount(d, days - 1))} />
            <Chip label="+" onPress={() => days < MAX_DAYS && update((d) => setDayCount(d, days + 1))} />
          </View>
        </View>
        {!templates.length ? <Text style={{ color: c.muted }}>make a template first, then pick it for a day here.</Text> : null}
        {draft.data.weeks.map((w, wi) => (
          <View key={wi} style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
            <View style={styles.headerRow}>
              <Text style={{ color: c.muted, fontWeight: "600" }}>week {wi + 1}</Text>
              <Pressable hitSlop={8} onPress={() => weekMenu(wi)} accessibilityLabel={`week ${wi + 1} options`}>
                <Text style={{ color: c.accent }}>•••</Text>
              </Pressable>
            </View>
            <View style={styles.grid}>
              {Array.from({ length: days }, (_, di) => {
                const tid = w.days[di]?.templateId ?? null;
                const next = progress.next?.week === wi && progress.next.day === di;
                return (
                  <Pressable
                    key={di}
                    onPress={() => pickDay(wi, di)}
                    style={({ pressed }) => [
                      styles.cell,
                      { backgroundColor: c.input, borderColor: next ? c.accent : "transparent", opacity: pressed ? 0.6 : 1 },
                    ]}
                  >
                    <Text style={{ color: c.muted, fontSize: 11 }}>day {di + 1}</Text>
                    <Text style={{ color: tid ? c.text : c.muted, fontWeight: tid ? "600" : "400" }} numberOfLines={2}>
                      {tid ? templateName(tid) : "rest"}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        ))}
        <Button label="add week" variant="plain" onPress={() => update(addWeek)} />
        <View style={styles.row}>
          <Chip label="repeat after the last week" selected={draft.data.repeat} onPress={() => update((d) => ({ ...d, repeat: !d.repeat }))} />
        </View>

        {details.length ? <Text style={[styles.heading, { color: c.text }]}>progression</Text> : null}
        {details.map(({ tid, detail }) => (
          <View key={tid} style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
            <Text style={[styles.exName, { color: c.text }]}>{templateName(tid)}</Text>
            {!detail?.exercises.length ? <Text style={{ color: c.muted }}>no exercises in this template</Text> : null}
            {detail?.exercises.map(({ row }) => {
              const rule = draft.data.rules[row.id] ?? null;
              const isOpen = openRules === row.id;
              return (
                <View key={row.id} style={styles.ruleRow}>
                  <Pressable onPress={() => setOpenRules(isOpen ? null : row.id)} style={styles.headerRow} hitSlop={4}>
                    <Text style={{ color: c.text, flex: 1 }} numberOfLines={1}>
                      {lookup(row.exerciseId)?.name ?? row.exerciseId}
                    </Text>
                    <Text style={{ color: rule ? c.accent : c.muted, fontSize: 13 }}>{rule ? describeRule(rule, unit) : "no rule"}</Text>
                  </Pressable>
                  {isOpen ? <RuleEditor rule={rule} unit={unit} onChange={(r) => update((d) => setRule(d, row.id, r))} /> : null}
                </View>
              );
            })}
          </View>
        ))}

        {error ? <Text style={{ color: c.danger }}>{error}</Text> : null}
        <Button
          label="save"
          onPress={() => {
            if (save()) router.back();
          }}
        />
        <Button
          label={active ? "stop following" : "follow this program"}
          variant="plain"
          onPress={() => {
            if (!save()) return;
            setActiveProgram(active ? null : id);
            load();
          }}
        />
        <Button label="more" variant="plain" onPress={more} />
      </ScrollView>
      {menu}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  body: { padding: 16, gap: 12, paddingBottom: 64 },
  title: { fontSize: 20, fontWeight: "600", paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10 },
  heading: { fontSize: 17, fontWeight: "600", marginTop: 8 },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  row: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 },
  card: { padding: 12, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, gap: 8 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  cell: { flexBasis: "30%", flexGrow: 1, minHeight: 52, padding: 8, borderRadius: 8, borderWidth: 2, gap: 2 },
  exName: { fontSize: 16, fontWeight: "600" },
  ruleRow: { gap: 8, paddingVertical: 4 },
});
