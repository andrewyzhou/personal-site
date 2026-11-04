import type { MuscleRegion } from "./types";

// original body-figure art shared by the site (dom svg) and the phone
// (react-native-svg): plain path data, no renderer assumptions.

export type BodyView = "front" | "back";

export interface BodyShape {
  /** svg path data in the figure's viewBox */
  d: string;
  /** muscle region this shape lights up; null = outline/non-muscle (head, hands, joints) */
  region: MuscleRegion | null;
}

export interface BodyFigure {
  view: BodyView;
  /** "0 0 w h" */
  viewBox: string;
  /** silhouette drawn first, under the muscle shapes */
  outline: string;
  shapes: BodyShape[];
}

const WIDTH = 200;
const VIEW_BOX = `0 0 ${WIDTH} 420`;

// ---------------------------------------------------------------------------
// tiny path toolkit: absolute M/L/C/Q/Z only, which is all the art uses

type Cmd = "M" | "L" | "C" | "Q" | "Z";
type Pt = [number, number];
interface Seg {
  cmd: Cmd;
  pts: Pt[];
}

const ARITY: Record<Cmd, number> = { M: 1, L: 1, C: 3, Q: 2, Z: 0 };

function parsePath(d: string): Seg[] {
  const tokens = d.match(/[A-Za-z]|-?\d*\.?\d+(?:e[-+]?\d+)?/g) ?? [];
  const segs: Seg[] = [];
  let i = 0;
  while (i < tokens.length) {
    const cmd = tokens[i++] as Cmd;
    if (!(cmd in ARITY)) throw new Error(`unsupported path command: ${cmd}`);
    const pts: Pt[] = [];
    for (let p = 0; p < ARITY[cmd]; p++) {
      const x = Number(tokens[i++]);
      const y = Number(tokens[i++]);
      if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error(`bad path data near ${cmd}`);
      pts.push([x, y]);
    }
    segs.push({ cmd, pts });
  }
  return segs;
}

function num(n: number): string {
  return String(Math.round(n * 100) / 100);
}

function formatPath(segs: readonly Seg[]): string {
  return segs.map((s) => [s.cmd, ...s.pts.map(([x, y]) => `${num(x)} ${num(y)}`)].join(" ")).join(" ");
}

/** mirror path data across the figure's vertical center line (x' = 200 - x) */
export function mirrorPath(d: string): string {
  return formatPath(parsePath(d).map((s) => ({ cmd: s.cmd, pts: s.pts.map(([x, y]): Pt => [WIDTH - x, y]) })));
}

/** reverse an open M + L/C/Q path so it runs end -> start (minus the leading M) */
function reverseOpen(segs: readonly Seg[]): Seg[] {
  const ends = segs.map((s) => s.pts[s.pts.length - 1] as Pt);
  const out: Seg[] = [];
  for (let i = segs.length - 1; i >= 1; i--) {
    const s = segs[i] as Seg;
    const start = ends[i - 1] as Pt;
    if (s.cmd === "C") out.push({ cmd: "C", pts: [s.pts[1] as Pt, s.pts[0] as Pt, start] });
    else if (s.cmd === "Q") out.push({ cmd: "Q", pts: [s.pts[0] as Pt, start] });
    else out.push({ cmd: "L", pts: [start] });
  }
  return out;
}

// ---------------------------------------------------------------------------
// the art. everything is drawn on the viewer's left (x < 100) and mirrored.

// one contour from the crown, down the left side (head, neck, arm, hand,
// torso, leg, foot) to the crotch on the center line.
const OUTLINE_LEFT = [
  "M 100 8",
  "C 88 8 80 17 80 31", // skull
  "C 80 42 84 51 90 56", // jaw
  "C 90 60 89 66 88 68", // neck
  "C 80 72 66 74 58 78", // trap slope
  "C 50 82 46 92 46 104", // shoulder cap
  "C 45 120 41 140 40 158", // upper arm, outer
  "C 38 178 32 204 29 226", // forearm, outer
  "C 26 236 22 248 24 260", // hand, thumb side
  "C 26 268 34 268 36 260", // fingertips
  "C 37 252 38 240 39 230", // hand, inner
  "C 44 206 52 184 54 164", // forearm, inner
  "C 57 146 60 128 62 112", // upper arm, inner
  "C 63 113 64 115 64 118", // armpit
  "C 65 130 68 150 72 172", // ribs to waist
  "C 70 186 66 198 66 214", // hip
  "C 66 240 70 270 72 296", // thigh, outer
  "C 72 306 70 318 70 330", // knee, outer
  "C 70 350 76 370 78 384", // calf, outer
  "C 76 392 72 398 72 404", // heel
  "C 72 411 86 412 91 407", // sole and toes
  "C 92 398 92 390 91 382", // ankle, inner
  "C 93 362 94 344 92 326", // calf, inner
  "C 90 314 91 304 92 296", // knee, inner
  "C 94 270 97 248 100 228", // thigh, inner
].join(" ");

function buildOutline(left: string): string {
  const right = reverseOpen(parsePath(mirrorPath(left)));
  return `${formatPath(parsePath(left))} ${formatPath(right)} Z`;
}

type Art = [MuscleRegion | null, string];

// shapes on both views
const SIDE_DELT: Art = ["side_delts", "M 59 82 C 53 86 50 93 50 104 C 52 106 54 104 55 100 C 55 92 57 86 62 82 Z"];
const FOREARM: Art = [
  "forearms",
  "M 44 162 C 41 176 37 196 34 214 C 34 220 37 222 39 218 C 43 202 48 184 50 166 C 49 160 46 158 44 162 Z",
];

const FRONT_LEFT: Art[] = [
  ["traps", "M 89 68 C 82 72 74 75 66 78 C 74 79 83 77 91 73 Z"],
  SIDE_DELT,
  ["front_delts", "M 64 82 C 59 86 57 92 57 100 C 59 106 62 108 65 106 C 67 100 67 93 68 89 C 67 85 66 82 64 82 Z"],
  ["chest", "M 98 86 C 88 84 77 85 70 90 C 66 98 67 110 72 116 C 80 121 92 122 98 118 Z"],
  ["biceps", "M 52 112 C 48 120 47 134 47 148 C 49 154 53 154 55 148 C 57 136 59 124 58 114 C 56 110 54 110 52 112 Z"],
  FOREARM,
  ["abs", "M 98 125 C 92 125 87 127 85 131 C 84 147 84 167 87 186 C 90 195 95 200 98 202 Z"],
  ["obliques", "M 80 128 C 75 132 71 138 70 146 C 71 160 73 176 75 190 C 78 196 81 198 83 196 C 81 180 80 160 81 140 Z"],
  ["abductors", "M 71 204 C 69 212 69 222 70 230 C 72 226 75 218 76 210 C 75 206 73 203 71 204 Z"],
  ["quads", "M 74 232 C 70 248 71 268 76 288 C 79 294 85 294 88 288 C 88 270 87 250 84 236 C 82 230 77 228 74 232 Z"],
  ["adductors", "M 88 230 C 92 231 96 233 98 235 C 97 249 94 262 91 274 C 90 260 89 246 87 234 Z"],
  [null, "M 82 296 C 86 296 88 300 88 304 C 88 309 85 312 82 312 C 79 312 76 309 76 304 C 76 300 78 296 82 296 Z"], // kneecap
  ["calves", "M 74 316 C 71 328 72 344 76 356 C 79 346 80 330 78 318 Z"],
  ["calves", "M 86 316 C 91 324 91 342 89 358 C 86 350 84 336 84 324 Z"],
];

const FRONT_CENTER: Art[] = [["neck", "M 92 60 C 96 63 104 63 108 60 L 109 66 C 104 69 96 69 91 66 Z"]];

const BACK_LEFT: Art[] = [
  ["traps", "M 99 60 C 96 66 92 70 88 70 C 80 73 72 76 66 79 C 74 84 84 92 92 112 C 95 122 97 132 99 138 Z"],
  SIDE_DELT,
  ["rear_delts", "M 63 82 C 58 86 56 93 57 101 C 60 104 63 102 66 98 C 67 92 67 88 65 84 Z"],
  ["upper_back", "M 70 96 C 74 97 79 100 83 106 C 81 114 76 118 71 117 C 69 112 69 104 70 96 Z"],
  ["triceps", "M 50 110 C 47 120 46 134 47 148 C 49 154 54 154 56 148 C 58 134 60 122 60 114 C 57 108 53 108 50 110 Z"],
  FOREARM,
  ["lats", "M 67 120 C 74 122 82 122 90 120 C 94 128 96 140 96 152 C 92 162 86 170 78 178 C 74 166 70 148 67 120 Z"],
  ["lower_back", "M 99 154 C 95 160 92 170 91 182 C 91 192 93 198 96 204 L 99 204 Z"],
  ["abductors", "M 76 188 C 72 192 70 198 70 203 C 73 203 77 201 81 198 C 82 194 80 189 76 188 Z"],
  ["glutes", "M 98 208 C 90 204 80 205 74 210 C 70 220 70 234 76 242 C 84 248 92 245 96 237 C 98 232 99 228 99 222 Z"],
  ["hamstrings", "M 74 250 C 72 264 74 280 78 294 C 82 299 86 299 90 293 C 92 278 92 264 94 252 C 88 254 80 254 74 250 Z"],
  [
    "calves",
    "M 80 306 C 74 312 72 326 74 342 C 76 354 80 360 84 358 C 88 360 91 352 91 340 C 92 326 90 312 84 306 C 83 304 81 304 80 306 Z",
  ],
];

function buildShapes(left: readonly Art[], center: readonly Art[]): BodyShape[] {
  const shapes: BodyShape[] = [];
  for (const [region, d] of left) {
    shapes.push({ d: formatPath(parsePath(d)), region });
    shapes.push({ d: mirrorPath(d), region });
  }
  for (const [region, d] of center) shapes.push({ d: formatPath(parsePath(d)), region });
  return shapes;
}

const OUTLINE = buildOutline(OUTLINE_LEFT);

export const BODY_FIGURES: Record<BodyView, BodyFigure> = {
  front: { view: "front", viewBox: VIEW_BOX, outline: OUTLINE, shapes: buildShapes(FRONT_LEFT, FRONT_CENTER) },
  back: { view: "back", viewBox: VIEW_BOX, outline: OUTLINE, shapes: buildShapes(BACK_LEFT, []) },
};

const VIEWS: readonly BodyView[] = ["front", "back"];

/** which views show a region (e.g. lats: back; chest: front; delts: both) */
export function viewsForRegion(region: MuscleRegion): BodyView[] {
  return VIEWS.filter((v) => BODY_FIGURES[v].shapes.some((s) => s.region === region));
}

/**
 * map a normalized load (0..1) to a discrete intensity step 0..steps, so the
 * site and the phone shade the same way. 0 only for no load at all.
 */
export function loadIntensity(load: number | undefined, steps = 4): number {
  const n = Number.isFinite(steps) ? Math.max(1, Math.floor(steps)) : 4;
  if (load === undefined || !(load > 0)) return 0;
  // any load at all shows at least the faintest step
  return Math.min(n, Math.max(1, Math.ceil(load * n)));
}
