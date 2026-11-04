import { useEffect, useMemo } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { router, type Href } from "expo-router";
import { getActiveWorkout, startWorkout } from "../db/workouts";
import { listFolders, listTemplates, templateExerciseCounts } from "../db/templates";
import { Button } from "../components/Button";
import { startTemplate } from "../components/library/startTemplate";
import { useColors } from "../components/theme";
import { useDbVersion } from "../components/useDbVersion";
import { formatElapsed } from "../lib/format";
import { groupTemplates } from "../lib/templates";

// reopen an active workout once per launch (it survives the app being killed);
// after that, backing out to home should stay on home
let reopened = false;

const LINKS: { label: string; href: Href }[] = [
  { label: "history", href: "/history" },
  { label: "exercises", href: "/exercises" },
  { label: "templates", href: "/templates" },
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

  useEffect(() => {
    if (reopened) return;
    reopened = true;
    if (active) router.push("/workout");
  }, [active]);

  return (
    <ScrollView style={{ backgroundColor: c.bg }} contentContainerStyle={styles.body}>
      {active ? (
        <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
          <Text style={[styles.title, { color: c.text }]}>{active.title}</Text>
          <Text style={{ color: c.muted }}>in progress · started {formatElapsed(Date.now() - active.startedAt)} ago</Text>
          <Button label="resume" onPress={() => router.push("/workout")} style={styles.gap} />
        </View>
      ) : (
        <Button
          label="start empty workout"
          onPress={() => {
            startWorkout();
            router.push("/workout");
          }}
        />
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
