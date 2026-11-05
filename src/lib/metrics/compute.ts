// per-activity metrics from the published track. pure and deterministic.
// every computation runs inside one visible segment: nothing (moving step,
// effort, curve window, climb) bridges a fog or cut gap between segments.

import { sportLimits } from "../cleaning/sport";
import type {
  ActivityMetrics,
  BestEffort,
  Climb,
  CurvePoint,
  MetricSample,
  MetricsInput,
  Split,
} from "./types";
import { METRICS_FORMAT_VERSION } from "./types";

const MOVING_GAP_MAX_S = 10; // longer steps are recording gaps, never moving
const ELEV_SMOOTH_HALF = 2; // 5-sample moving average
const ELEV_HYSTERESIS_M = 2; // ignore wiggles smaller than this
const GRADE_HALF_WINDOW_M = 20; // grade over ~40 m of smoothed elevation
const GRADE_CLAMP = 0.45;

const FOOT_SPORTS: ReadonlySet<string> = new Set(["Run", "TrailRun", "VirtualRun", "Walk", "Hike"]);
const RIDE_SPORTS: ReadonlySet<string> = new Set(["Ride", "VirtualRide", "MountainBikeRide", "GravelRide", "EBikeRide"]);

export const KM_M = 1000;
export const MILE_M = 1609.344;

export const BEST_EFFORT_DISTANCES: ReadonlyArray<{ key: string; distM: number }> = [
  { key: "400m", distM: 400 },
  { key: "half-mile", distM: 805 },
  { key: "1k", distM: 1000 },
  { key: "1mi", distM: 1609.344 },
  { key: "2mi", distM: 3218.688 },
  { key: "5k", distM: 5000 },
  { key: "10k", distM: 10000 },
  { key: "15k", distM: 15000 },
  { key: "10mi", distM: 16093.44 },
  { key: "20k", distM: 20000 },
  { key: "half", distM: 21097.5 },
  { key: "30k", distM: 30000 },
  { key: "marathon", distM: 42195 },
];

export const CURVE_DURATIONS_S: readonly number[] = [5, 10, 30, 60, 120, 300, 600, 1200, 1800, 3600, 5400, 7200];

// pace zone boundaries as multiples of threshold pace (slowest first)
export const PACE_ZONE_FACTORS: readonly number[] = [1.29, 1.14, 1.06, 0.99];

const r0 = (x: number) => Math.round(x);
const r1 = (x: number) => Math.round(x * 10) / 10;
const r2 = (x: number) => Math.round(x * 100) / 100;

export function isFootSport(sportType: string): boolean {
  return FOOT_SPORTS.has(sportType);
}

export function isRideSport(sportType: string): boolean {
  return RIDE_SPORTS.has(sportType);
}

// ---------------------------------------------------------------- moving

// a step a→b is moving when it is short (not a recording gap) and faster than
// the sport's idle speed (device speed when present, else Δd/Δt)
export function isMovingStep(a: MetricSample, b: MetricSample, idle: number): boolean {
  const dt = b.t - a.t;
  if (!(dt > 0) || dt > MOVING_GAP_MAX_S) return false;
  const v = b.speed ?? (b.d - a.d) / dt;
  return v >= idle;
}

// moving seconds (unrounded), summed per segment
export function movingTimeS(segments: MetricSample[][], sportType: string): number {
  const { idle } = sportLimits(sportType);
  let s = 0;
  for (const seg of segments) {
    for (let i = 1; i < seg.length; i++) {
      if (isMovingStep(seg[i - 1], seg[i], idle)) s += seg[i].t - seg[i - 1].t;
    }
  }
  return s;
}

// ---------------------------------------------------------------- elevation

// one segment's elevation, gaps in the ele channel filled by interpolation
// along distance, then a 5-sample moving average. null without any elevation
export function smoothedElevation(seg: MetricSample[]): number[] | null {
  const n = seg.length;
  const known: number[] = [];
  for (let i = 0; i < n; i++) {
    const e = seg[i].ele;
    if (e !== null && Number.isFinite(e)) known.push(i);
  }
  if (known.length === 0) return null;
  const filled = new Array<number>(n);
  const first = known[0];
  const lastK = known[known.length - 1];
  for (let i = 0; i <= first; i++) filled[i] = seg[first].ele as number;
  for (let k = 1; k < known.length; k++) {
    const a = known[k - 1];
    const b = known[k];
    const ea = seg[a].ele as number;
    const eb = seg[b].ele as number;
    const span = seg[b].d - seg[a].d;
    for (let i = a + 1; i <= b; i++) {
      const f = span > 0 ? (seg[i].d - seg[a].d) / span : (i - a) / (b - a);
      filled[i] = ea + (eb - ea) * f;
    }
  }
  for (let i = lastK; i < n; i++) filled[i] = seg[lastK].ele as number;
  const pre = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + filled[i];
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const lo = Math.max(0, i - ELEV_SMOOTH_HALF);
    const hi = Math.min(n - 1, i + ELEV_SMOOTH_HALF);
    out[i] = (pre[hi + 1] - pre[lo]) / (hi - lo + 1);
  }
  return out;
}

// gain and loss with hysteresis: a direction only counts once it has moved
// more than the band from the last extreme; from then on every new extreme
// in that direction is credited to the sample that reaches it. wiggles
// smaller than the band inside a climb or descent never add anything
export function elevationChanges(ele: number[]): { gain: number[]; loss: number[] } {
  const n = ele.length;
  const gain = new Array<number>(n).fill(0);
  const loss = new Array<number>(n).fill(0);
  if (n === 0) return { gain, loss };
  let mode: 0 | 1 | -1 = 0; // 0 until the first move clears the band
  let hi = ele[0];
  let lo = ele[0];
  for (let i = 1; i < n; i++) {
    const v = ele[i];
    if (mode === 1) {
      if (v > hi) {
        gain[i] = v - hi;
        hi = v;
      } else if (v < hi - ELEV_HYSTERESIS_M) {
        loss[i] = hi - v;
        lo = v;
        mode = -1;
      }
    } else if (mode === -1) {
      if (v < lo) {
        loss[i] = lo - v;
        lo = v;
      } else if (v > lo + ELEV_HYSTERESIS_M) {
        gain[i] = v - lo;
        hi = v;
        mode = 1;
      }
    } else {
      if (v > lo + ELEV_HYSTERESIS_M) {
        gain[i] = v - lo;
        hi = v;
        mode = 1;
      } else if (v < hi - ELEV_HYSTERESIS_M) {
        loss[i] = hi - v;
        lo = v;
        mode = -1;
      } else {
        hi = Math.max(hi, v);
        lo = Math.min(lo, v);
      }
    }
  }
  return { gain, loss };
}

// grade (fraction) at each sample, from smoothed elevation over a distance
// window of at least ±20 m (two pointers, O(n))
export function gradeSeries(seg: MetricSample[], ele: number[]): number[] {
  const n = seg.length;
  const out = new Array<number>(n).fill(0);
  let lo = 0;
  let hi = 0;
  for (let i = 0; i < n; i++) {
    const d = seg[i].d;
    while (lo + 1 <= i && seg[lo + 1].d <= d - GRADE_HALF_WINDOW_M) lo++;
    if (hi < i) hi = i;
    while (hi < n - 1 && seg[hi].d < d + GRADE_HALF_WINDOW_M) hi++;
    const span = seg[hi].d - seg[lo].d;
    out[i] = span > 0 ? (ele[hi] - ele[lo]) / span : 0;
  }
  return out;
}

// energy cost of running at a grade relative to flat ground, from the
// Minetti et al. (2002) polynomial (J/kg/m), grade clamped to ±45%
export function minettiCostRatio(grade: number): number {
  const i = Math.max(-GRADE_CLAMP, Math.min(GRADE_CLAMP, Number.isFinite(grade) ? grade : 0));
  const c = 155.4 * i ** 5 - 30.4 * i ** 4 - 43.3 * i ** 3 + 46.3 * i ** 2 + 19.5 * i + 3.6;
  return c / 3.6;
}

// ---------------------------------------------------------------- per-segment prep

interface Prepared {
  seg: MetricSample[];
  ele: number[] | null;
  grade: number[] | null;
  gain: number[] | null;
  loss: number[] | null;
}

function prepare(seg: MetricSample[]): Prepared {
  const ele = seg.length >= 1 ? smoothedElevation(seg) : null;
  if (!ele) return { seg, ele: null, grade: null, gain: null, loss: null };
  const { gain, loss } = elevationChanges(ele);
  return { seg, ele, grade: gradeSeries(seg, ele), gain, loss };
}

// cost ratio of the step ending at sample i
function stepCost(p: Prepared, i: number): number {
  if (!p.grade) return 1;
  return minettiCostRatio((p.grade[i - 1] + p.grade[i]) / 2);
}

// ---------------------------------------------------------------- GAP

// moving pace over flat-equivalent distance (s/km). null for non-foot sports
// and activities without elevation
export function gradeAdjustedPace(segments: MetricSample[][], sportType: string): number | null {
  if (!isFootSport(sportType)) return null;
  const { idle } = sportLimits(sportType);
  const preps = segments.map(prepare);
  if (!preps.some((p) => p.ele)) return null;
  let distM = 0;
  let moving = 0;
  let movingDist = 0;
  let eqDist = 0;
  for (const p of preps) {
    const s = p.seg;
    if (s.length >= 2) distM += s[s.length - 1].d - s[0].d;
    for (let i = 1; i < s.length; i++) {
      if (!isMovingStep(s[i - 1], s[i], idle)) continue;
      const dd = s[i].d - s[i - 1].d;
      moving += s[i].t - s[i - 1].t;
      movingDist += dd;
      eqDist += dd * stepCost(p, i);
    }
  }
  if (moving <= 0 || distM <= 0 || eqDist <= 0) return null;
  return r0((moving / (distM / 1000)) * (movingDist / eqDist));
}

// ---------------------------------------------------------------- splits

// splits on cumulative visible distance. a split containing a segment
// boundary is partial; its time only counts time inside segments
export function computeSplits(segments: MetricSample[][], sportType: string, splitM: number): Split[] {
  const foot = isFootSport(sportType);
  const { idle } = sportLimits(sportType);
  const preps = segments.filter((s) => s.length > 0).map(prepare);
  const hasEle = preps.some((p) => p.ele);
  let total = 0;
  const boundaries: number[] = [];
  preps.forEach((p, k) => {
    if (k > 0) boundaries.push(total);
    const s = p.seg;
    for (let i = 1; i < s.length; i++) total += Math.max(0, s[i].d - s[i - 1].d);
  });
  if (!(total > 0) || !(splitM > 0)) return [];
  const n = Math.max(1, Math.ceil((total - 1) / splitM));
  const idxOf = (x: number) => Math.max(0, Math.min(n - 1, Math.floor(x / splitM)));
  const dist = new Float64Array(n);
  const time = new Float64Array(n);
  const mov = new Float64Array(n);
  const movDist = new Float64Array(n);
  const eqDist = new Float64Array(n);
  const gain = new Float64Array(n);
  const loss = new Float64Array(n);
  const hrSum = new Float64Array(n);
  const hrT = new Float64Array(n);

  let x = 0;
  for (const p of preps) {
    const s = p.seg;
    for (let i = 1; i < s.length; i++) {
      const a = s[i - 1];
      const b = s[i];
      const dt = Math.max(0, b.t - a.t);
      const dd = Math.max(0, b.d - a.d);
      const moving = isMovingStep(a, b, idle);
      const cost = moving ? stepCost(p, i) : 1;
      const hr = a.hr ?? b.hr;
      const hrOk = hr !== null && dt <= MOVING_GAP_MAX_S;
      const add = (j: number, fdd: number, fdt: number) => {
        dist[j] += fdd;
        time[j] += fdt;
        if (moving) {
          mov[j] += fdt;
          movDist[j] += fdd;
          eqDist[j] += fdd * cost;
        }
        if (hrOk) {
          hrSum[j] += (hr as number) * fdt;
          hrT[j] += fdt;
        }
      };
      const xb = x + dd;
      if (dd <= 0) {
        add(idxOf(x), 0, dt);
      } else {
        let cx = x;
        while (cx < xb) {
          const j = idxOf(cx);
          const end = j === n - 1 ? xb : Math.min(xb, (j + 1) * splitM);
          if (end <= cx) {
            add(j, xb - cx, (dt * (xb - cx)) / dd);
            break;
          }
          add(j, end - cx, (dt * (end - cx)) / dd);
          cx = end;
        }
      }
      if (p.gain && p.loss) {
        const j = idxOf(dd > 0 ? xb - 1e-6 : xb);
        gain[j] += p.gain[i];
        loss[j] += p.loss[i];
      }
      x = xb;
    }
  }

  const partial = new Array<boolean>(n).fill(false);
  for (const bx of boundaries) {
    const j = idxOf(bx);
    if (bx > j * splitM + 1e-6) partial[j] = true;
  }

  const out: Split[] = [];
  for (let j = 0; j < n; j++) {
    const paceRaw = foot && mov[j] > 0 && dist[j] > 0 ? mov[j] / (dist[j] / 1000) : null;
    out.push({
      index: j + 1,
      distM: r1(dist[j]),
      timeS: r0(time[j]),
      movingS: r0(mov[j]),
      paceSPerKm: paceRaw === null ? null : r0(paceRaw),
      gapSPerKm: paceRaw !== null && hasEle && eqDist[j] > 0 ? r0(paceRaw * (movDist[j] / eqDist[j])) : null,
      elevGainM: hasEle ? r1(gain[j]) : null,
      elevLossM: hasEle ? r1(loss[j]) : null,
      avgHr: hrT[j] > 0 ? r0(hrSum[j] / hrT[j]) : null,
      partial: partial[j],
    });
  }
  return out;
}

// ---------------------------------------------------------------- best efforts

// fastest elapsed time to cover distM inside one segment: start at a sample,
// end interpolated along distance. null when the segment is too short
export function fastestOver(seg: MetricSample[], distM: number): { timeS: number; startS: number } | null {
  const n = seg.length;
  if (n < 2 || seg[n - 1].d - seg[0].d < distM) return null;
  let best = Infinity;
  let bestStart = 0;
  let j = 1;
  for (let i = 0; i < n - 1; i++) {
    const target = seg[i].d + distM;
    if (seg[n - 1].d < target) break;
    if (j <= i) j = i + 1;
    while (seg[j].d < target) j++;
    const a = seg[j - 1];
    const b = seg[j];
    const span = b.d - a.d;
    const tEnd = span > 0 ? a.t + ((b.t - a.t) * (target - a.d)) / span : b.t;
    const time = tEnd - seg[i].t;
    if (time < best) {
      best = time;
      bestStart = seg[i].t;
    }
  }
  return Number.isFinite(best) ? { timeS: best, startS: bestStart } : null;
}

// foot sports only; distances covered within a single segment
export function bestEfforts(segments: MetricSample[][], sportType: string): BestEffort[] {
  if (!isFootSport(sportType)) return [];
  const out: BestEffort[] = [];
  for (const { key, distM } of BEST_EFFORT_DISTANCES) {
    let best: { timeS: number; startS: number } | null = null;
    for (const seg of segments) {
      const f = fastestOver(seg, distM);
      if (f && (!best || f.timeS < best.timeS)) best = f;
    }
    if (best) out.push({ key, distM, timeS: r0(best.timeS), startS: r0(best.startS) });
  }
  return out;
}

// ---------------------------------------------------------------- curves

// best mean rate of `cum` over a window of durS starting at a sample, with
// cum linearly interpolated in time at the window end. O(n) two pointers
function bestWindowRate(t: number[], cum: number[], durS: number): number | null {
  const n = t.length;
  if (n < 2 || t[n - 1] - t[0] < durS) return null;
  let best = -Infinity;
  let j = 1;
  for (let i = 0; i < n - 1; i++) {
    const end = t[i] + durS;
    if (t[n - 1] < end) break;
    if (j <= i) j = i + 1;
    while (t[j] < end) j++;
    const span = t[j] - t[j - 1];
    const cEnd = span > 0 ? cum[j - 1] + ((cum[j] - cum[j - 1]) * (end - t[j - 1])) / span : cum[j];
    const v = (cEnd - cum[i]) / durS;
    if (v > best) best = v;
  }
  return Number.isFinite(best) ? best : null;
}

function curveFrom(series: { t: number[]; cum: number[] }[], round: (x: number) => number): CurvePoint[] | null {
  const out: CurvePoint[] = [];
  for (const durS of CURVE_DURATIONS_S) {
    let best: number | null = null;
    for (const s of series) {
      const v = bestWindowRate(s.t, s.cum, durS);
      if (v !== null && (best === null || v > best)) best = v;
    }
    if (best === null) break; // longer windows won't fit either
    const prev = out.length ? out[out.length - 1].value : Infinity;
    out.push({ durS, value: Math.min(prev, round(Math.max(0, best))) });
  }
  return out.length ? out : null;
}

// best mean watts per duration, time-weighted (each step carries its start
// sample's watts; a missing reading inside the segment counts as 0)
export function powerCurve(segments: MetricSample[][]): CurvePoint[] | null {
  if (!segments.some((s) => s.some((p) => p.watts !== null && Number.isFinite(p.watts)))) return null;
  const series = segments.map((seg) => {
    const t = seg.map((p) => p.t);
    const cum = new Array<number>(seg.length).fill(0);
    for (let i = 1; i < seg.length; i++) {
      const w = seg[i - 1].watts;
      const dt = Math.max(0, seg[i].t - seg[i - 1].t);
      cum[i] = cum[i - 1] + (w !== null && Number.isFinite(w) ? w : 0) * dt;
    }
    return { t, cum };
  });
  return curveFrom(series, r0);
}

// rides: best average speed (Δd/Δt, m/s) per duration
export function speedCurve(segments: MetricSample[][], sportType: string): CurvePoint[] | null {
  if (!isRideSport(sportType)) return null;
  const series = segments.map((seg) => ({ t: seg.map((p) => p.t), cum: seg.map((p) => p.d) }));
  return curveFrom(series, r2);
}

// ---------------------------------------------------------------- pace zones

// seconds in each of 5 pace zones (z1 slowest .. z5 fastest), moving steps only
export function paceZones(
  segments: MetricSample[][],
  sportType: string,
  thresholdPaceSPerKm: number | null
): number[] | null {
  if (!isFootSport(sportType) || thresholdPaceSPerKm === null || !(thresholdPaceSPerKm > 0)) return null;
  const { idle } = sportLimits(sportType);
  const bounds = PACE_ZONE_FACTORS.map((f) => f * thresholdPaceSPerKm);
  const zones = [0, 0, 0, 0, 0];
  for (const seg of segments) {
    for (let i = 1; i < seg.length; i++) {
      const a = seg[i - 1];
      const b = seg[i];
      if (!isMovingStep(a, b, idle)) continue;
      const dt = b.t - a.t;
      const v = b.speed ?? (b.d - a.d) / dt;
      const pace = 1000 / v;
      let z = 0;
      while (z < bounds.length && pace <= bounds[z]) z++;
      zones[z] += dt;
    }
  }
  return zones.map(r0);
}

// ---------------------------------------------------------------- effort

// Banister TRIMP over every short step with hr (moving or not)
export function trimpEffort(segments: MetricSample[][], hrMaxBpm: number | null, hrRestBpm: number | null): number | null {
  if (hrMaxBpm === null) return null;
  const rest = hrRestBpm ?? 60;
  if (!(hrMaxBpm > rest)) return null;
  let sum = 0;
  let any = false;
  for (const seg of segments) {
    for (let i = 1; i < seg.length; i++) {
      const hr = seg[i - 1].hr ?? seg[i].hr;
      const dt = seg[i].t - seg[i - 1].t;
      if (hr === null || !Number.isFinite(hr) || !(dt > 0) || dt > MOVING_GAP_MAX_S) continue;
      const hrr = Math.max(0, Math.min(1, (hr - rest) / (hrMaxBpm - rest)));
      sum += (dt / 60) * hrr * 0.64 * Math.exp(1.92 * hrr);
      any = true;
    }
  }
  return any ? r1(sum) : null;
}

// ---------------------------------------------------------------- climbs

const CLIMB_MIN_DIST_M = 300;
const CLIMB_MIN_GRADE = 0.03;
const CLIMB_MIN_GAIN_M = 15;
const CLIMB_MAX_DROP_M = 10;
const CLIMB_MAX_DROP_FRAC = 0.2;
const CLIMB_MAX_FLAT_M = 300;
const CLIMB_TRIM_WINDOW_M = 100;
const CLIMB_TRIM_MIN_GAIN_M = 1; // ends rising less than 1 m per 100 m are trimmed
const MAX_GRADE_WINDOW_M = 100;

export function climbCategory(distM: number, avgGradePct: number): Climb["category"] {
  const score = distM * avgGradePct;
  if (score >= 80000) return "hc";
  if (score >= 64000) return "1";
  if (score >= 32000) return "2";
  if (score >= 16000) return "3";
  if (score >= 8000) return "4";
  return null;
}

// cut flat lead-ins and run-outs off a climb candidate
function trimClimb(seg: MetricSample[], ele: number[], s: number, h: number): [number, number] {
  let q = s;
  while (s < h) {
    if (q < s) q = s;
    while (q < h && seg[q].d - seg[s].d < CLIMB_TRIM_WINDOW_M) q++;
    if (ele[q] - ele[s] >= CLIMB_TRIM_MIN_GAIN_M) break;
    s++;
  }
  let p = h;
  while (h > s) {
    if (p > h) p = h;
    while (p > s && seg[h].d - seg[p].d < CLIMB_TRIM_WINDOW_M) p--;
    if (ele[h] - ele[p] >= CLIMB_TRIM_MIN_GAIN_M) break;
    h--;
  }
  return [s, h];
}

function maxGrade(seg: MetricSample[], ele: number[], s: number, h: number): number {
  let best = 0;
  let q = s;
  for (let k = s; k < h; k++) {
    if (q < k) q = k;
    while (q < h && seg[q].d - seg[k].d < MAX_GRADE_WINDOW_M) q++;
    const span = seg[q].d - seg[k].d;
    if (span < MAX_GRADE_WINDOW_M) break;
    const g = (ele[q] - ele[k]) / span;
    if (g > best) best = g;
  }
  return best;
}

// sustained uphill stretches on smoothed elevation, per segment
export function findClimbs(segments: MetricSample[][]): Climb[] {
  const out: Climb[] = [];
  for (const seg of segments) {
    if (seg.length < 2) continue;
    const ele = smoothedElevation(seg);
    if (!ele) continue;
    const finish = (s0: number, h0: number) => {
      const [s, h] = trimClimb(seg, ele, s0, h0);
      const distM = seg[h].d - seg[s].d;
      const gain = ele[h] - ele[s];
      if (distM < CLIMB_MIN_DIST_M || gain < CLIMB_MIN_GAIN_M || gain / distM < CLIMB_MIN_GRADE) return;
      const avgGradePct = r1((gain / distM) * 100);
      out.push({
        startD: r1(seg[s].d),
        endD: r1(seg[h].d),
        startS: r0(seg[s].t),
        endS: r0(seg[h].t),
        gainM: r1(gain),
        distM: r1(distM),
        avgGradePct,
        maxGradePct: r1(Math.max(maxGrade(seg, ele, s, h), gain / distM) * 100),
        category: climbCategory(distM, (gain / distM) * 100),
      });
    };
    let inClimb = false;
    let low = 0;
    let start = 0;
    let high = 0;
    let minSinceHigh = 0;
    for (let i = 0; i < seg.length; i++) {
      const e = ele[i];
      if (!inClimb) {
        if (e <= ele[low]) low = i;
        else if (e - ele[low] >= ELEV_HYSTERESIS_M) {
          inClimb = true;
          start = low;
          high = i;
          minSinceHigh = i;
        }
        continue;
      }
      if (e > ele[high]) {
        high = i;
        minSinceHigh = i;
        continue;
      }
      if (e < ele[minSinceHigh]) minSinceHigh = i;
      const gain = ele[high] - ele[start];
      const drop = ele[high] - e;
      if (
        drop > CLIMB_MAX_DROP_M ||
        (drop > CLIMB_MAX_DROP_FRAC * gain && drop > ELEV_HYSTERESIS_M) ||
        seg[i].d - seg[high].d > CLIMB_MAX_FLAT_M
      ) {
        finish(start, high);
        inClimb = false;
        low = minSinceHigh;
      }
    }
    if (inClimb) finish(start, high);
  }
  return out;
}

// ---------------------------------------------------------------- all together

export function computeMetrics(input: MetricsInput): ActivityMetrics | null {
  const segments = input.segments
    .map((seg) => seg.filter((p) => Number.isFinite(p.t) && Number.isFinite(p.d)))
    .filter((seg) => seg.length > 0);
  const count = segments.reduce((n, s) => n + s.length, 0);
  if (count < 2) return null;
  const sport = input.sportType;
  const foot = isFootSport(sport);

  let elapsed = 0;
  let dist = 0;
  for (const s of segments) {
    elapsed += Math.max(0, s[s.length - 1].t - s[0].t);
    dist += Math.max(0, s[s.length - 1].d - s[0].d);
  }
  const moving = movingTimeS(segments, sport);
  const hasDist = dist > 0 && moving > 0;

  return {
    v: METRICS_FORMAT_VERSION,
    sportType: sport,
    movingS: r0(moving),
    elapsedS: r0(elapsed),
    distM: r1(dist),
    movingPaceSPerKm: foot && hasDist ? r0(moving / (dist / 1000)) : null,
    movingSpeedMs: hasDist ? r2(dist / moving) : null,
    gapSPerKm: hasDist ? gradeAdjustedPace(segments, sport) : null,
    splitsKm: computeSplits(segments, sport, KM_M),
    splitsMi: computeSplits(segments, sport, MILE_M),
    bestEfforts: bestEfforts(segments, sport),
    speedCurve: speedCurve(segments, sport),
    powerCurve: powerCurve(segments),
    paceZonesS: paceZones(segments, sport, input.thresholdPaceSPerKm),
    effort: trimpEffort(segments, input.hrMaxBpm, input.hrRestBpm),
    climbs: findClimbs(segments),
  };
}
