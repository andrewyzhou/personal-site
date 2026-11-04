import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { REST_STEP_S, formatRest, fractionLeft, remainingS } from "../../lib/rest";
import { useColors } from "../theme";
import { adjustRest, clearRest, useRestTimer } from "./restTimer";

function useTick(active: boolean, ms = 250): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [active, ms]);
  return now;
}

/** countdown pinned under the logger while a rest runs */
export function RestBar({ label }: { label?: string }) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const timer = useRestTimer();
  const now = useTick(timer != null);
  if (!timer) return null;

  const left = remainingS(timer, now);
  const frac = fractionLeft(timer, now);

  return (
    <View style={[styles.bar, { backgroundColor: c.card, borderColor: c.border, paddingBottom: 10 + insets.bottom }]}>
      <View style={[styles.track, { backgroundColor: c.input }]}>
        <View style={[styles.fill, { backgroundColor: c.accent, width: `${frac * 100}%` }]} />
      </View>
      <View style={styles.row}>
        <View style={styles.flex}>
          <Text style={[styles.time, { color: c.text }]}>{formatRest(left)}</Text>
          <Text style={[styles.label, { color: c.muted }]} numberOfLines={1}>
            {label ? `rest · ${label}` : "rest"}
          </Text>
        </View>
        <Step text={`-${REST_STEP_S}`} onPress={() => adjustRest(-REST_STEP_S)} />
        <Step text={`+${REST_STEP_S}`} onPress={() => adjustRest(REST_STEP_S)} />
        <Step text="skip" onPress={clearRest} />
      </View>
    </View>
  );
}

function Step({ text, onPress }: { text: string; onPress: () => void }) {
  const c = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.step, { backgroundColor: c.input, opacity: pressed ? 0.6 : 1 }]}
    >
      <Text style={[styles.stepText, { color: c.text }]}>{text}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: { borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: 12, paddingTop: 0, paddingBottom: 10 },
  track: { height: 3, marginHorizontal: -12, marginBottom: 8 },
  fill: { height: 3 },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  flex: { flex: 1 },
  time: { fontSize: 22, fontWeight: "700", fontVariant: ["tabular-nums"] },
  label: { fontSize: 12 },
  step: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, minWidth: 48, alignItems: "center" },
  stepText: { fontSize: 15, fontWeight: "600", fontVariant: ["tabular-nums"] },
});
