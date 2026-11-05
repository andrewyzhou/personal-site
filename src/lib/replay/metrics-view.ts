// pure view helpers for the activity map + charts: the replay flattened into
// one indexable track, per-point metrics (pace/speed, hr, grade, elevation),
// route color pieces, nearest-point lookups and chart scaling. no dom, no
// maplibre, so it all runs under vitest.

import type { ReplayData } from "./build";
import { PACE_TYPES, formatPace } from "../activity-format";
import { decodeMultiPolyline } from "../polyline";

export type MapMetric = "pace" | "speed" | "hr" | "grade" | "elevation";

export interface ReplayView {
  n: number;
  t: number[];
  lat: number[];
  lng: number[];
  ele: (number | null)[];
  hr: (number | null)[];
  speed: number[];
  dist: number[]; // cumulative meters; gaps add nothing
  seg: number[]; // segment index of each point
  segStart: number[]; // first flat index of each segment (plus n at the end)
  hasEle: boolean;
  hasHr: boolean;
  totalDist: number;
  totalS: number;
}

export function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLng = (lng2 - lng1) * toRad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371008.8 * Math.asin(Math.sqrt(a));
}

export function buildReplayView(r: ReplayData): ReplayView {
  const v: ReplayView = {
    n: 0, t: [], lat: [], lng: [], ele: [], hr: [], speed: [], dist: [], seg: [], segStart: [],
    hasEle: false, hasHr: false, totalDist: 0, totalS: r.totalS,
  };
  let d = 0;
  r.segments.forEach((s, k) => {
    v.segStart.push(v.t.length);
    for (let i = 0; i < s.t.length; i++) {
      if (i > 0) d += haversineM(s.lat[i - 1], s.lng[i - 1], s.lat[i], s.lng[i]);
      v.t.push(s.t[i]);
      v.lat.push(s.lat[i]);
      v.lng.push(s.lng[i]);
      const e = s.ele?.[i] ?? null;
      const h = s.hr?.[i] ?? null;
      if (e !== null) v.hasEle = true;
      if (h !== null) v.hasHr = true;
      v.ele.push(e);
      v.hr.push(h);
      v.speed.push(Number.isFinite(s.speed[i]) ? s.speed[i] : 0);
      v.dist.push(d);
      v.seg.push(k);
    }
  });
  v.n = v.t.length;
  v.segStart.push(v.n);
  v.totalDist = d;
  return v;
}

export function speedMetricFor(sportType: string): "pace" | "speed" {
  return PACE_TYPES.has(sportType) ? "pace" : "speed";
}

export function availableMetrics(view: ReplayView, sportType: string): MapMetric[] {
  const out: MapMetric[] = [speedMetricFor(sportType)];
  if (view.hasHr) out.push("hr");
  if (view.hasEle) out.push("grade", "elevation");
  return out;
}

// grade in percent over a ~windowM window centred on each point, within the
// point's own segment (never across a gap)
export function gradeSeries(view: ReplayView, windowM = 60): (number | null)[] {
  const out: (number | null)[] = new Array(view.n).fill(null);
  if (!view.hasEle) return out;
  const half = windowM / 2;
  for (let k = 0; k + 1 < view.segStart.length; k++) {
    const s0 = view.segStart[k];
    const s1 = view.segStart[k + 1];
    let a = s0;
    let b = s0;
    for (let i = s0; i < s1; i++) {
      while (a < i && view.dist[i] - view.dist[a] > half) a++;
      if (b < i) b = i;
      while (b + 1 < s1 && view.dist[b] - view.dist[i] < half) b++;
      const ea = view.ele[a];
      const eb = view.ele[b];
      const run = view.dist[b] - view.dist[a];
      if (ea === null || eb === null || run < 10) continue;
      out[i] = ((eb - ea) / run) * 100;
    }
  }
  return out;
}

export function metricSeries(view: ReplayView, metric: MapMetric): (number | null)[] {
  switch (metric) {
    case "pace":
    case "speed":
      return view.speed;
    case "hr":
      return view.hr;
    case "elevation":
      return view.ele;
    case "grade":
      return gradeSeries(view);
  }
}

export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  const i = (sorted.length - 1) * p;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

function finite(values: (number | null)[]): number[] {
  const out: number[] = [];
  for (const v of values) if (v !== null && Number.isFinite(v)) out.push(v);
  return out;
}

// color domain: robust (5th-95th percentile) so one gps spike doesn't wash
// the route out; grade is symmetric around flat; elevation uses the full range
export function metricDomain(values: (number | null)[], metric: MapMetric): [number, number] {
  let vals = finite(values);
  if (metric === "pace" || metric === "speed") vals = vals.filter((v) => v > 0.3); // drop stops
  if (vals.length === 0) return [0, 1];
  vals.sort((x, y) => x - y);
  let lo: number;
  let hi: number;
  if (metric === "grade") {
    const abs = vals.map(Math.abs).sort((x, y) => x - y);
    const m = Math.min(20, Math.max(3, percentile(abs, 0.95)));
    return [-m, m];
  }
  if (metric === "elevation") {
    lo = vals[0];
    hi = vals[vals.length - 1];
  } else {
    lo = percentile(vals, 0.05);
    hi = percentile(vals, 0.95);
  }
  if (hi - lo < 1e-6) {
    const pad = Math.max(1, Math.abs(lo) * 0.05);
    return [lo - pad, hi + pad];
  }
  return [lo, hi];
}

// sequential palette, low → high (slow → fast, flat-down → up, low → high).
// mid-saturation so every stop reads on both the light and dark gray maps.
export const ROUTE_PALETTE = ["#4c6ef5", "#8b5cf6", "#d946a8", "#f0565a", "#f5883a", "#f2b52c"];
// the single route color when there's no replay (polyline only)
export const ROUTE_SOLID = "#f0565a";
// points with no value for the metric
export const ROUTE_NO_DATA = "#8a8a8a";

function hexToRgb(h: string): [number, number, number] {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex([r, g, b]: [number, number, number]): string {
  return "#" + [r, g, b].map((c) => Math.round(c).toString(16).padStart(2, "0")).join("");
}

// position in [0, 1] → palette color (linear rgb interpolation between stops)
export function paletteAt(f: number, palette = ROUTE_PALETTE): string {
  const x = Math.max(0, Math.min(1, Number.isFinite(f) ? f : 0)) * (palette.length - 1);
  const i = Math.min(palette.length - 2, Math.floor(x));
  const a = hexToRgb(palette[i]);
  const b = hexToRgb(palette[i + 1]);
  const u = x - i;
  return rgbToHex([a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u]);
}

export function colorFor(v: number | null, domain: [number, number]): string {
  if (v === null || !Number.isFinite(v)) return ROUTE_NO_DATA;
  return paletteAt((v - domain[0]) / (domain[1] - domain[0]));
}

// css gradient for the legend bar
export function legendGradient(palette = ROUTE_PALETTE): string {
  return `linear-gradient(90deg, ${palette.join(", ")})`;
}

export interface RoutePiece {
  coords: [number, number][]; // [lng, lat]
  color: string;
}

// the route as short runs of one quantized color each. consecutive pieces
// share their joining point so the line stays continuous; segments are never
// joined across a gap. ~buckets distinct colors keeps the feature count low.
export function routePieces(
  view: ReplayView,
  values: (number | null)[],
  domain: [number, number],
  buckets = 24
): RoutePiece[] {
  const bucketOf = (v: number | null) => {
    if (v === null || !Number.isFinite(v)) return -1;
    const f = (v - domain[0]) / (domain[1] - domain[0]);
    return Math.max(0, Math.min(buckets - 1, Math.floor(Math.max(0, Math.min(1, f)) * buckets)));
  };
  const colorOf = (b: number) => (b < 0 ? ROUTE_NO_DATA : paletteAt((b + 0.5) / buckets));
  const out: RoutePiece[] = [];
  for (let k = 0; k + 1 < view.segStart.length; k++) {
    const s0 = view.segStart[k];
    const s1 = view.segStart[k + 1];
    if (s1 - s0 < 2) continue;
    let cur = bucketOf(values[s0]);
    let coords: [number, number][] = [[view.lng[s0], view.lat[s0]]];
    for (let i = s0 + 1; i < s1; i++) {
      coords.push([view.lng[i], view.lat[i]]);
      const b = i < s1 - 1 ? bucketOf(values[i]) : cur;
      if (b !== cur) {
        out.push({ coords, color: colorOf(cur) });
        coords = [[view.lng[i], view.lat[i]]];
        cur = b;
      }
    }
    if (coords.length > 1) out.push({ coords, color: colorOf(cur) });
  }
  return out;
}

// nearest track point to a lng/lat (equirectangular, fine at route scale)
export function nearestIndex(view: ReplayView, lng: number, lat: number): number {
  if (view.n === 0) return -1;
  const kx = Math.cos((lat * Math.PI) / 180);
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < view.n; i++) {
    const dx = (view.lng[i] - lng) * kx;
    const dy = view.lat[i] - lat;
    const d = dx * dx + dy * dy;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

// index of the last value ≤ x in an increasing array (clamped), then the
// closer of it and its neighbour
export function nearestSorted(arr: number[], x: number): number {
  const n = arr.length;
  if (n === 0) return -1;
  if (x <= arr[0]) return 0;
  if (x >= arr[n - 1]) return n - 1;
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] <= x) lo = mid;
    else hi = mid;
  }
  return x - arr[lo] <= arr[hi] - x ? lo : hi;
}

export const indexAtTime = (view: ReplayView, t: number) => nearestSorted(view.t, t);
export const indexAtDistance = (view: ReplayView, d: number) => nearestSorted(view.dist, d);

// chart x axis: distance when the track moves, else replay time
export function chartX(view: ReplayView): number[] {
  return view.totalDist > 10 ? view.dist : view.t;
}

// where the fog gaps fall on the chart's x axis: [x0, x1] in chart units.
// by distance a gap has no width (hidden distance is never counted), so
// x0 === x1 and the chart draws a marker line; by time it is a band.
export function fogMarks(view: ReplayView, gaps: { after: number; kind: string }[]): [number, number][] {
  const xs = chartX(view);
  const out: [number, number][] = [];
  for (const g of gaps) {
    if (g.kind !== "fog") continue;
    const endPrev = view.segStart[g.after + 1] - 1;
    const startNext = view.segStart[g.after + 1];
    if (endPrev < 0 || startNext >= view.n) continue;
    out.push([xs[endPrev], xs[startNext]]);
  }
  return out;
}

export function linearScale(domain: [number, number], range: [number, number]) {
  const span = domain[1] - domain[0] || 1;
  return (v: number) => range[0] + ((v - domain[0]) / span) * (range[1] - range[0]);
}

// y extent with a little headroom; null when the series is empty
export function seriesExtent(values: (number | null)[], pad = 0.08, robust = false): [number, number] | null {
  const vals = finite(values).sort((a, b) => a - b);
  if (vals.length === 0) return null;
  let lo = robust ? percentile(vals, 0.01) : vals[0];
  let hi = robust ? percentile(vals, 0.99) : vals[vals.length - 1];
  if (hi - lo < 1e-6) {
    lo -= 1;
    hi += 1;
  }
  const p = (hi - lo) * pad;
  return [lo - p, hi + p];
}

// indices to draw for a series at a given pixel width: per pixel column keep
// the first, min, max and last point, so the shape survives at any density.
// xs must be increasing; null values are skipped (the path breaks there).
export function downsampleIndices(xs: number[], ys: (number | null)[], from: number, to: number, widthPx: number): number[] {
  const n = to - from;
  if (n <= 0) return [];
  if (n <= widthPx * 4) {
    const all: number[] = [];
    for (let i = from; i < to; i++) if (ys[i] !== null && Number.isFinite(ys[i])) all.push(i);
    return all;
  }
  const x0 = xs[from];
  const span = xs[to - 1] - x0 || 1;
  const out: number[] = [];
  let col = -1;
  let first = -1, last = -1, min = -1, max = -1;
  const flush = () => {
    if (first < 0) return;
    const set = Array.from(new Set([first, min, max, last])).sort((a, b) => a - b);
    out.push(...set);
  };
  for (let i = from; i < to; i++) {
    const y = ys[i];
    if (y === null || !Number.isFinite(y)) continue;
    const c = Math.floor(((xs[i] - x0) / span) * (widthPx - 1));
    if (c !== col) {
      flush();
      col = c;
      first = last = min = max = i;
      continue;
    }
    last = i;
    if (y < (ys[min] as number)) min = i;
    if (y > (ys[max] as number)) max = i;
  }
  flush();
  return out;
}

// svg path for one series across all segments (a new subpath per segment and
// after any missing value)
export function seriesPath(
  view: ReplayView,
  ys: (number | null)[],
  sx: (v: number) => number,
  sy: (v: number) => number,
  widthPx: number
): string {
  const xs = chartX(view);
  let d = "";
  for (let k = 0; k + 1 < view.segStart.length; k++) {
    const idx = downsampleIndices(xs, ys, view.segStart[k], view.segStart[k + 1], widthPx);
    let prev = -2;
    for (const i of idx) {
      const cmd = i === prev + 1 || (prev >= 0 && noNullsBetween(ys, prev, i)) ? "L" : "M";
      d += `${cmd}${sx(xs[i]).toFixed(1)} ${sy(ys[i] as number).toFixed(1)}`;
      prev = i;
    }
  }
  return d;
}

function noNullsBetween(ys: (number | null)[], a: number, b: number): boolean {
  for (let i = a + 1; i < b; i++) if (ys[i] === null) return false;
  return true;
}

// closed area under a series down to the baseline y (one per segment run)
export function seriesArea(
  view: ReplayView,
  ys: (number | null)[],
  sx: (v: number) => number,
  sy: (v: number) => number,
  baseY: number,
  widthPx: number
): string {
  const line = seriesPath(view, ys, sx, sy, widthPx);
  if (!line) return "";
  // close each subpath to the baseline
  return line
    .split("M")
    .filter(Boolean)
    .map((sub) => {
      const pts = sub.split("L");
      const first = pts[0].split(" ")[0];
      const last = pts[pts.length - 1].split(" ")[0];
      return `M${first} ${baseY.toFixed(1)}L${sub}L${last} ${baseY.toFixed(1)}Z`;
    })
    .join("");
}

export function formatMetric(v: number | null, metric: MapMetric): string {
  if (v === null || !Number.isFinite(v)) return "—";
  switch (metric) {
    case "pace":
      // below a crawl there is no meaningful pace: say so rather than a dash
      return v > 0.3 ? formatPace(v) : "stopped";
    case "speed":
      return `${(v * 2.23694).toFixed(1)} mph`;
    case "hr":
      return `${Math.round(v)} bpm`;
    case "grade":
      return `${v > 0 ? "+" : ""}${v.toFixed(1)}%`;
    case "elevation":
      return `${Math.round(v * 3.28084)} ft`;
  }
}

export const METRIC_LABELS: Record<MapMetric, string> = {
  pace: "pace",
  speed: "speed",
  hr: "hr",
  grade: "grade",
  elevation: "elev",
};

export function formatDistance(m: number): string {
  return `${(m / 1609.344).toFixed(2)} mi`;
}

export function formatElapsed(s: number): string {
  const r = Math.max(0, Math.round(s));
  const h = Math.floor(r / 3600);
  const m = Math.floor((r % 3600) / 60);
  const sec = r % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
}

// start/end markers: only ever the published endpoints (first point of the
// first segment, last point of the last), already trimmed and fogged. the
// replay when there is one, else the published polyline. [lng, lat].
export function publishedEndpoints(
  view: ReplayView | null,
  polyline: string | null
): { start: [number, number]; end: [number, number] } | null {
  if (view && view.n > 0) {
    return { start: [view.lng[0], view.lat[0]], end: [view.lng[view.n - 1], view.lat[view.n - 1]] };
  }
  if (!polyline) return null;
  let segs: [number, number][][];
  try {
    segs = decodeMultiPolyline(polyline).filter((s) => s.length > 0);
  } catch {
    return null;
  }
  if (segs.length === 0) return null;
  const first = segs[0][0];
  const lastSeg = segs[segs.length - 1];
  const last = lastSeg[lastSeg.length - 1];
  return { start: [first[1], first[0]], end: [last[1], last[0]] };
}
