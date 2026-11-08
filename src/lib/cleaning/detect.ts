// cleaning detectors (pure, deterministic, O(n log n)) over the untouched
// canonical track: idle stretches, vehicle segments, forgot-to-stop tails,
// late-start heads, gps spikes and indoor gps drift. every edit proposed here
// passes validateCleaningEdit; confidence is calibrated so that only clear-cut
// cases reach the auto-apply threshold (0.9 by default), and never for sports
// outside the speed table.

import { haversineM } from "../geo";
import type { CanonicalTrack } from "../canonical-track";
import { SNOW_SPORTS, isKnownSport, sportLimits, type SportLimits } from "./sport";
import { typesInFamily } from "../sport-types";
import type { Suggestion } from "./types";

const GAP_S = 10; // longer steps are recording gaps (auto-pause, lost signal)
const ACTIVE_GAP_S = 120; // gaps up to this still count as movement (smart recording)
const SMOOTH_HALF_S = 2; // path speed: 5 s window
const DISP_HALF_S = 15; // displacement speed: 30 s window (jitter-proof stop test)

const IDLE_MIN_S = 60;
const IDLE_MERGE_S = 30; // stops separated by less movement than this are one stop
const LONG_STOP_S = 20 * 60;

const VEHICLE_MIN_S = 60;
const VEHICLE_MIN_M = 500;
const VEHICLE_DIP_S = 90; // traffic: slow stretches this short stay inside the ride
const VEHICLE_MIN_FRAC = 0.6;
const VEHICLE_CHAIN_S = 300;
const VEHICLE_EDGE_S = 180; // parking and walking off: still the edge of the activity
const PAD_STOP_S = 180;
const PAD_SLOW_S = 60;
const DESCENT_GRADE = -0.03; // rides: fast + downhill is gravity, not a car
const DESCENT_MAX_RATIO = 1.6;

const SUSTAIN_WIN_S = 120; // "real movement": ≥ 90 s active within 2 min
const SUSTAIN_ACTIVE_S = 90;
const EDGE_ACTIVE_S = 120; // less active time than this before/after = touches the edge
const HEAD_MIN_S = 5 * 60;
const TAIL_MIN_S = 10 * 60;

const SPIKE_MAX_RUN = 3;
const SPIKE_MIN_M = 100;

const DRIFT_MIN_S = 10 * 60;
const DRIFT_MAX_P90 = 1.4; // m/s, 90th percentile of 10 s displacement speed

// sports without real speed limits never reach the auto-apply threshold
const UNKNOWN_SPORT_MAX_CONF = 0.89;

// running sports: walking isn't the activity (forgot-to-stop tails walk home)
const WALK_MAX: Record<string, number> = Object.fromEntries(typesInFamily("run").map((k) => [k, 1.9]));
const CYCLING: ReadonlySet<string> = new Set(typesInFamily("ride"));
// indoor machines and virtual worlds: no real vehicle stretches
const VIRTUAL: ReadonlySet<string> = new Set(["VirtualRun", "VirtualRide", "TreadmillRun", "IndoorRide", "VirtualRow", "VirtualSki"]);
// no meaningful movement: motion detectors stay quiet
const STATIONARY: ReadonlySet<string> = new Set([
  ...typesInFamily("strength", "cardio", "mind"),
  "IndoorClimbing", "Bouldering",
]);
const INDOOR: ReadonlySet<string> = new Set([...STATIONARY, ...VIRTUAL]);

// step classes
const STOP = 0;
const WALK = 1;
const ACTIVE = 2;
const FAST = 3;

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const round2 = (x: number) => Math.round(x * 100) / 100;

export function formatDuration(s: number): string {
  const sec = Math.round(s);
  if (sec < 60) return `${sec} s`;
  if (sec < 600) {
    const m = Math.floor(sec / 60);
    const r = sec % 60;
    return r ? `${m} min ${r} s` : `${m} min`;
  }
  const tm = Math.round(sec / 60);
  if (tm < 60) return `${tm} min`;
  const h = Math.floor(tm / 60);
  const m = tm % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

const formatDist = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`);
const kmh = (ms: number) => `${Math.round(ms * 3.6)} km/h`;

function noun(sportType: string): string {
  if (WALK_MAX[sportType] !== undefined) return "run";
  if (CYCLING.has(sportType)) return "ride";
  if (sportType === "Walk") return "walk";
  if (sportType === "Hike") return "hike";
  if (sportType === "Swim") return "swim";
  return "activity";
}

// ---------------------------------------------------------------------------
// gps spikes: 1..3 samples whose implied speed in and out beats the teleport
// speed and after which the path resumes near where it left off

interface Spike {
  idx: number[];
  excursionM: number;
  confidence: number;
}

function findSpikes(track: CanonicalTrack, lim: SportLimits): Spike[] {
  const { t, lat, lng } = track.columns;
  const P: number[] = [];
  for (let i = 0; i < t.length; i++) if (lat[i] !== null && lng[i] !== null) P.push(i);
  if (P.length < 4) return [];
  const d = (a: number, b: number) => haversineM(lat[a]!, lng[a]!, lat[b]!, lng[b]!);
  const sp = (a: number, b: number) => d(a, b) / Math.max(1, t[b] - t[a]);
  const tele = lim.teleport;
  const plausible = lim.maxHuman * 2;
  const out: Spike[] = [];

  // the first fixes (cold start): far from where the track then continues smoothly
  let j = 0;
  for (let k = 1; k <= SPIKE_MAX_RUN && k + 2 < P.length; k++) {
    const last = P[k - 1];
    const q = P[k];
    if (d(last, q) >= 2 * SPIKE_MIN_M && sp(last, q) > tele && sp(q, P[k + 1]) <= plausible && sp(P[k + 1], P[k + 2]) <= plausible) {
      out.push({ idx: P.slice(0, k), excursionM: d(last, q), confidence: 0.8 });
      j = k;
      break;
    }
  }

  // isolated excursions mid-track
  let p = P[j];
  j++;
  while (j < P.length - 1) {
    let found = 0;
    if (sp(p, P[j]) > tele) {
      for (let k = 1; k <= SPIKE_MAX_RUN && j + k < P.length; k++) {
        const q = P[j + k];
        if (sp(P[j + k - 1], q) <= tele) continue;
        let exc = 0;
        for (let m = j; m < j + k; m++) exc = Math.max(exc, d(p, P[m]));
        const dpq = d(p, q);
        if (exc >= SPIKE_MIN_M && dpq <= 0.25 * exc && sp(p, q) <= tele) {
          let confidence = 0.8;
          if (exc >= 300) confidence += 0.1;
          if (k === 1 && exc >= 500 && dpq <= 0.1 * exc) confidence += 0.05;
          out.push({ idx: P.slice(j, j + k), excursionM: exc, confidence });
          found = k;
          break;
        }
      }
    }
    if (found) j += found;
    else {
      p = P[j];
      j++;
    }
  }

  // the last fixes: a jump away right before the recording ends
  const covered = new Set(out.flatMap((s) => s.idx));
  for (let k = 1; k <= SPIKE_MAX_RUN && k + 2 < P.length; k++) {
    const first = P[P.length - k];
    const q = P[P.length - k - 1];
    if (covered.has(first) || covered.has(q)) break;
    if (d(q, first) >= 2 * SPIKE_MIN_M && sp(q, first) > tele && sp(P[P.length - k - 2], q) <= plausible && sp(P[P.length - k - 3], P[P.length - k - 2]) <= plausible) {
      out.push({ idx: P.slice(P.length - k), excursionM: d(q, first), confidence: 0.8 });
      break;
    }
  }
  return out.sort((a, b) => a.idx[0] - b.idx[0]);
}

// ---------------------------------------------------------------------------
// per-step speeds and classes

interface Steps {
  n: number;
  t: number[];
  D: Float64Array; // cumulative metres, spikes excluded
  v: Float64Array; // step i: sample i-1 → i
  cls: Uint8Array;
  gap: Uint8Array; // steps longer than ACTIVE_GAP_S
  activeNG: Float64Array; // prefix: active seconds outside long gaps, over steps 1..i
  clsTime: Float64Array[]; // prefix per class (gaps included)
}

function buildSteps(track: CanonicalTrack, lim: SportLimits, walkMax: number, spikeSet: Set<number>): Steps {
  const c = track.columns;
  const t = c.t;
  const n = t.length;
  const good = new Uint8Array(n);
  let anyGood = 0;
  for (let i = 0; i < n; i++) {
    if (c.lat[i] !== null && c.lng[i] !== null && !spikeSet.has(i)) {
      good[i] = 1;
      anyGood++;
    }
  }
  const deviceDist = track.source.fileType === "fit" || track.source.kind === "strava-streams";
  const D = new Float64Array(n);
  if (deviceDist || anyGood < 2) {
    for (let i = 1; i < n; i++) {
      const delta = c.dist[i] - c.dist[i - 1];
      D[i] = D[i - 1] + (Number.isFinite(delta) && delta > 0 ? delta : 0);
    }
  } else {
    let g = -1;
    for (let i = 0; i < n; i++) {
      D[i] = i > 0 ? D[i - 1] : 0;
      if (!good[i]) continue;
      if (g >= 0) D[i] += haversineM(c.lat[g]!, c.lng[g]!, c.lat[i]!, c.lng[i]!);
      g = i;
    }
  }

  const seg = new Int32Array(n);
  for (let i = 1; i < n; i++) seg[i] = seg[i - 1] + (t[i] - t[i - 1] > GAP_S ? 1 : 0);
  const prevGood = new Int32Array(n);
  const nextGood = new Int32Array(n);
  for (let i = 0, g = -1; i < n; i++) {
    if (good[i]) g = i;
    prevGood[i] = g;
  }
  for (let i = n - 1, g = -1; i >= 0; i--) {
    if (good[i]) g = i;
    nextGood[i] = g;
  }

  // path speed (5 s) and displacement speed (30 s) per sample, within a segment
  const pathV = new Float64Array(n).fill(NaN);
  const dispV = new Float64Array(n).fill(NaN);
  let a = 0, b = 0, a2 = 0, b2 = 0;
  for (let i = 0; i < n; i++) {
    while (a < i && (seg[a] !== seg[i] || t[a] < t[i] - SMOOTH_HALF_S)) a++;
    if (b < i) b = i;
    while (b + 1 < n && seg[b + 1] === seg[i] && t[b + 1] <= t[i] + SMOOTH_HALF_S) b++;
    if (t[b] > t[a]) pathV[i] = (D[b] - D[a]) / (t[b] - t[a]);
    if (anyGood >= 2) {
      while (a2 < i && (seg[a2] !== seg[i] || t[a2] < t[i] - DISP_HALF_S)) a2++;
      if (b2 < i) b2 = i;
      while (b2 + 1 < n && seg[b2 + 1] === seg[i] && t[b2 + 1] <= t[i] + DISP_HALF_S) b2++;
      const ga = nextGood[a2];
      const gb = prevGood[b2];
      if (ga >= 0 && gb >= 0 && ga < gb && t[gb] - t[ga] >= DISP_HALF_S) {
        dispV[i] = haversineM(c.lat[ga]!, c.lng[ga]!, c.lat[gb]!, c.lng[gb]!) / (t[gb] - t[ga]);
      }
    }
  }

  const v = new Float64Array(n);
  const cls = new Uint8Array(n);
  const gap = new Uint8Array(n);
  const activeNG = new Float64Array(n);
  const clsTime = [0, 1, 2, 3].map(() => new Float64Array(n));
  for (let i = 1; i < n; i++) {
    const dt = t[i] - t[i - 1];
    let speed: number;
    let stopSpeed: number;
    if (dt > ACTIVE_GAP_S) gap[i] = 1;
    if (dt > GAP_S) {
      speed = stopSpeed = (D[i] - D[i - 1]) / dt;
    } else {
      const dev = c.speed[i];
      if (dev !== null && Number.isFinite(dev)) {
        speed = stopSpeed = dev;
      } else {
        const p0 = pathV[i - 1];
        const p1 = pathV[i];
        speed = Number.isFinite(p0) && Number.isFinite(p1) ? (p0 + p1) / 2 : Number.isFinite(p1) ? p1 : (D[i] - D[i - 1]) / dt;
        // standing still with gps on: path length grows with jitter, displacement doesn't
        stopSpeed = Number.isFinite(dispV[i]) ? Math.min(speed, dispV[i]) : speed;
      }
    }
    v[i] = speed;
    const k = stopSpeed < lim.idle ? STOP : speed > lim.maxHuman ? FAST : speed < walkMax ? WALK : ACTIVE;
    cls[i] = k;
    activeNG[i] = activeNG[i - 1] + (k === ACTIVE && !gap[i] ? dt : 0);
    for (let q = 0; q < 4; q++) clsTime[q][i] = clsTime[q][i - 1] + (q === k ? dt : 0);
  }
  return { n, t, D, v, cls, gap, activeNG, clsTime };
}

// seconds per class over steps lo+1..hi (samples lo..hi)
function composition(s: Steps, lo: number, hi: number) {
  const span = Math.max(1, s.t[hi] - s.t[lo]);
  const f = (k: number) => (s.clsTime[k][hi] - s.clsTime[k][lo]) / span;
  return { stop: f(STOP), walk: f(WALK), active: f(ACTIVE), fast: f(FAST), span };
}

// ---------------------------------------------------------------------------
// detectors over steps

interface Range { fromS: number; toS: number }

function vehicleCandidates(s: Steps, lim: SportLimits, sportType: string, eles: (number | null)[]): Suggestion[] {
  const { n, t, D, v, cls } = s;
  const runs: [number, number][] = [];
  for (let i = 1; i < n; i++) {
    if (cls[i] !== FAST) continue;
    if (runs.length && runs[runs.length - 1][1] === i - 1) runs[runs.length - 1][1] = i;
    else runs.push([i, i]);
  }
  const groups: [number, number][] = [];
  for (const r of runs) {
    const g = groups[groups.length - 1];
    if (g && t[r[0] - 1] - t[g[1]] <= VEHICLE_DIP_S) g[1] = r[1];
    else groups.push([r[0], r[1]]);
  }
  const fastOf = (g0: number, g1: number) => {
    let fastS = 0, fastM = 0;
    for (let i = g0; i <= g1; i++) {
      if (cls[i] !== FAST) continue;
      fastS += t[i] - t[i - 1];
      fastM += D[i] - D[i - 1];
    }
    return { fastS, fastM, frac: fastS / Math.max(1, t[g1] - t[g0 - 1]) };
  };
  const qualified = groups.filter(([g0, g1]) => {
    const { fastS, fastM, frac } = fastOf(g0, g1);
    return (fastS >= VEHICLE_MIN_S || (fastM >= VEHICLE_MIN_M && fastS >= VEHICLE_MIN_S / 2)) && frac >= VEHICLE_MIN_FRAC;
  });
  // one trip: rides a few minutes apart (parking lots, traffic) chain up
  const chains: [number, number][] = [];
  for (const g of qualified) {
    const last = chains[chains.length - 1];
    if (last && t[g[0] - 1] - t[last[1]] <= VEHICLE_CHAIN_S && fastOf(last[0], g[1]).frac >= 0.5) last[1] = g[1];
    else chains.push([g[0], g[1]]);
  }
  const totalActive = s.activeNG[n - 1];
  const out: Suggestion[] = [];
  for (const [g0, g1] of chains) {
    const { fastS, fastM, frac } = fastOf(g0, g1);
    // average speed: distance when there is one, else the speed channel
    let avg = fastM / Math.max(1, fastS);
    if (!(avg > lim.maxHuman)) {
      let sum = 0;
      for (let i = g0; i <= g1; i++) if (cls[i] === FAST) sum += v[i] * (t[i] - t[i - 1]);
      avg = sum / Math.max(1, fastS);
    }
    if (CYCLING.has(sportType)) {
      let e0: number | null = null, e1: number | null = null;
      for (let i = g0 - 1; i <= g1 && e0 === null; i++) e0 = eles[i];
      for (let i = g1; i >= g0 - 1 && e1 === null; i--) e1 = eles[i];
      const spanM = D[g1] - D[g0 - 1];
      if (e0 !== null && e1 !== null && spanM > 0 && (e1 - e0) / spanM <= DESCENT_GRADE && avg <= DESCENT_MAX_RATIO * lim.maxHuman) continue;
    }

    // pad out to the nearest stopped (else slow) sample on either side
    const slow = (i: number) => cls[i] === STOP || cls[i] === WALK || v[i] <= lim.maxHuman / 2;
    let from = g0 - 1;
    let found = false;
    for (let j = g0 - 1; j >= 1 && t[g0 - 1] - t[j - 1] <= PAD_STOP_S; j--) {
      if (cls[j] === STOP) { from = j; found = true; break; }
    }
    if (!found) {
      for (let j = g0 - 1; j >= 1 && t[g0 - 1] - t[j - 1] <= PAD_SLOW_S; j--) {
        if (slow(j)) { from = j; break; }
      }
    }
    let to = g1;
    found = false;
    for (let j = g1 + 1; j < n && t[j] - t[g1] <= PAD_STOP_S; j++) {
      if (cls[j] === STOP) { to = j - 1; found = true; break; }
    }
    if (!found) {
      for (let j = g1 + 1; j < n && t[j] - t[g1] <= PAD_SLOW_S; j++) {
        if (slow(j)) { to = j - 1; break; }
      }
    }

    const before = s.activeNG[from];
    const after = totalActive - s.activeNG[to];
    const atStart = before < VEHICLE_EDGE_S;
    const atEnd = after < VEHICLE_EDGE_S;
    if (atStart && atEnd) continue; // the whole recording: not a ride inside an activity
    const r = avg / lim.maxHuman;
    const confidence = round2(Math.min(0.97,
      0.55 + 0.25 * clamp01(r - 1) + 0.15 * clamp01((fastS - VEHICLE_MIN_S) / 540) + 0.05 * clamp01((frac - VEHICLE_MIN_FRAC) / 0.4)));
    const what = `vehicle ride ${formatDuration(fastS)}, ${formatDist(fastM)} at ${kmh(avg)} avg`;
    if (atStart) {
      if (to >= n - 1) continue;
      out.push({ kind: "crop-head", confidence, edit: { kind: "crop", params: { startS: t[to], endS: null } },
        summary: `${what} before the ${noun(sportType)} began`, range: { fromS: 0, toS: t[to] } });
    } else if (atEnd) {
      if (t[from] <= 0) continue;
      out.push({ kind: "crop-tail", confidence, edit: { kind: "crop", params: { startS: null, endS: t[from] } },
        summary: `${what} after the ${noun(sportType)} ended`, range: { fromS: t[from], toS: t[n - 1] } });
    } else {
      out.push({ kind: "cut-vehicle", confidence, edit: { kind: "cut", params: { fromS: t[from], toS: t[to] } },
        summary: what, range: { fromS: t[from], toS: t[to] } });
    }
  }
  return out;
}

function edgeDetail(comp: ReturnType<typeof composition>): string {
  if (comp.fast >= 0.2) return `, incl. ${formatDuration(comp.fast * comp.span)} at vehicle speed`;
  if (comp.stop + comp.fast >= 0.5) return ", mostly stationary";
  return ", mostly slow walking";
}

function meanHr(hr: (number | null)[], t: number[], fromS: number, toS: number, lo: number, hi: number): number | null {
  let sum = 0, cnt = 0;
  for (let i = lo; i <= hi; i++) {
    if (t[i] < fromS || t[i] > toS) continue;
    const h = hr[i];
    if (h !== null && h > 0) { sum += h; cnt++; }
  }
  return cnt >= 10 ? sum / cnt : null;
}

// late start / forgot to stop: the stretch before the first (after the last)
// sustained real movement
function edgeCandidates(s: Steps, track: CanonicalTrack, sportType: string): Suggestion[] {
  const { n, t, activeNG } = s;
  const out: Suggestion[] = [];
  const label = noun(sportType);

  let headIdx = -1;
  for (let lo = 0, hi = 0; lo < n; lo++) {
    if (hi < lo) hi = lo;
    while (hi + 1 < n && t[hi + 1] <= t[lo] + SUSTAIN_WIN_S) hi++;
    if (activeNG[hi] - activeNG[lo] >= SUSTAIN_ACTIVE_S) { headIdx = lo; break; }
  }
  if (headIdx < 0) return out; // never really moved
  while (headIdx + 1 < n && !(s.cls[headIdx + 1] === ACTIVE && !s.gap[headIdx + 1])) headIdx++;

  let tailIdx = -1;
  for (let hi = n - 1, lo = n - 1; hi >= 0; hi--) {
    if (lo > hi) lo = hi;
    while (lo - 1 >= 0 && t[lo - 1] >= t[hi] - SUSTAIN_WIN_S) lo--;
    if (activeNG[hi] - activeNG[lo] >= SUSTAIN_ACTIVE_S) { tailIdx = hi; break; }
  }
  while (tailIdx > 0 && !(s.cls[tailIdx] === ACTIVE && !s.gap[tailIdx])) tailIdx--;

  const headS = t[headIdx];
  if (headS >= HEAD_MIN_S && headIdx < tailIdx) {
    const comp = composition(s, 0, headIdx);
    const still = comp.stop + comp.fast;
    if (comp.active <= 0.25) {
      let confidence = 0.55 + 0.3 * clamp01((headS - HEAD_MIN_S) / 1500) + 0.1 * still;
      if (still < 0.5) confidence = Math.min(confidence, 0.6);
      out.push({ kind: "crop-head", confidence: round2(Math.min(0.97, confidence)),
        edit: { kind: "crop", params: { startS: headS, endS: null } },
        summary: `recording started ${formatDuration(headS)} before the ${label} began${edgeDetail(comp)}`,
        range: { fromS: 0, toS: headS } });
    }
  }

  const endS = t[tailIdx];
  const tailS = t[n - 1] - endS;
  if (tailS >= TAIL_MIN_S && tailIdx > headIdx && endS > 0) {
    const comp = composition(s, tailIdx, n - 1);
    const still = comp.stop + comp.fast;
    if (comp.active <= 0.25) {
      let confidence = 0.55 + 0.3 * clamp01((tailS - TAIL_MIN_S) / 3000) + 0.1 * still;
      const hrBefore = meanHr(track.columns.hr, t, endS - 600, endS, Math.max(0, headIdx), tailIdx);
      const hrAfter = meanHr(track.columns.hr, t, endS + 1, t[n - 1], tailIdx, n - 1);
      if (hrBefore !== null && hrAfter !== null && hrBefore - hrAfter >= 15) confidence += 0.03;
      if (still < 0.5) confidence = Math.min(confidence, 0.6);
      out.push({ kind: "crop-tail", confidence: round2(Math.min(0.97, confidence)),
        edit: { kind: "crop", params: { startS: null, endS } },
        summary: `watch kept recording ${formatDuration(tailS)} after the ${label} ended${edgeDetail(comp)}`,
        range: { fromS: endS, toS: t[n - 1] } });
    }
  }
  return out;
}

function idleCandidates(s: Steps, sportType: string, excluded: Range[]): Suggestion[] {
  const { n, t, cls } = s;
  const runs: [number, number][] = [];
  for (let i = 1; i < n; i++) {
    if (cls[i] !== STOP) continue;
    const r = runs[runs.length - 1];
    if (r && t[i - 1] - t[r[1]] <= IDLE_MERGE_S) r[1] = i;
    else runs.push([i, i]);
  }
  const totalActive = s.activeNG[n - 1];
  const out: Suggestion[] = [];
  for (const [r0, r1] of runs) {
    const fromS = t[r0 - 1];
    const toS = t[r1];
    const span = toS - fromS;
    const stoppedS = s.clsTime[STOP][r1] - s.clsTime[STOP][r0 - 1];
    if (stoppedS < IDLE_MIN_S || stoppedS / Math.max(1, span) < 0.6) continue;
    const overlap = excluded.reduce((acc, e) => acc + Math.max(0, Math.min(toS, e.toS) - Math.max(fromS, e.fromS)), 0);
    if (overlap > span / 2) continue;
    const range = { fromS, toS };
    const mid = s.activeNG[r0 - 1] >= EDGE_ACTIVE_S && totalActive - s.activeNG[r1] >= EDGE_ACTIVE_S;
    if (stoppedS >= LONG_STOP_S && mid) {
      out.push({ kind: "idle", confidence: round2(0.4 + 0.2 * clamp01((stoppedS - LONG_STOP_S) / 3600)),
        edit: { kind: "cut", params: { fromS, toS } },
        summary: `stopped ${formatDuration(stoppedS)} mid-${noun(sportType)}`, range });
    } else {
      out.push({ kind: "idle", confidence: round2(0.7 + 0.2 * clamp01((stoppedS - IDLE_MIN_S) / 240)), edit: null,
        summary: `stopped ${formatDuration(stoppedS)}`, range });
    }
  }
  return out;
}

// indoor / no-gps: the whole position cloud only jitters around one spot
function driftCandidate(track: CanonicalTrack, sportType: string, spikeSet: Set<number>, totalM: number): Suggestion | null {
  const { t, lat, lng } = track.columns;
  const n = t.length;
  const duration = t[n - 1] - t[0];
  if (duration < DRIFT_MIN_S) return null;
  const idx: number[] = [];
  for (let i = 0; i < n; i++) if (lat[i] !== null && lng[i] !== null && !spikeSet.has(i)) idx.push(i);
  if (idx.length < 10 || t[idx[idx.length - 1]] - t[idx[0]] < duration / 2) return null;
  let sLat = 0, sLng = 0;
  for (const i of idx) { sLat += lat[i]!; sLng += lng[i]!; }
  const lat0 = sLat / idx.length;
  const lng0 = sLng / idx.length;
  const kx = 111320 * Math.cos((lat0 * Math.PI) / 180);
  const ky = 110540;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, ss = 0;
  for (const i of idx) {
    const x = (lng[i]! - lng0) * kx;
    const y = (lat[i]! - lat0) * ky;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    ss += x * x + y * y;
  }
  const diag = Math.hypot(maxX - minX, maxY - minY);
  const rg = Math.sqrt(ss / idx.length);
  // 10 s displacement speeds: drift wanders, real movement covers ground
  const sp10: number[] = [];
  for (let a = 0, b = 0; a < idx.length; a++) {
    if (b <= a) b = a + 1;
    while (b < idx.length && t[idx[b]] < t[idx[a]] + 10) b++;
    if (b >= idx.length) break;
    const lag = t[idx[b]] - t[idx[a]];
    if (lag <= 60) sp10.push(haversineM(lat[idx[a]]!, lng[idx[a]]!, lat[idx[b]]!, lng[idx[b]]!) / lag);
  }
  sp10.sort((x, y) => x - y);
  // field sports (soccer: p90 ≈ 2 m/s) really move around a small area; drift
  // and indoor multipath stay ≤ ~1 m/s
  const p90 = sp10.length ? sp10[Math.floor(sp10.length * 0.9)] : 0;
  const jitter = sp10.length >= 5 ? p90 < DRIFT_MAX_P90 : diag < 100;
  if (!jitter) return null;
  const indoor = INDOOR.has(sportType);
  const summary = `gps only drifts within ${Math.round(diag)} m over ${formatDuration(duration)}`;
  const edit = { kind: "no-gps", params: {} };
  const range = { fromS: 0, toS: t[n - 1] };
  if (indoor) {
    if (rg >= 100 || diag >= 300) return null;
    return { kind: "no-gps", confidence: p90 < 1 ? 0.95 : 0.9, edit, summary: `${summary} (indoor ${noun(sportType)})`, range };
  }
  if (diag >= 150 || rg >= 50) return null;
  const deviceDist = track.source.fileType === "fit" || track.source.kind === "strava-streams";
  const moved = deviceDist && totalM >= Math.max(1000, 5 * diag);
  return { kind: "no-gps", confidence: moved ? 0.92 : 0.8, edit,
    summary: moved ? `${summary} while the device logged ${formatDist(totalM)} (treadmill?)` : summary, range };
}

// ---------------------------------------------------------------------------

const KIND_ORDER = ["crop-head", "crop-tail", "cut-vehicle", "drop-spikes", "no-gps", "idle"];

function better(a: Suggestion | undefined, b: Suggestion): Suggestion {
  return !a || b.confidence > a.confidence ? b : a;
}

export function detectSuggestions(track: CanonicalTrack, sportType: string): Suggestion[] {
  const n = track.columns.t.length;
  // polyline-only tracks have made-up timestamps: nothing to say about speed
  if (n < 10 || track.syntheticTime) return [];
  const lim = sportLimits(sportType);
  const known = isKnownSport(sportType);
  const out: Suggestion[] = [];

  const spikes = findSpikes(track, lim);
  const spikeSet = new Set(spikes.flatMap((s) => s.idx));
  for (const clear of [true, false]) {
    const group = spikes.filter((s) => (s.confidence >= 0.9) === clear);
    if (!group.length) continue;
    const ts = group.flatMap((s) => s.idx.map((i) => track.columns.t[i]));
    const maxKm = Math.max(...group.map((s) => s.excursionM));
    out.push({
      kind: "drop-spikes",
      confidence: round2(Math.min(...group.map((s) => s.confidence))),
      edit: { kind: "drop-points", params: { ts } },
      summary: `${clear ? "" : "possible "}${ts.length} gps spike${ts.length === 1 ? "" : "s"}, up to ${formatDist(maxKm)} off the route`,
      range: { fromS: ts[0], toS: ts[ts.length - 1] },
    });
  }

  const steps = buildSteps(track, lim, WALK_MAX[sportType] ?? lim.idle, spikeSet);
  const totalM = steps.D[n - 1];
  const drift = driftCandidate(track, sportType, spikeSet, totalM);
  if (drift) out.push(drift);

  const moving = steps.activeNG[n - 1] >= EDGE_ACTIVE_S && totalM >= 200;
  if (!STATIONARY.has(sportType) && moving) {
    let head: Suggestion | undefined;
    let tail: Suggestion | undefined;
    const cuts: Suggestion[] = [];
    // the generic limits can't tell a vehicle from the sport (lifts, ski runs,
    // paddling downstream), so vehicle detection needs a known sport
    const vehicles = VIRTUAL.has(sportType) || !known
      ? []
      : vehicleCandidates(steps, lim, sportType, track.columns.ele).filter((s) => !(SNOW_SPORTS.has(sportType) && s.kind === "cut-vehicle"));
    for (const s of [...vehicles, ...edgeCandidates(steps, track, sportType)]) {
      if (s.kind === "crop-head") head = better(head, s);
      else if (s.kind === "crop-tail") tail = better(tail, s);
      else cuts.push(s);
    }
    // a cut inside a cropped-away edge is moot
    const kept = cuts.filter((c) => !(head && c.range!.toS <= head.range!.toS) && !(tail && c.range!.fromS >= tail.range!.fromS));
    if (head) out.push(head);
    if (tail) out.push(tail);
    out.push(...kept);
    const excluded = [head, tail, ...kept].filter((s): s is Suggestion => !!s).map((s) => s.range!);
    out.push(...idleCandidates(steps, sportType, excluded));
  }

  if (!known) for (const s of out) s.confidence = Math.min(s.confidence, UNKNOWN_SPORT_MAX_CONF);

  return out.sort((a, b) =>
    (a.range?.fromS ?? 0) - (b.range?.fromS ?? 0) || KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));
}
