import { StyleSheet, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import { BODY_FIGURES, MUSCLE_REGION_LABELS, type BodyView, type MuscleRegion } from "lift-core";
import { useColors } from "./theme";
import { intensityOf, topRegions } from "../lib/bodyLoad";

interface Props {
  /** normalized 0..1 per region */
  load: Partial<Record<MuscleRegion, number>>;
  /** height of each figure in px */
  size?: number;
  views?: BodyView[];
}

const STEPS = 4;

function aspect(viewBox: string): number {
  const [, , w, h] = viewBox.split(/\s+/).map(Number);
  return w && h ? w / h : 200 / 420;
}

export function BodyFigure({ load, size = 220, views = ["front", "back"] }: Props) {
  const c = useColors();
  const top = topRegions(load, 3).map((r) => MUSCLE_REGION_LABELS[r]);
  const label = top.length ? `muscles worked, most: ${top.join(", ")}` : "muscles worked: none";

  return (
    <View accessible accessibilityRole="image" accessibilityLabel={label} style={styles.row}>
      {views.map((v) => {
        const fig = BODY_FIGURES[v];
        // the art may not be drawn yet; keep the space so layouts don't jump
        if (!fig) return null;
        return (
          <Svg key={v} width={size * aspect(fig.viewBox)} height={size} viewBox={fig.viewBox}>
            {fig.outline ? <Path d={fig.outline} fill={c.steps[0]} stroke={c.border} strokeWidth={1.5} /> : null}
            {fig.shapes.map((s, i) => {
              const step = s.region ? intensityOf(load[s.region], STEPS) : 0;
              return <Path key={i} d={s.d} fill={c.steps[step] ?? c.steps[0]} stroke={c.border} strokeWidth={0.75} />;
            })}
          </Svg>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", justifyContent: "center", gap: 12 },
});
