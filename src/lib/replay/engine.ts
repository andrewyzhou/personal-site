// replay engine: pure, deterministic playback math over the published replay
// track. no dom, no map — the player feeds it times and draws what it says.
//
//   replay time  the track's own clock (fog gaps already rounded, cuts 0)
//   wall time    seconds on screen at a chosen speed; idle stretches play
//                10× faster still and fog gaps take a few seconds at most
//
// everything inside a fog gap comes from ./decoy (public endpoints + seed).

import type { ReplayData } from "./build";
import { sportLimits, SNOW_SPORTS } from "../cleaning/sport";
import { decoyAt, decoyPath, decoySeed, haversineM, type DecoyPath, type FogBlob, type LatLng } from "./decoy";

export const SPEED_CHOICES = [10, 30, 60, 120, 300] as const;
export type SpeedChoice = (typeof SPEED_CHOICES)[number];

export const IDLE_MIN_S = 20; // idle this long gets fast-forwarded
export const IDLE_FF = 10; // …at this many times the chosen speed
export const PAUSE_MIN_S = 60; // idle this long gets a chip
export const FOG_WALL_MAX_S = 4;
export const FOG_WALL_MIN_S = 1.5;
export const TARGET_WALL_S = 60; // default speed: the slowest that fits this

export interface TimelineGap {
  index: number;
  kind: "fog" | "cut";
  after: number; // segment index
  startT: number;
  endT: number;
  durationS: number;
  from: LatLng; // last published point before
  to: LatLng; // first published point after
  blob: FogBlob | null; // fog only
  decoy: DecoyPath | null; // fog only
}

export interface IdleStretch {
  startT: number;
  endT: number;
}

export interface Timeline {
  sportType: string;
  totalS: number;
  n: number;
  t: Float64Array;
  lat: Float64Array;
  lng: Float64Array;
  speed: Float64Array;
  seg: Int32Array; // segment of each flat point
  dist: Float64Array; // cumulative metres (fog: chord between public ends, cut: 0)
  bearing: Float64Array; // heading of the interval starting at each point
  segStart: number[];
  segEnd: number[];
  gaps: TimelineGap[];
  gapAfter: (TimelineGap | null)[]; // by segment index
  idle: IdleStretch[];
}

export interface TimelineOptions {
  activityId?: string | number; // seeds the decoys; endpoints are used otherwise
}

function bearingDeg(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = Math.PI / 180;
  const p1 = lat1 * toRad;
  const p2 = lat2 * toRad;
  const dl = (lng2 - lng1) * toRad;
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

export function buildTimeline(replay: ReplayData, opts: TimelineOptions = {}): Timeline {
  const segs = replay.segments.filter((s) => s.t.length > 0);
  const n = segs.reduce((k, s) => k + s.t.length, 0);
  const t = new Float64Array(n);
  const lat = new Float64Array(n);
  const lng = new Float64Array(n);
  const speed = new Float64Array(n);
  const seg = new Int32Array(n);
  const dist = new Float64Array(n);
  const bearing = new Float64Array(n);
  const segStart: number[] = [];
  const segEnd: number[] = [];

  let k = 0;
  segs.forEach((s, si) => {
    segStart.push(k);
    for (let j = 0; j < s.t.length; j++, k++) {
      t[k] = s.t[j];
      lat[k] = s.lat[j];
      lng[k] = s.lng[j];
      speed[k] = Number.isFinite(s.speed[j]) ? s.speed[j] : 0;
      seg[k] = si;
      // keep time monotonic even if the data isn't
      if (k > 0 && t[k] < t[k - 1]) t[k] = t[k - 1];
    }
    segEnd.push(k - 1);
  });

  // gaps by segment (the stored `after` indexes the same, unfiltered list;
  // segments are never empty in practice, so they line up)
  const gapAfter: (TimelineGap | null)[] = segs.map(() => null);
  const gaps: TimelineGap[] = [];
  for (let si = 0; si < segs.length - 1; si++) {
    const g = replay.gaps.find((x) => x.after === si);
    const a = segEnd[si];
    const b = segStart[si + 1];
    const from: LatLng = [lat[a], lng[a]];
    const to: LatLng = [lat[b], lng[b]];
    const kind = g?.kind ?? (t[b] > t[a] ? "fog" : "cut");
    const index = gaps.length;
    const gap: TimelineGap = {
      index,
      kind,
      after: si,
      startT: t[a],
      endT: t[b],
      durationS: t[b] - t[a],
      from,
      to,
      blob: null,
      decoy: null,
    };
    if (kind === "fog" && gap.durationS > 0) {
      gap.decoy = decoyPath(from, to, decoySeed(index, from, to, opts.activityId), gap.durationS);
      gap.blob = gap.decoy.blob;
    } else {
      gap.kind = "cut";
    }
    gaps.push(gap);
    gapAfter[si] = gap;
  }

  // distance and heading
  for (let i = 1; i < n; i++) {
    let d = 0;
    if (seg[i] === seg[i - 1]) d = haversineM([lat[i - 1], lng[i - 1]], [lat[i], lng[i]]);
    else if (gapAfter[seg[i - 1]]?.kind === "fog") d = haversineM([lat[i - 1], lng[i - 1]], [lat[i], lng[i]]);
    dist[i] = dist[i - 1] + d;
  }
  let lastBearing = 0;
  for (let i = 0; i < n; i++) {
    const j = i + 1;
    if (j < n && seg[j] === seg[i] && (lat[j] !== lat[i] || lng[j] !== lng[i])) {
      lastBearing = bearingDeg(lat[i], lng[i], lat[j], lng[j]);
    }
    bearing[i] = lastBearing;
  }
  // backfill a leading run that never moved
  const firstMove = bearing.findIndex((b) => b !== 0);
  if (firstMove > 0) for (let i = 0; i < firstMove; i++) bearing[i] = bearing[firstMove];

  // idle stretches: intervals slower than the sport's idle speed, merged
  const idleSpeed = sportLimits(replay.sportType).idle;
  const idle: IdleStretch[] = [];
  let open: IdleStretch | null = null;
  for (let i = 0; i < n - 1; i++) {
    const same = seg[i + 1] === seg[i];
    const dt = t[i + 1] - t[i];
    const slow = same && dt > 0 && (dist[i + 1] - dist[i]) / dt < idleSpeed;
    if (slow) {
      if (open && open.endT === t[i]) open.endT = t[i + 1];
      else {
        if (open) idle.push(open);
        open = { startT: t[i], endT: t[i + 1] };
      }
    } else if (open) {
      idle.push(open);
      open = null;
    }
  }
  if (open) idle.push(open);

  return {
    sportType: replay.sportType,
    totalS: n > 0 ? t[n - 1] : 0,
    n,
    t,
    lat,
    lng,
    speed,
    seg,
    dist,
    bearing,
    segStart,
    segEnd,
    gaps,
    gapAfter,
    idle: idle.filter((s) => s.endT - s.startT >= IDLE_MIN_S),
  };
}

// largest i with t[i] <= x (0 when x is before the start)
function floorIndex(arr: Float64Array, x: number, n = arr.length): number {
  if (n === 0 || x < arr[0]) return 0;
  let lo = 0;
  let hi = n - 1;
  if (x >= arr[hi]) return hi;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] <= x) lo = mid;
    else hi = mid;
  }
  return lo;
}

export interface GapInfo {
  index: number;
  kind: "fog" | "cut";
  progress: number; // 0..1 through the gap
}

export interface Position {
  t: number;
  lat: number;
  lng: number;
  bearing: number;
  speed: number; // m/s
  distM: number;
  index: number; // flat point at or before t
  segment: number;
  gap: GapInfo | null; // inside a fog gap: lat/lng are the decoy's
}

// where the avatar is at replay time t, O(log n)
export function positionAt(tl: Timeline, tIn: number): Position {
  const t = Math.max(0, Math.min(tl.totalS, tIn));
  const i = floorIndex(tl.t, t, tl.n);
  const s = tl.seg[i];
  const j = i + 1;

  if (j < tl.n && tl.seg[j] !== s) {
    const gap = tl.gapAfter[s];
    if (gap && gap.kind === "fog" && gap.decoy && t < gap.endT) {
      const progress = gap.durationS > 0 ? (t - gap.startT) / gap.durationS : 1;
      const p = decoyAt(gap.decoy, progress);
      return {
        t,
        lat: p.lat,
        lng: p.lng,
        bearing: p.bearing,
        speed: gap.decoy.cum[gap.decoy.cum.length - 1] / Math.max(1, gap.durationS),
        distM: tl.dist[i] + (tl.dist[j] - tl.dist[i]) * progress,
        index: i,
        segment: s,
        gap: { index: gap.index, kind: "fog", progress },
      };
    }
  }

  if (j >= tl.n || tl.seg[j] !== s) {
    return { t, lat: tl.lat[i], lng: tl.lng[i], bearing: tl.bearing[i], speed: tl.speed[i], distM: tl.dist[i], index: i, segment: s, gap: null };
  }
  const span = tl.t[j] - tl.t[i];
  const u = span > 0 ? (t - tl.t[i]) / span : 1;
  return {
    t,
    lat: tl.lat[i] + (tl.lat[j] - tl.lat[i]) * u,
    lng: tl.lng[i] + (tl.lng[j] - tl.lng[i]) * u,
    bearing: tl.bearing[i],
    speed: tl.speed[i] + (tl.speed[j] - tl.speed[i]) * u,
    distM: tl.dist[i] + (tl.dist[j] - tl.dist[i]) * u,
    index: i,
    segment: s,
    gap: null,
  };
}

// ── playback time ───────────────────────────────────────────────────────────

export interface PlayMap {
  speed: number;
  r: Float64Array; // replay-time breakpoints
  w: Float64Array; // matching wall-time breakpoints
  wallS: number;
}

export function fogWallS(durationS: number, speed: number): number {
  return Math.max(FOG_WALL_MIN_S, Math.min(FOG_WALL_MAX_S, durationS / speed));
}

// piecewise-linear replay ↔ wall map at one speed multiplier
export function playMap(tl: Timeline, speed: number): PlayMap {
  const special: { a: number; b: number; wall: number }[] = [];
  for (const s of tl.idle) special.push({ a: s.startT, b: s.endT, wall: (s.endT - s.startT) / (speed * IDLE_FF) });
  for (const g of tl.gaps) if (g.kind === "fog" && g.durationS > 0) special.push({ a: g.startT, b: g.endT, wall: fogWallS(g.durationS, speed) });
  special.sort((x, y) => x.a - y.a);

  const r: number[] = [0];
  const w: number[] = [0];
  let cur = 0;
  let wall = 0;
  for (const sp of special) {
    if (sp.b <= cur) continue;
    const a = Math.max(sp.a, cur);
    if (a > cur) {
      wall += (a - cur) / speed;
      r.push(a);
      w.push(wall);
    }
    wall += sp.wall * ((sp.b - a) / (sp.b - sp.a));
    r.push(sp.b);
    w.push(wall);
    cur = sp.b;
  }
  if (tl.totalS > cur) {
    wall += (tl.totalS - cur) / speed;
    r.push(tl.totalS);
    w.push(wall);
  }
  return { speed, r: Float64Array.from(r), w: Float64Array.from(w), wallS: wall };
}

export function wallDuration(tl: Timeline, speed: number): number {
  return playMap(tl, speed).wallS;
}

function interp(from: Float64Array, to: Float64Array, x: number): number {
  const n = from.length;
  if (n === 0) return 0;
  if (x <= from[0]) return to[0];
  if (x >= from[n - 1]) return to[n - 1];
  const i = floorIndex(from, x, n);
  const span = from[i + 1] - from[i];
  return span > 0 ? to[i] + ((to[i + 1] - to[i]) * (x - from[i])) / span : to[i + 1];
}

export function replayToWall(pm: PlayMap, replayT: number): number {
  return interp(pm.r, pm.w, replayT);
}

export function wallToReplay(pm: PlayMap, wallT: number): number {
  return interp(pm.w, pm.r, wallT);
}

// the slowest choice that plays within TARGET_WALL_S (a 30-min run → 30×)
export function defaultSpeed(tl: Timeline): SpeedChoice {
  for (const s of SPEED_CHOICES) if (wallDuration(tl, s) <= TARGET_WALL_S) return s;
  return SPEED_CHOICES[SPEED_CHOICES.length - 1];
}

// ── chase cam ───────────────────────────────────────────────────────────────

export const CHASE_PITCH = 60;
export const HEADING_TAU_S = 0.8;
export const ZOOM_TAU_S = 1.5;
export const ZOOM_NEAR = 17.2;
export const ZOOM_FAR = 14;

export function wrap360(a: number): number {
  return ((a % 360) + 360) % 360;
}

// signed shortest turn from a to b, in (-180, 180]
export function angleDelta(a: number, b: number): number {
  const d = wrap360(b - a);
  return d > 180 ? d - 360 : d;
}

// exponential smoothing with an explicit time step (frame-rate independent)
export function smoothValue(prev: number, target: number, dt: number, tau: number): number {
  if (tau <= 0 || dt <= 0) return dt <= 0 ? prev : target;
  return prev + (target - prev) * (1 - Math.exp(-dt / tau));
}

export function smoothAngle(prev: number, target: number, dt: number, tau: number): number {
  return wrap360(prev + smoothValue(0, angleDelta(prev, target), dt, tau));
}

// how far ahead the camera looks, in replay seconds (~1.2 s on screen)
export function lookAheadS(speed: number): number {
  return Math.max(15, Math.min(120, speed * 1.2));
}

// heading toward the point the avatar reaches `aheadS` later; falls back to
// the current segment heading when that point is basically here
export function lookAheadBearing(tl: Timeline, t: number, aheadS: number): number {
  const p = positionAt(tl, t);
  const q = positionAt(tl, t + aheadS);
  if (haversineM([p.lat, p.lng], [q.lat, q.lng]) < 5) return p.bearing;
  return bearingDeg(p.lat, p.lng, q.lat, q.lng);
}

// closer when slow: walking ≈ 17, running ≈ 15.8, riding ≈ 14.9
export function chaseZoom(speedMs: number): number {
  const z = ZOOM_NEAR - 0.7 * Math.log2(Math.max(1, speedMs));
  return Math.max(ZOOM_FAR, Math.min(ZOOM_NEAR, z));
}

// zoom at which `radiusM` spans ~`px` screen pixels (512-px tiles)
export function zoomForRadius(lat: number, radiusM: number, px = 140): number {
  const mpp = radiusM / px;
  return Math.log2((40075016.686 * Math.cos((lat * Math.PI) / 180)) / (512 * mpp));
}

export function destination(lat: number, lng: number, bearing: number, meters: number): LatLng {
  const d = meters / 6371008.8;
  const th = (bearing * Math.PI) / 180;
  const p1 = (lat * Math.PI) / 180;
  const l1 = (lng * Math.PI) / 180;
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(th));
  const l2 = l1 + Math.atan2(Math.sin(th) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return [(p2 * 180) / Math.PI, (((l2 * 180) / Math.PI + 540) % 360) - 180];
}

export interface ChaseState {
  heading: number;
  zoom: number;
}

export interface ChaseCamera {
  center: [number, number]; // [lng, lat] for maplibre
  bearing: number;
  pitch: number;
  zoom: number;
}

// one camera step. state null → snap to the target (first frame / after a seek)
export function chaseStep(
  tl: Timeline,
  state: ChaseState | null,
  t: number,
  dt: number,
  speed: number
): { state: ChaseState; camera: ChaseCamera } {
  const pos = positionAt(tl, t);
  const targetHeading = lookAheadBearing(tl, t, lookAheadS(speed));
  let targetZoom = chaseZoom(pos.speed);
  if (pos.gap) {
    const blob = tl.gaps[pos.gap.index].blob;
    if (blob) targetZoom = Math.max(ZOOM_FAR - 2, Math.min(targetZoom, zoomForRadius(blob.center[0], blob.radiusM)));
  }
  const next: ChaseState = state
    ? { heading: smoothAngle(state.heading, targetHeading, dt, HEADING_TAU_S), zoom: smoothValue(state.zoom, targetZoom, dt, ZOOM_TAU_S) }
    : { heading: targetHeading, zoom: targetZoom };
  // the target leads the avatar a little so more of the way ahead is on screen
  const leadM = 30 * Math.pow(2, ZOOM_NEAR - next.zoom);
  const [clat, clng] = destination(pos.lat, pos.lng, next.heading, leadM);
  return { state: next, camera: { center: [clng, clat], bearing: next.heading, pitch: CHASE_PITCH, zoom: next.zoom } };
}

// ── events ──────────────────────────────────────────────────────────────────

export type DistanceUnit = "km" | "mi";
export const UNIT_M: Record<DistanceUnit, number> = { km: 1000, mi: 1609.344 };

export type ReplayEvent =
  | { kind: "pause"; t: number; endT: number; durationS: number }
  | { kind: "fog"; t: number; endT: number; durationS: number; gap: number }
  | { kind: "cut"; t: number; endT: number; gap: number }
  | { kind: "split"; t: number; endT: number; n: number; unit: DistanceUnit }
  | { kind: "maxSpeed"; t: number; endT: number; speed: number };

export interface EventOptions {
  unit?: DistanceUnit;
  maxSpeed?: boolean;
}

export function buildEvents(tl: Timeline, opts: EventOptions = {}): ReplayEvent[] {
  const unit = opts.unit ?? "km";
  const out: ReplayEvent[] = [];
  for (const s of tl.idle) {
    if (s.endT - s.startT >= PAUSE_MIN_S) out.push({ kind: "pause", t: s.startT, endT: s.endT, durationS: s.endT - s.startT });
  }
  for (const g of tl.gaps) {
    if (g.kind === "fog") out.push({ kind: "fog", t: g.startT, endT: g.endT, durationS: g.durationS, gap: g.index });
    else out.push({ kind: "cut", t: g.startT, endT: g.startT, gap: g.index });
  }

  // splits: where the running distance crosses each whole unit; one that
  // falls inside a fog gap is skipped (nothing true to point at in there)
  if (tl.n > 1) {
    const step = UNIT_M[unit];
    const total = tl.dist[tl.n - 1];
    for (let k = 1; k * step <= total; k++) {
      const d = k * step;
      const i = floorIndex(tl.dist, d, tl.n);
      const j = Math.min(tl.n - 1, i + 1);
      if (tl.seg[j] !== tl.seg[i] && tl.dist[i] < d) continue;
      const span = tl.dist[j] - tl.dist[i];
      const u = span > 0 ? (d - tl.dist[i]) / span : 0;
      const t = tl.t[i] + (tl.t[j] - tl.t[i]) * u;
      out.push({ kind: "split", t, endT: t, n: k, unit });
    }
  }

  if (opts.maxSpeed && tl.n > 0) {
    const limits = sportLimits(tl.sportType);
    const cap = SNOW_SPORTS.has(tl.sportType) ? Infinity : limits.maxHuman;
    let best = -1;
    for (let i = 0; i < tl.n; i++) if (tl.speed[i] <= cap && (best < 0 || tl.speed[i] > tl.speed[best])) best = i;
    if (best >= 0 && tl.speed[best] > limits.idle) out.push({ kind: "maxSpeed", t: tl.t[best], endT: tl.t[best], speed: tl.speed[best] });
  }

  return out.sort((a, b) => a.t - b.t);
}

export const CHIP_HOLD_S = 2.5; // wall seconds a chip stays after its moment

// chips showing at replay time t: span events while inside them, all of them
// for a short hold afterwards (measured on screen, so it reads at any speed)
export function activeEvents(events: ReplayEvent[], pm: PlayMap, t: number, holdS = CHIP_HOLD_S): ReplayEvent[] {
  const w = replayToWall(pm, t);
  return events.filter((e) => {
    const a = replayToWall(pm, e.t);
    const b = replayToWall(pm, e.endT);
    return w >= a && w <= b + holdS;
  });
}

// ── photos ──────────────────────────────────────────────────────────────────

export interface PhotoMoment {
  photo: number; // index into the photos array
  t: number;
  lat: number;
  lng: number;
}

// each pinned photo at the replay time of the nearest published point
export function photoMoments(tl: Timeline, pins: (LatLng | null)[]): PhotoMoment[] {
  const out: PhotoMoment[] = [];
  pins.forEach((pin, photo) => {
    if (!pin || tl.n === 0) return;
    const k = Math.cos((pin[0] * Math.PI) / 180);
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < tl.n; i++) {
      const dy = tl.lat[i] - pin[0];
      const dx = (tl.lng[i] - pin[1]) * k;
      const d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    out.push({ photo, t: tl.t[best], lat: tl.lat[best], lng: tl.lng[best] });
  });
  return out.sort((a, b) => a.t - b.t);
}

export const PHOTO_SHOW_S = 3.5;
const PHOTO_FADE_IN_S = 0.3;
const PHOTO_FADE_OUT_S = 0.8;

// opacity of a photo pop-in (0 = not showing), by wall time since its moment
export function photoOpacity(pm: PlayMap, moment: PhotoMoment, t: number): number {
  const since = replayToWall(pm, t) - replayToWall(pm, moment.t);
  if (since < 0 || since > PHOTO_SHOW_S) return 0;
  if (since < PHOTO_FADE_IN_S) return since / PHOTO_FADE_IN_S;
  if (since > PHOTO_SHOW_S - PHOTO_FADE_OUT_S) return (PHOTO_SHOW_S - since) / PHOTO_FADE_OUT_S;
  return 1;
}

// ── fog fade ────────────────────────────────────────────────────────────────

const FOG_EDGE = 0.18;

// avatar opacity through a fog gap: fades in the first part, back at the end.
// the decoy shows with the complement.
export function avatarFogAlpha(progress: number): number {
  if (progress <= 0 || progress >= 1) return 1;
  if (progress < FOG_EDGE) return 1 - progress / FOG_EDGE;
  if (progress > 1 - FOG_EDGE) return (progress - (1 - FOG_EDGE)) / FOG_EDGE;
  return 0;
}

// ── trail ───────────────────────────────────────────────────────────────────

// the track drawn so far as [lng, lat] lines, one per segment, never across a
// gap. in fog the trail stops at the published exit point.
export function trailUpTo(tl: Timeline, pos: Position): [number, number][][] {
  const lines: [number, number][][] = [];
  for (let s = 0; s <= pos.segment && s < tl.segStart.length; s++) {
    const a = tl.segStart[s];
    const b = s < pos.segment ? tl.segEnd[s] : Math.min(tl.segEnd[s], pos.index);
    const line: [number, number][] = [];
    for (let i = a; i <= b; i++) line.push([tl.lng[i], tl.lat[i]]);
    if (s === pos.segment && !pos.gap && pos.index < tl.segEnd[s]) line.push([pos.lng, pos.lat]);
    if (line.length > 1) lines.push(line);
  }
  return lines;
}
