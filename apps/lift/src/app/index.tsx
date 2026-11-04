import { useEffect, useMemo } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { getActiveWorkout, startWorkout } from "../db/workouts";
import { Button } from "../components/Button";
import { useColors } from "../components/theme";
import { useDbVersion } from "../components/useDbVersion";
import { formatElapsed } from "../lib/format";

// reopen an active workout once per launch (it survives the app being killed);
// after that, backing out to home should stay on home
let reopened = false;

export default function Home() {
  const c = useColors();
  const version = useDbVersion();
  const active = useMemo(() => getActiveWorkout(), [version]);

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
      <Button label="exercises" variant="plain" onPress={() => router.push("/exercises")} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  body: { padding: 16, gap: 12 },
  card: { padding: 16, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, gap: 4 },
  title: { fontSize: 18, fontWeight: "600" },
  gap: { marginTop: 12 },
});
