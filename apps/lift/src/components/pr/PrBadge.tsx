import { useEffect, useRef } from "react";
import { Animated, StyleSheet, Text, View } from "react-native";
import type { SetPrKind } from "../../lib/prs";
import { useColors } from "../theme";

interface Props {
  kinds: readonly SetPrKind[];
  /** bumps when this set was just checked as a pr; 0 = show without fanfare */
  celebrate: number;
}

const LABEL: Record<SetPrKind, string> = { e1rm: "e1rm", weight: "heaviest", reps_at_weight: "reps" };

/** "pr" pill pinned to a set row's corner, plus a one-shot flash when it's new */
export function PrBadge({ kinds, celebrate }: Props) {
  const c = useColors();
  const scale = useRef(new Animated.Value(1)).current;
  const flash = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!celebrate) return;
    scale.setValue(0.3);
    flash.setValue(0.45);
    const anim = Animated.parallel([
      Animated.sequence([
        Animated.spring(scale, { toValue: 1.35, useNativeDriver: true, speed: 30, bounciness: 14 }),
        Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 20, bounciness: 8 }),
      ]),
      Animated.timing(flash, { toValue: 0, duration: 900, useNativeDriver: true }),
    ]);
    anim.start();
    return () => anim.stop();
  }, [celebrate, scale, flash]);

  if (kinds.length === 0) return null;
  return (
    <View style={[StyleSheet.absoluteFill, styles.passThrough]}>
      <Animated.View style={[StyleSheet.absoluteFill, styles.flash, { backgroundColor: c.accent, opacity: flash }]} />
      <Animated.View
        accessible
        accessibilityLabel={`personal record: ${kinds.map((k) => LABEL[k]).join(", ")}`}
        style={[styles.pill, { backgroundColor: c.accent, transform: [{ scale }] }]}
      >
        <Text style={[styles.text, { color: c.accentText }]}>pr</Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  passThrough: { pointerEvents: "none" },
  flash: { borderRadius: 8 },
  // sits on the set-number corner so it never covers an input
  pill: { position: "absolute", top: 0, left: 2, paddingHorizontal: 4, paddingVertical: 1, borderRadius: 6 },
  text: { fontSize: 9, fontWeight: "800", letterSpacing: 0.3 },
});
