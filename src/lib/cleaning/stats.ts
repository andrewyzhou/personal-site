// stats for cleaned tracks + per-activity metrics. untouched activities keep
// the legacy numbers (device totals / computeStats) so nothing shifts unless
// the owner edits; these run once an activity has cleaning edits.

import type { ComputedStats, TrackRecord } from "../geo";
import type { RawStats } from "../db/schema";
import { computeStats } from "../geo";
import { sportLimits } from "./sport";

const MOVING_GAP_MAX_S = 10;
const ELEV_SMOOTH_HALF = 2; // 5-sample moving average
const ELEV_HYSTERESIS_M = 2; // ignore wiggles smaller than this

// elevation gain: smoothed, then only climbs that clear the hysteresis band
export function smoothedElevationGain(eles: (number | null)[], breaks?: boolean[]): number {
  let gain = 0;
  // smooth within each continuous run
  let run: number[] = [];
  const flush = () => {
    if (run.length >= 2) {
      const sm = run.map((_, i) => {
        const lo = Math.max(0, i - ELEV_SMOOTH_HALF);
        const hi = Math.min(run.length - 1, i + ELEV_SMOOTH_HALF);
        let s = 0;
        for (let j = lo; j <= hi; j++) s += run[j];
        return s / (hi - lo + 1);
      });
      let ref = sm[0];
      for (const v of sm) {
        if (v > ref + ELEV_HYSTERESIS_M) {
          gain += v - ref;
          ref = v;
        } else if (v < ref) {
          ref = v;
        }
      }
    }
    run = [];
  };
  for (let i = 0; i < eles.length; i++) {
    if (breaks?.[i]) flush();
    const e = eles[i];
    if (e !== null && Number.isFinite(e)) run.push(e);
  }
  flush();
  return gain;
}

// moving time and stats over a cleaned track: a step counts as moving when it
// is short (no recording gap), not across a discontinuity, and faster than the
// sport's idle speed (stoplights, photo stops and café breaks don't count)
export function cleanedStats(
  records: TrackRecord[],
  cumDist: number[],
  breaks: boolean[],
  excludedS: number,
  sportType: string
): ComputedStats {
  if (records.length === 0) {
    return computeStats([], []);
  }
  const { idle } = sportLimits(sportType);
  let movingTimeS = 0;
  for (let i = 1; i < records.length; i++) {
    if (breaks[i]) continue;
    const dt = records[i].t - records[i - 1].t;
    if (dt <= 0 || dt > MOVING_GAP_MAX_S) continue;
    const v = records[i].speed ?? (cumDist[i] - cumDist[i - 1]) / dt;
    if (v >= idle) movingTimeS += dt;
  }
  const base = computeStats(records, cumDist);
  const distanceM = cumDist[cumDist.length - 1] - cumDist[0];
  const elapsedTimeS = Math.max(0, Math.round(records[records.length - 1].t - records[0].t - excludedS));
  return {
    ...base,
    distanceM,
    movingTimeS: Math.round(movingTimeS),
    elapsedTimeS,
    elevGainM: smoothedElevationGain(records.map((r) => r.ele), breaks),
    avgSpeedMs: movingTimeS > 0 ? distanceM / movingTimeS : 0,
  };
}

// seconds in each of 5 heart-rate zones (z1..z5), time-weighted by the step
// to the next sample, skipping gaps and discontinuities
export function hrZoneSeconds(
  records: TrackRecord[],
  breaks: boolean[],
  hrMaxBpm: number,
  zonePcts: number[]
): number[] | null {
  const bounds = zonePcts.map((p) => p * hrMaxBpm);
  const zones = [0, 0, 0, 0, 0];
  let any = false;
  for (let i = 1; i < records.length; i++) {
    if (breaks[i]) continue;
    const hr = records[i - 1].hr;
    const dt = records[i].t - records[i - 1].t;
    if (hr === null || dt <= 0 || dt > MOVING_GAP_MAX_S) continue;
    let z = 0;
    while (z < bounds.length && hr >= bounds[z]) z++;
    zones[z] += dt;
    any = true;
  }
  return any ? zones.map((s) => Math.round(s)) : null;
}

// the untouched track's stats: device totals when the file has them
export function rawStatsOf(session: ComputedStats | null, records: TrackRecord[], cumDist: number[]): RawStats {
  const s = session ?? computeStats(records, cumDist);
  return {
    distanceM: s.distanceM,
    movingTimeS: s.movingTimeS,
    elapsedTimeS: s.elapsedTimeS,
    elevGainM: s.elevGainM,
    avgSpeedMs: s.avgSpeedMs,
    maxSpeedMs: s.maxSpeedMs,
    avgHr: s.avgHr,
    maxHr: s.maxHr,
  };
}
