// fog decoy: what the replay shows while the track is inside a privacy zone.
// generated on the client from public data only — the published exit point
// before the gap, the published entry point after it, a seed and the gap's
// rounded duration. the blob is a circle around the midpoint of those two
// points (never a zone shape) and the decoy path is a seeded random wander
// inside it, so neither carries anything about the real path.

export type LatLng = [number, number];

const EARTH_R = 6371008.8;
const M_PER_DEG = (Math.PI / 180) * EARTH_R;

// blob radius: half the endpoint distance, stretched, plus a fixed margin
export const BLOB_STRETCH = 1.3;
export const BLOB_MARGIN_M = 80;
// the decoy stays inside this fraction of the blob radius
export const DECOY_MAX_FRAC = 0.9;

export function haversineM(a: LatLng, b: LatLng): number {
  const toRad = Math.PI / 180;
  const dLat = (b[0] - a[0]) * toRad;
  const dLng = (b[1] - a[1]) * toRad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * toRad) * Math.cos(b[0] * toRad) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.sqrt(Math.min(1, h)));
}

// fnv-1a, 32 bit
export function hashSeed(key: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// mulberry32: small, fast, good enough for wobble
export function prng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// seed for one gap: the activity id when known, else the public endpoints
export function decoySeed(gapIndex: number, from: LatLng, to: LatLng, activityId?: string | number): number {
  const base = activityId !== undefined ? `id:${activityId}` : `pts:${from[0]},${from[1]}|${to[0]},${to[1]}`;
  return hashSeed(`${base}#${gapIndex}`);
}

export interface FogBlob {
  center: LatLng;
  radiusM: number;
}

export function fogBlob(from: LatLng, to: LatLng): FogBlob {
  const d = haversineM(from, to);
  return {
    center: [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2],
    radiusM: (d / 2) * BLOB_STRETCH + BLOB_MARGIN_M,
  };
}

// local flat frame (metres) around a centre; fine at blob scale
function toLocal(c: LatLng, p: LatLng): [number, number] {
  const k = Math.cos((c[0] * Math.PI) / 180);
  return [(p[1] - c[1]) * M_PER_DEG * k, (p[0] - c[0]) * M_PER_DEG];
}

function fromLocal(c: LatLng, x: number, y: number): LatLng {
  const k = Math.cos((c[0] * Math.PI) / 180) || 1e-9;
  return [c[0] + y / M_PER_DEG, c[1] + x / (M_PER_DEG * k)];
}

export interface DecoyPath {
  blob: FogBlob;
  xs: Float64Array; // local metres
  ys: Float64Array;
  cum: Float64Array; // cumulative length
  durationS: number;
}

const SAMPLES_PER_SPAN = 16;

// a smooth wander from `from` to `to` through a few seeded waypoints inside
// the blob (catmull-rom, then pulled back inside if a curve bulges out)
export function decoyPath(from: LatLng, to: LatLng, seed: number, durationS: number): DecoyPath {
  const blob = fogBlob(from, to);
  const R = blob.radiusM;
  const rnd = prng(seed);
  const waypoints = Math.max(2, Math.min(7, Math.round(durationS / 240) + 2));

  const pts: [number, number][] = [toLocal(blob.center, from)];
  for (let i = 0; i < waypoints; i++) {
    const r = R * 0.7 * Math.sqrt(rnd());
    const th = rnd() * Math.PI * 2;
    pts.push([r * Math.cos(th), r * Math.sin(th)]);
  }
  pts.push(toLocal(blob.center, to));

  const limit = R * DECOY_MAX_FRAC;
  const n = (pts.length - 1) * SAMPLES_PER_SPAN + 1;
  const xs = new Float64Array(n);
  const ys = new Float64Array(n);
  let k = 0;
  for (let s = 0; s < pts.length - 1; s++) {
    const p0 = pts[Math.max(0, s - 1)];
    const p1 = pts[s];
    const p2 = pts[s + 1];
    const p3 = pts[Math.min(pts.length - 1, s + 2)];
    const steps = s === pts.length - 2 ? SAMPLES_PER_SPAN + 1 : SAMPLES_PER_SPAN;
    for (let j = 0; j < steps; j++) {
      const u = j / SAMPLES_PER_SPAN;
      const u2 = u * u;
      const u3 = u2 * u;
      let x = 0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * u + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * u2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * u3);
      let y = 0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * u + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * u2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * u3);
      const r = Math.hypot(x, y);
      if (r > limit) {
        x *= limit / r;
        y *= limit / r;
      }
      xs[k] = x;
      ys[k] = y;
      k++;
    }
  }
  // the ends are exactly the public points
  const a = pts[0];
  const b = pts[pts.length - 1];
  xs[0] = a[0];
  ys[0] = a[1];
  xs[n - 1] = b[0];
  ys[n - 1] = b[1];

  const cum = new Float64Array(n);
  for (let i = 1; i < n; i++) cum[i] = cum[i - 1] + Math.hypot(xs[i] - xs[i - 1], ys[i] - ys[i - 1]);
  return { blob, xs, ys, cum, durationS };
}

export interface DecoyPoint {
  lat: number;
  lng: number;
  bearing: number; // degrees clockwise from north
}

// position at fraction f (0..1) of the gap, constant speed along the path
export function decoyAt(path: DecoyPath, f: number): DecoyPoint {
  const { xs, ys, cum } = path;
  const n = xs.length;
  const total = cum[n - 1];
  const target = Math.max(0, Math.min(1, f)) * total;
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= target) lo = mid;
    else hi = mid;
  }
  const span = cum[hi] - cum[lo];
  const u = span > 0 ? (target - cum[lo]) / span : 0;
  const x = xs[lo] + (xs[hi] - xs[lo]) * u;
  const y = ys[lo] + (ys[hi] - ys[lo]) * u;
  const dx = xs[hi] - xs[lo];
  const dy = ys[hi] - ys[lo];
  const bearing = dx === 0 && dy === 0 ? 0 : ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
  const [lat, lng] = fromLocal(path.blob.center, x, y);
  return { lat, lng, bearing };
}

// a few soft puffs that make up the drawn fog: seeded offsets around the
// centre, each a fraction of the blob radius. drawing only, still public.
export interface FogPuff {
  lat: number;
  lng: number;
  radiusM: number;
  phase: number; // 0 or 1: which of the two breathing layers
}

export function fogPuffs(blob: FogBlob, seed: number, count = 5): FogPuff[] {
  const rnd = prng(seed ^ 0x9e3779b9);
  const out: FogPuff[] = [{ lat: blob.center[0], lng: blob.center[1], radiusM: blob.radiusM, phase: 0 }];
  for (let i = 1; i < count; i++) {
    const r = blob.radiusM * 0.35 * Math.sqrt(rnd());
    const th = rnd() * Math.PI * 2;
    const [lat, lng] = fromLocal(blob.center, r * Math.cos(th), r * Math.sin(th));
    out.push({ lat, lng, radiusM: blob.radiusM * (0.45 + 0.2 * rnd()), phase: i % 2 });
  }
  return out;
}

// helper for tests and drawing: distance of a point from the blob centre
export function distFromCenterM(blob: FogBlob, p: LatLng): number {
  const [x, y] = toLocal(blob.center, p);
  return Math.hypot(x, y);
}
