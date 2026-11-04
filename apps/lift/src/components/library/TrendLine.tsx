import { useState } from "react";
import { View } from "react-native";
import Svg, { Polyline } from "react-native-svg";
import type { WeightUnit } from "lift-core";
import { trendPoints, type WeighIn } from "../../lib/bodyweight";
import { useColors } from "../theme";

interface Props {
  entries: readonly WeighIn[];
  unit: WeightUnit;
  height?: number;
}

/** bare polyline of weigh-ins over time; width follows the container */
export function TrendLine({ entries, unit, height = 64 }: Props) {
  const c = useColors();
  const [width, setWidth] = useState(0);
  const points = width ? trendPoints(entries, unit, width, height) : "";
  return (
    <View style={{ height }} onLayout={(e) => setWidth(Math.round(e.nativeEvent.layout.width))}>
      {points ? (
        <Svg width={width} height={height}>
          <Polyline points={points} fill="none" stroke={c.accent} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        </Svg>
      ) : null}
    </View>
  );
}
