import { useEffect, useMemo, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { router, type Href } from "expo-router";
import { getActiveWorkout, startWorkout } from "../db/workouts";
import { getTemplate, listFolders, listTemplates, templateExerciseCounts } from "../db/templates";
import { getActiveProgram, getProgramProgress } from "../db/programs";
import { startProgramDay } from "../components/library/startProgramDay";
import { progressLabel } from "../lib/programs";
import { templateLastUsed } from "../db/quickStart";
import { checkRestoreOffer, dismissRestoreOffer, restoreFromServer } from "../db/restore";
import { Button } from "../components/Button";
import { startTemplate } from "../components/library/startTemplate";
import { useColors } from "../components/theme";
import { useDbVersion } from "../components/useDbVersion";
import { formatElapsed } from "../lib/format";
import { groupTemplates } from "../lib/templates";
import { recentTemplates } from "../lib/quickStart";

// reopen an active workout once per launch (it survives the app being killed);
// after that, backing out to home should stay on home
let reopened = false;

const LINKS: { label: string; href: Href }[] = [
  { label: "history", href: "/history" },
  { label: "exercises", href: "/exercises" },
  { label: "templates", href: "/templates" },
  { label: "programs", href: "/programs" },
  { label: "bodyweight", href: "/bodyweight" },
  { label: "calculators", href: "/calculators" },
  { label: "settings", href: "/settings" },
];

export default function Home() {
  const c = useColors();
  const version = useDbVersion();
  const active = useMemo(() => getActiveWorkout(), [version]);
  const { sections, counts } = useMemo(
    () => ({ sections: groupTemplates(listFolders(), listTemplates()), counts: templateExerciseCounts() }),
    [version]
  );
  const hasTemplates = sections.some((s) => s.templates.length);
  const quick = useMemo(
    () => recentTemplates(sections.flatMap((s) => s.templates), templateLastUsed()),
    [sections, version]
  );
  const nextUp = useMemo(() => {
    const program = getActiveProgram();
    if (!program) return null;
    const progress = getProgramProgress(program);
    const template = progress.next ? getTemplate(progress.next.templateId) : undefined;
    return { program, progress, template };
  }, [version]);
  const [offerRestore, setOfferRestore] = useState(false);
  const [restoring, setRestoring] = useState(false);

  // re-checked on every db change: logging anything (or a restore) hides it,
  // and saving a token in settings (setToken notifies) shows it
  useEffect(() => {
    let live = true;
    checkRestoreOffer().then(
      (v) => live && setOfferRestore(v),
      () => live && setOfferRestore(false)
    );
    return () => {
      live = false;
    };
  }, [version]);

  const restore = async () => {
    if (restoring) return;
    setRestoring(true);
    try {
      const r = await restoreFromServer();
      setOfferRestore(false);
      Alert.alert("restored", `${r.workouts} workouts, ${r.sets} sets`);
    } catch (e) {
      Alert.alert("restore failed", e instanceof Error ? e.message : String(e));
    } finally {
      setRestoring(false);
    }
  };

  useEffect(() => {
    if (reopened) return;
    reopened = true;
    if (active) router.push("/workout");
  }, [active]);

  return (
    <ScrollView style={{ backgroundColor: c.bg }} contentContainerStyle={styles.body}>
      {offerRestore && !active ? (
        <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
          <Text style={[styles.title, { color: c.strong }]}>restore from server?</Text>
          <Text style={{ color: c.muted }}>this phone is empty and has your app token. bring back your workouts and templates.</Text>
          <Button label={restoring ? "restoring…" : "restore from server"} onPress={() => void restore()} style={styles.gap} />
          <Button
            label="start fresh"
            variant="plain"
            onPress={() => {
              dismissRestoreOffer();
              setOfferRestore(false);
            }}
          />
        </View>
      ) : null}

      {active ? (
        <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
          <Text style={[styles.title, { color: c.strong }]}>{active.title}</Text>
          <Text style={{ color: c.muted }}>in progress · started {formatElapsed(Date.now() - active.startedAt)} ago</Text>
          <Button label="resume" onPress={() => router.push("/workout")} style={styles.gap} />
        </View>
      ) : (
        <>
          {nextUp ? (
            <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
              <Text style={{ color: c.muted, fontSize: 13 }}>next up · {nextUp.program.row.name}</Text>
              {nextUp.progress.next ? (
                <>
                  <Text style={[styles.title, { color: c.strong }]}>{nextUp.template?.name ?? "missing template"}</Text>
                  <Text style={{ color: c.muted }}>{progressLabel(nextUp.progress)}</Text>
                  <Button
                    label={nextUp.template ? `start ${nextUp.template.name}` : "fix program"}
                    onPress={() =>
                      nextUp.template
                        ? startProgramDay(nextUp.program.row.id)
                        : router.push({ pathname: "/programs/[id]", params: { id: nextUp.program.row.id } })
                    }
                    style={styles.gap}
                  />
                </>
              ) : (
                <>
                  <Text style={[styles.title, { color: c.strong }]}>program finished</Text>
                  <Button label="programs" variant="plain" onPress={() => router.push("/programs")} style={styles.gap} />
                </>
              )}
            </View>
          ) : null}
          {quick.map((t) => (
            <Button key={t.id} label={`start ${t.name}`} onPress={() => startTemplate(t.id)} />
          ))}
          <Button
            label="start empty workout"
            variant={quick.length ? "plain" : "primary"}
            onPress={() => {
              startWorkout();
              router.push("/workout");
            }}
          />
        </>
      )}

      <View style={styles.links}>
        {LINKS.map((l) => (
          <Button key={l.label} label={l.label} variant="plain" onPress={() => router.push(l.href)} style={styles.link} />
        ))}
      </View>

      <View style={styles.headerRow}>
        <Text style={[styles.heading, { color: c.text }]}>start from template</Text>
        <Pressable onPress={() => router.push("/templates")} hitSlop={8}>
          <Text style={{ color: c.accent }}>manage</Text>
        </Pressable>
      </View>
      {!hasTemplates ? (
        <Text style={{ color: c.muted }}>no templates yet</Text>
      ) : (
        sections
          .filter((s) => s.templates.length)
          .map((s) => (
            <View key={s.folder?.id ?? "none"} style={styles.section}>
              {s.folder ? <Text style={[styles.folder, { color: c.muted }]}>{s.folder.name}</Text> : null}
              {s.templates.map((t) => (
                <Pressable
                  key={t.id}
                  onPress={() => startTemplate(t.id)}
                  onLongPress={() => router.push({ pathname: "/templates/[id]", params: { id: t.id } })}
                  style={({ pressed }) => [
                    styles.template,
                    { backgroundColor: c.card, borderColor: c.border, opacity: pressed ? 0.7 : 1 },
                  ]}
                >
                  <Text style={[styles.templateName, { color: c.text }]}>{t.name}</Text>
                  <Text style={{ color: c.muted, fontSize: 13 }}>{counts[t.id] ?? 0} exercises</Text>
                </Pressable>
              ))}
            </View>
          ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  body: { padding: 16, gap: 12, paddingBottom: 48 },
  card: { padding: 16, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, gap: 4 },
  title: { fontSize: 18, fontWeight: "600" },
  gap: { marginTop: 12 },
  links: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  link: { flexGrow: 1, flexBasis: "30%" },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 12 },
  heading: { fontSize: 17, fontWeight: "600" },
  section: { gap: 8 },
  folder: { fontSize: 13, fontWeight: "600", marginTop: 4 },
  template: { padding: 14, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, gap: 2 },
  templateName: { fontSize: 16, fontWeight: "600" },
});
