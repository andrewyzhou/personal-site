import { useState } from "react";
import { StyleSheet, Text, View, type LayoutChangeEvent } from "react-native";
import Svg, { Circle, Line, Polyline, Text as SvgText } from "react-native-svg";
import { useColors } from "../theme";
import { polylinePoints, scalePoints, type ChartPoint } from "./scale";

interface Props {
  title: string;
  data: readonly ChartPoint[];
  formatY: (v: number) => string;
  formatX?: (v: number) => string;
  height?: number;
}

const PAD = { padLeft: 44, padRight: 10, padTop: 10, padBottom: 22 };

function shortDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getMonth() + 1}/${d.getDate()}/${String(d.getFullYear()).slice(2)}`;
}

/** small svg line chart: min/max labels on both axes, points joined by a polyline */
export function LineChart({ title, data, formatY, formatX = shortDate, height = 160 }: Props) {
  const c = useColors();
  const [width, setWidth] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => setWidth(Math.round(e.nativeEvent.layout.width));
  const scaled = width > 0 ? scalePoints(data, { width, height, ...PAD }) : null;
  const bottom = height - PAD.padBottom;
  const right = width - PAD.padRight;

  return (
    <View style={styles.wrap} onLayout={onLayout}>
      <Text style={[styles.title, { color: c.muted }]}>{title}</Text>
      {data.length === 0 ? (
        <Text style={{ color: c.muted }}>no data yet</Text>
      ) : scaled ? (
        <Svg width={width} height={height}>
          <Line x1={PAD.padLeft} y1={PAD.padTop} x2={PAD.padLeft} y2={bottom} stroke={c.border} strokeWidth={1} />
          <Line x1={PAD.padLeft} y1={bottom} x2={right} y2={bottom} stroke={c.border} strokeWidth={1} />
          <SvgText x={PAD.padLeft - 4} y={PAD.padTop + 8} fontSize={10} fill={c.muted} textAnchor="end">
            {formatY(scaled.maxY)}
          </SvgText>
          <SvgText x={PAD.padLeft - 4} y={bottom} fontSize={10} fill={c.muted} textAnchor="end">
            {formatY(scaled.minY)}
          </SvgText>
          <SvgText x={PAD.padLeft} y={height - 6} fontSize={10} fill={c.muted} textAnchor="start">
            {formatX(scaled.minX)}
          </SvgText>
          {scaled.maxX !== scaled.minX ? (
            <SvgText x={right} y={height - 6} fontSize={10} fill={c.muted} textAnchor="end">
              {formatX(scaled.maxX)}
            </SvgText>
          ) : null}
          {scaled.points.length > 1 ? (
            <Polyline points={polylinePoints(scaled.points)} fill="none" stroke={c.accent} strokeWidth={2} />
          ) : null}
          {scaled.points.map((p, i) => (
            <Circle key={i} cx={p.x} cy={p.y} r={3} fill={c.accent} />
          ))}
        </Svg>
      ) : (
        <View style={{ height }} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 16 },
  title: { fontSize: 13, marginBottom: 6 },
});
