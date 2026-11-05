// the metrics input built from the published track: only the visible (post-
// trim, post-fog) samples, in their segments. d advances only within a segment
// (the distance between two visible segments is never counted), so nothing
// about the hidden stretch can be read back from it.

import type { TrackRecord } from "../geo";
import type { MetricSample } from "./types";

export function metricSegments(
  segments: { t: number }[][],
  recordAt: (t: number) => TrackRecord | undefined,
  cumAt: (t: number) => number | undefined
): MetricSample[][] {
  const out: MetricSample[][] = [];
  let d = 0;
  for (const seg of segments) {
    const run: MetricSample[] = [];
    let prevCum: number | null = null;
    for (const s of seg) {
      const r = recordAt(s.t);
      const cum = cumAt(s.t);
      if (!r || cum === undefined || !Number.isFinite(cum)) continue;
      if (prevCum !== null) d += Math.max(0, cum - prevCum);
      prevCum = cum;
      run.push({ t: r.t, d, ele: r.ele, hr: r.hr, watts: r.watts, cadence: r.cadence, speed: r.speed });
    }
    if (run.length) out.push(run);
  }
  return out;
}
