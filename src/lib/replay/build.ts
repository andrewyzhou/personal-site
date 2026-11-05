// replay data: the published (post-cleaning, post-trim, post-fog) track as a
// compact timed polyline for the map replay. built by republish from exactly
// the points the public route is drawn from, so it can never contain anything
// the route doesn't. time is "replay time": fog gaps are compressed to the same
// 5-minute steps the public fog total uses, cut/merge gaps are skipped.

import type { TrackRecord } from "../geo";
import type { FogSample } from "../privacy/fog";

export const REPLAY_FORMAT_VERSION = 1;
export const REPLAY_MAX_POINTS = 2500;

export interface ReplaySegment {
  t: number[]; // replay seconds, increasing across segments
  lat: number[];
  lng: number[];
  ele: (number | null)[] | null; // null when the track has no elevation
  hr: (number | null)[] | null; // null when there is no heart rate (or it is hidden)
  speed: number[]; // m/s, lightly smoothed
}

export interface ReplayGap {
  after: number; // index of the segment the gap follows
  kind: "fog" | "cut";
  durationS: number; // replay seconds the gap takes (fog: 5-min steps; cut: 0)
}

export interface ReplayData {
  v: typeof REPLAY_FORMAT_VERSION;
  sportType: string;
  segments: ReplaySegment[];
  gaps: ReplayGap[];
  totalS: number;
}

const r5 = (v: number) => Math.round(v * 1e5) / 1e5;
const r1 = (v: number | null) => (v === null ? null : Math.round(v * 10) / 10);
const r2 = (v: number) => Math.round(v * 100) / 100;

export function fogGapReplayS(realS: number): number {
  return Math.max(300, Math.round(realS / 300) * 300);
}

// segments: visible runs in order; runOf[i]: which continuous recording run
// segment i came from (different runs = a cut or merge gap, same run = fog)
export function buildReplay(
  segments: FogSample[][],
  runOf: number[],
  recordAt: (t: number) => TrackRecord | undefined,
  sportType: string,
  maxPoints = REPLAY_MAX_POINTS
): ReplayData | null {
  const usable = segments.map((s, i) => ({ s, run: runOf[i] })).filter((x) => x.s.length >= 2);
  const total = usable.reduce((n, x) => n + x.s.length, 0);
  if (total < 2) return null;
  const stride = Math.max(1, Math.ceil(total / maxPoints));

  const out: ReplaySegment[] = [];
  const gaps: ReplayGap[] = [];
  let clock = 0; // replay time at the start of the current segment
  let anyEle = false;
  let anyHr = false;

  usable.forEach(({ s, run }, k) => {
    if (k > 0) {
      const prev = usable[k - 1];
      const realGap = s[0].t - prev.s[prev.s.length - 1].t;
      const kind = prev.run === run ? "fog" : "cut";
      const durationS = kind === "fog" ? fogGapReplayS(realGap) : 0;
      gaps.push({ after: out.length - 1, kind, durationS });
      clock += durationS;
    }
    // keep both ends of every segment, every stride-th point between
    const idx: number[] = [];
    for (let i = 0; i < s.length; i += stride) idx.push(i);
    if (idx[idx.length - 1] !== s.length - 1) idx.push(s.length - 1);

    const seg: ReplaySegment = { t: [], lat: [], lng: [], ele: [], hr: [], speed: [] };
    const t0 = s[0].t;
    for (let j = 0; j < idx.length; j++) {
      const p = s[idx[j]];
      const rec = recordAt(p.t);
      seg.t.push(Math.round(clock + (p.t - t0)));
      seg.lat.push(r5(p.lat));
      seg.lng.push(r5(p.lng));
      const ele = rec?.ele ?? null;
      const hr = rec?.hr ?? null;
      if (ele !== null) anyEle = true;
      if (hr !== null) anyHr = true;
      seg.ele!.push(r1(ele));
      seg.hr!.push(hr === null ? null : Math.round(hr));
      seg.speed.push(rec?.speed ?? NaN);
    }
    // speed: device channel when present, else distance over time between kept points
    for (let j = 0; j < seg.speed.length; j++) {
      if (Number.isFinite(seg.speed[j])) continue;
      const a = Math.max(0, j - 1);
      const b = Math.min(seg.t.length - 1, j + 1);
      const dt = seg.t[b] - seg.t[a];
      const d = haversine(seg.lat[a], seg.lng[a], seg.lat[b], seg.lng[b]);
      seg.speed[j] = dt > 0 ? d / dt : 0;
    }
    // light smoothing (3-point) so the colors and the avatar don't flicker
    seg.speed = seg.speed.map((v, j, arr) => r2((arr[Math.max(0, j - 1)] + v + arr[Math.min(arr.length - 1, j + 1)]) / 3));
    clock = seg.t[seg.t.length - 1];
    out.push(seg);
  });

  for (const seg of out) {
    if (!anyEle) seg.ele = null;
    if (!anyHr) seg.hr = null;
  }
  return { v: REPLAY_FORMAT_VERSION, sportType, segments: out, gaps, totalS: clock };
}

function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLng = (lng2 - lng1) * toRad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371008.8 * Math.asin(Math.sqrt(a));
}

// public view: heart rate removed when the activity hides it
export function publicReplay(data: ReplayData, hrHidden: boolean): ReplayData {
  if (!hrHidden) return data;
  return { ...data, segments: data.segments.map((s) => ({ ...s, hr: null })) };
}
