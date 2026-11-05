// per-activity metrics, computed by republish from the published track only
// (post-cleaning, post-trim, post-fog). nothing here is derived from points
// inside a privacy zone: every computation runs within one visible segment,
// and a fog or cut gap is never bridged (no effort, split or climb spans one).

export const METRICS_FORMAT_VERSION = 1;

// one published sample. d is cumulative metres along the visible route of
// the whole activity (gaps add nothing), t is seconds since the track start.
export interface MetricSample {
  t: number;
  d: number;
  ele: number | null;
  hr: number | null;
  watts: number | null;
  cadence: number | null;
  speed: number | null; // device m/s when present
}

export interface MetricsInput {
  segments: MetricSample[][]; // visible runs in order; never joined
  sportType: string;
  hrMaxBpm: number | null; // owner setting; null → no hr-based effort
  hrRestBpm: number | null;
  thresholdPaceSPerKm: number | null; // owner setting; null → no pace zones
}

export interface Split {
  index: number; // 1-based
  distM: number; // visible metres in this split (last one is usually short)
  timeS: number; // elapsed seconds within visible segments
  movingS: number;
  paceSPerKm: number | null; // moving pace (foot sports); null without movement
  gapSPerKm: number | null; // grade-adjusted pace (foot sports with elevation)
  elevGainM: number | null;
  elevLossM: number | null;
  avgHr: number | null;
  partial: boolean; // a gap (fog/cut) fell inside this split; its time excludes the gap
}

export interface BestEffort {
  key: string; // "400m" | "1k" | "1mi" | "5k" | "10k" | "half" | "marathon" | ...
  distM: number;
  timeS: number;
  startS: number; // track time where it starts (for replay / chart highlight)
}

export interface CurvePoint {
  durS: number;
  value: number; // watts (power curve) or m/s (speed curve)
}

export interface Climb {
  startD: number;
  endD: number;
  startS: number;
  endS: number;
  gainM: number;
  distM: number;
  avgGradePct: number;
  maxGradePct: number;
  category: "4" | "3" | "2" | "1" | "hc" | null; // by gain × grade score, null = uncategorized but notable
}

export interface ActivityMetrics {
  v: typeof METRICS_FORMAT_VERSION;
  sportType: string;
  movingS: number;
  elapsedS: number; // visible segments only
  distM: number; // visible metres
  movingPaceSPerKm: number | null; // foot sports
  movingSpeedMs: number | null; // everything with distance
  gapSPerKm: number | null; // foot sports with elevation
  splitsKm: Split[];
  splitsMi: Split[];
  bestEfforts: BestEffort[]; // foot: distance efforts; ride: none (use curves)
  speedCurve: CurvePoint[] | null; // rides: best average speed for each duration
  powerCurve: CurvePoint[] | null; // anything with watts
  paceZonesS: number[] | null; // foot sports: seconds in each pace zone (z1..z5)
  effort: number | null; // hr-based training load (TRIMP-style); null without hr / hr max
  climbs: Climb[];
}
