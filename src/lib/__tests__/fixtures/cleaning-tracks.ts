// real-shaped synthetic canonical tracks for the cleaning detectors: 1 hz,
// device-like (fit: speed + distance channels) or gpx-like (positions only),
// with seeded gps noise so every run is identical

import type { CanonicalTrack } from "../../canonical-track";

export interface Segment {
  dur: number; // seconds
  v: number | ((s: number) => number); // m/s, s = seconds into the segment
  hr?: number;
  grade?: number; // elevation change per metre
  turn?: number; // heading change per second (radians)
  gpsStill?: boolean; // positions jitter around one spot whatever the speed (treadmill)
  mark?: string;
}

export interface BuildOpts {
  sportType: string;
  fileType: "fit" | "gpx";
  positions?: boolean; // default true
  seed?: number;
  jitterM?: number; // jitter step for still positions (default 0.5 m)
}

export interface Built {
  track: CanonicalTrack;
  marks: Record<string, { fromS: number; toS: number; distM: number }>;
}

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = a;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

const M_PER_DEG_LAT = 110540;
const LAT0 = 47.37;
const LNG0 = 8.54;
const M_PER_DEG_LNG = 111320 * Math.cos((LAT0 * Math.PI) / 180);

export function buildTrack(segments: Segment[], opts: BuildOpts): Built {
  const rand = rng(opts.seed ?? 1);
  const gauss = () => {
    const u = Math.max(1e-12, rand());
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
  };
  const positions = opts.positions !== false;
  const fit = opts.fileType === "fit";
  const jitter = opts.jitterM ?? 0.5;
  const c: CanonicalTrack["columns"] = { t: [], lat: [], lng: [], ele: [], hr: [], cadence: [], watts: [], speed: [], dist: [] };
  const marks: Built["marks"] = {};
  let x = 0, y = 0, ele = 400, heading = 0.3, dist = 0, t = 0;
  let jx = 0, jy = 0; // mean-reverting jitter offset
  let anchor: [number, number] | null = null;
  const push = (v: number, hr: number | undefined, still: boolean) => {
    if (still) {
      jx = 0.9 * jx + gauss() * jitter;
      jy = 0.9 * jy + gauss() * jitter;
    }
    const [px, py] = still && anchor ? [anchor[0] + jx, anchor[1] + jy] : [x + gauss() * 0.3, y + gauss() * 0.3];
    c.t.push(t);
    c.lat.push(positions ? LAT0 + py / M_PER_DEG_LAT : null);
    c.lng.push(positions ? LNG0 + px / M_PER_DEG_LNG : null);
    c.ele.push(Math.round(ele * 10) / 10);
    c.hr.push(hr === undefined ? null : Math.round(hr + gauss() * 2));
    c.cadence.push(null);
    c.watts.push(null);
    c.speed.push(fit ? Math.max(0, v + (v > 0 ? gauss() * 0.1 : 0)) : null);
    c.dist.push(dist);
  };
  push(0, segments[0]?.hr, false);
  for (const seg of segments) {
    const startT = t;
    const startD = dist;
    for (let s = 0; s < seg.dur; s++) {
      const v = typeof seg.v === "number" ? seg.v : seg.v(s);
      heading += seg.turn ?? 0;
      const still = v === 0 || Boolean(seg.gpsStill);
      if (still && !anchor) anchor = [x, y];
      if (!still) {
        anchor = null;
        x += Math.cos(heading) * v;
        y += Math.sin(heading) * v;
      }
      dist += v;
      ele += (seg.grade ?? 0) * v;
      t++;
      push(v, seg.hr, still);
    }
    if (seg.mark) marks[seg.mark] = { fromS: startT, toS: t, distM: dist - startD };
  }
  if (!fit) {
    // gpx: the distance channel is haversine over the noisy positions
    let cum = 0;
    for (let i = 0; i < c.t.length; i++) {
      if (i > 0 && positions) {
        const dy = (c.lat[i]! - c.lat[i - 1]!) * M_PER_DEG_LAT;
        const dx = (c.lng[i]! - c.lng[i - 1]!) * M_PER_DEG_LNG;
        cum += Math.hypot(dx, dy);
      }
      c.dist[i] = cum;
    }
  }
  return {
    track: {
      format: "canonical-track",
      v: 1,
      source: { kind: "device-file", sha256: "0".repeat(64), detailSha256: null, fileType: opts.fileType },
      sportType: opts.sportType,
      startEpochMs: Date.UTC(2026, 5, 1, 6, 0, 0),
      utcOffsetMin: 120,
      hasLocalTime: true,
      syntheticTime: false,
      session: null,
      kilojoules: null,
      suggestedName: "fixture",
      columns: c,
    },
    marks,
  };
}

const ramp = (from: number, to: number, dur: number) => (s: number) => from + ((to - from) * (s + 1)) / dur;

// 45 min of running at ~3 m/s with a 15 min car ride (15 m/s, two traffic dips) in the middle
export function carRideRun(opts: Partial<BuildOpts> = {}): Built {
  return buildTrack([
    { dur: 1350, v: 3, hr: 150, turn: 0.001 },
    { dur: 30, v: 0, hr: 120 },
    { dur: 20, v: ramp(0, 15, 20), hr: 100, mark: "carStart" },
    { dur: 300, v: 15, hr: 95, turn: 0.0005 },
    { dur: 20, v: 3, hr: 95 },
    { dur: 300, v: 15, hr: 95 },
    { dur: 20, v: 4, hr: 95 },
    { dur: 220, v: 15, hr: 95 },
    { dur: 20, v: ramp(15, 0, 20), hr: 95, mark: "carEnd" },
    { dur: 30, v: 0, hr: 100 },
    { dur: 1350, v: 3, hr: 150, turn: -0.001 },
  ], { sportType: "Run", fileType: "fit", seed: 11, ...opts });
}

// the car ride as one span: from the accel start to the decel end
export function carSpan(b: Built) {
  const from = b.marks.carStart.fromS;
  const to = b.marks.carEnd.toS;
  return { fromS: from, toS: to, distM: b.track.columns.dist[to] - b.track.columns.dist[from] };
}

// 50 min run, then the watch sits still (gps jitter) for 5 h 12 min
export function forgotToStop(): Built {
  return buildTrack([
    { dur: 3000, v: 3, hr: 152, turn: 0.002, mark: "run" },
    { dur: 5 * 3600 + 12 * 60, v: 0, hr: 68, mark: "tail" },
  ], { sportType: "Run", fileType: "gpx", seed: 22 });
}

// city run: 6 stoplight pauses of 30-90 s, 5 min apart
export const STOPLIGHTS = [30, 45, 70, 80, 90, 40];
export function cityRun(): Built {
  const segs: Segment[] = [{ dur: 300, v: 3.1, hr: 150 }];
  STOPLIGHTS.forEach((d, i) => {
    segs.push({ dur: d, v: 0, hr: 120, mark: `stop${i}` });
    segs.push({ dur: 300, v: 3.1, hr: 150, turn: i % 2 ? 0.003 : -0.003 });
  });
  return buildTrack(segs, { sportType: "Run", fileType: "fit", seed: 33 });
}

// 30 min gpx run with 3 isolated ~2 km gps spikes
export const SPIKE_TS = [300, 900, 1500];
export function spikyRun(): Built {
  const b = buildTrack([{ dur: 1800, v: 3, hr: 150, turn: 0.001 }], { sportType: "Run", fileType: "gpx", seed: 44 });
  const c = b.track.columns;
  for (const ts of SPIKE_TS) {
    c.lat[ts] = c.lat[ts]! + 2000 / M_PER_DEG_LAT * 0.8;
    c.lng[ts] = c.lng[ts]! + 2000 / M_PER_DEG_LNG * 0.6;
  }
  // gpx distance channel includes the spikes
  let cum = 0;
  for (let i = 0; i < c.t.length; i++) {
    if (i > 0) {
      const dy = (c.lat[i]! - c.lat[i - 1]!) * M_PER_DEG_LAT;
      const dx = (c.lng[i]! - c.lng[i - 1]!) * M_PER_DEG_LNG;
      cum += Math.hypot(dx, dy);
    }
    c.dist[i] = cum;
  }
  return b;
}

// 40 min treadmill: footpod speed/distance, gps jittering around one spot
export function treadmill(sportType = "Run"): Built {
  return buildTrack([{ dur: 2400, v: (s) => (s < 120 ? 2.5 : 3.2), hr: 145, gpsStill: true }], {
    sportType, fileType: "fit", seed: 55, jitterM: 1,
  });
}

// ride with a genuine 3 min 25 m/s descent (−8 %)
export function downhillRide(): Built {
  return buildTrack([
    { dur: 1200, v: 6, hr: 150, grade: 0.05, turn: 0.002 },
    { dur: 15, v: ramp(6, 25, 15), hr: 130, grade: -0.08 },
    { dur: 180, v: 25, hr: 125, grade: -0.08, turn: -0.003, mark: "descent" },
    { dur: 15, v: ramp(25, 8, 15), hr: 125, grade: -0.08 },
    { dur: 1200, v: 8, hr: 145, turn: 0.001 },
  ], { sportType: "Ride", fileType: "fit", seed: 66 });
}

// ride with a flat 10 min stretch at 25 m/s (a car, not gravity)
export function flatVehicleRide(): Built {
  return buildTrack([
    { dur: 1200, v: 8, hr: 150 },
    { dur: 60, v: 0, hr: 110 },
    { dur: 600, v: 25, hr: 95, mark: "car" },
    { dur: 60, v: 0, hr: 100 },
    { dur: 1200, v: 8, hr: 145 },
  ], { sportType: "Ride", fileType: "fit", seed: 77 });
}

// 12 min standing around before a 40 min run
export function lateStart(): Built {
  return buildTrack([
    { dur: 720, v: 0, hr: 80, mark: "wait" },
    { dur: 2400, v: 3, hr: 150, turn: 0.002, mark: "run" },
  ], { sportType: "Run", fileType: "fit", seed: 88 });
}

// clean 42 min run with one 2 min stop in the middle
export function cleanRun(): Built {
  return buildTrack([
    { dur: 1200, v: (s) => 3 + 0.2 * Math.sin(s / 60), hr: 150, turn: 0.002 },
    { dur: 120, v: 0, hr: 115, mark: "stop" },
    { dur: 1200, v: (s) => 3.1 + 0.2 * Math.sin(s / 45), hr: 155, turn: -0.002 },
  ], { sportType: "Run", fileType: "fit", seed: 99 });
}
