// converts the vendored react-native-body-highlighter art into lift-core's
// BODY_FIGURES data and rewrites the generated block in src/body.ts.
//
//   node packages/lift-core/vendor/body-map/build-body-map.mjs
//
// the upstream files are read as text (never executed): every path string is
// pulled out with a regex, normalized to absolute M/L/C/Q/Z, moved so the back
// view shares the front's coordinates, scaled down and cropped to the figure.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, "react-native-body-highlighter");
const BODY_TS = join(HERE, "..", "..", "src", "body.ts");

// 1448-unit tall art -> ~320 units: one decimal keeps sub-pixel precision at
// any size we render, and short numbers keep the bundle small
const SCALE = 0.25;
const PAD = 2;
// the back view is drawn at x 724..1448 upstream
const BACK_OFFSET_X = 724;

// ---------------------------------------------------------------------------
// upstream text -> raw parts

function readParts(file) {
  const txt = readFileSync(join(SRC, file), "utf8");
  const heads = [...txt.matchAll(/slug:\s*"([\w-]+)"/g)];
  const parts = [];
  heads.forEach((m, i) => {
    const chunk = txt.slice(m.index, heads[i + 1]?.index ?? txt.length);
    for (const side of ["common", "left", "right"]) {
      const list = chunk.match(new RegExp(`${side}:\\s*\\[([\\s\\S]*?)\\]`));
      if (!list) continue;
      let n = 0;
      for (const s of list[1].matchAll(/"([^"]+)"/g)) parts.push({ slug: m[1], side, n: n++, d: s[1] });
    }
  });
  return parts;
}

function readOutline(view) {
  const txt = readFileSync(join(SRC, "SvgMaleWrapper.js.txt"), "utf8");
  const m = txt.match(new RegExp(`side === "${view}" && \\(<[^>]*? d="([^"]+)"`));
  if (!m) throw new Error(`no ${view} outline in SvgMaleWrapper`);
  return m[1];
}

// ---------------------------------------------------------------------------
// which of our regions each upstream part stands for

const COMMON = {
  chest: ["chest"],
  biceps: ["biceps"],
  triceps: ["triceps"],
  forearm: ["forearms"],
  trapezius: ["traps"],
  neck: ["neck"],
  abs: ["abs"],
  obliques: ["obliques"],
  quadriceps: ["quads"],
  adductors: ["adductors"],
  calves: ["calves"],
  hamstring: ["hamstrings"],
};

function regionsFor(view, { slug, n }) {
  // one deltoid shape per view: the front shows the front + side heads, the back the rear + side
  if (slug === "deltoids") return view === "front" ? ["front_delts", "side_delts"] : ["rear_delts", "side_delts"];
  // upper-back is three shapes a side: 1 is the lat sweep, 0 and 2 the teres/infraspinatus block
  if (slug === "upper-back") return n === 1 ? ["lats"] : ["upper_back"];
  // lower-back: 1 is the erectors, 0 the oblique edge seen from behind
  if (slug === "lower-back") return n === 1 ? ["lower_back"] : ["obliques"];
  // gluteal: 0 is glute medius (the abductor), 1 glute max
  if (slug === "gluteal") return n === 0 ? ["abductors"] : ["glutes"];
  // tibialis, knees, hands, feet, ankles, head, hair: drawn, never shaded
  return COMMON[slug] ?? [];
}

// ---------------------------------------------------------------------------
// svg path normalizer: any path -> absolute M/L/C/Q/Z

function tokenize(d) {
  const out = [];
  const re = /([MmLlHhVvCcSsQqTtAaZz])|([-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?)|([\s,]+)/y;
  let m;
  while (re.lastIndex < d.length && (m = re.exec(d))) {
    if (m[1]) out.push(m[1]);
    else if (m[2]) out.push(m[2]);
  }
  if (re.lastIndex < d.length) throw new Error(`bad path data at ${re.lastIndex}: ${d.slice(re.lastIndex, re.lastIndex + 20)}`);
  return out;
}

// arc flags may be packed ("012.89" = 0, 1, 2.89), so split them off by hand
function unpackArcFlags(tokens) {
  const out = [];
  let cmd = "";
  let argi = 0;
  for (const t of tokens) {
    if (/^[A-Za-z]$/.test(t)) {
      cmd = t;
      argi = 0;
      out.push(t);
      continue;
    }
    if (cmd === "a" || cmd === "A") {
      let rest = t;
      while (rest.length) {
        const slot = argi % 7;
        // a flag is always exactly one digit
        if ((slot === 3 || slot === 4) && /^[01]/.test(rest)) {
          out.push(rest[0]);
          rest = rest.slice(1);
        } else {
          out.push(rest);
          rest = "";
        }
        argi++;
      }
    } else out.push(t);
  }
  return out;
}

function arcToCubics(x1, y1, rx, ry, phi, fa, fs, x2, y2) {
  if (rx === 0 || ry === 0) return [[x1, y1, x2, y2, x2, y2]];
  const sin = Math.sin((phi * Math.PI) / 180);
  const cos = Math.cos((phi * Math.PI) / 180);
  const dx = (x1 - x2) / 2;
  const dy = (y1 - y2) / 2;
  const x1p = cos * dx + sin * dy;
  const y1p = -sin * dx + cos * dy;
  rx = Math.abs(rx);
  ry = Math.abs(ry);
  const lam = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lam > 1) {
    rx *= Math.sqrt(lam);
    ry *= Math.sqrt(lam);
  }
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  let co = Math.sqrt(Math.max(0, num / den));
  if (fa === fs) co = -co;
  const cxp = (co * rx * y1p) / ry;
  const cyp = (-co * ry * x1p) / rx;
  const cx = cos * cxp - sin * cyp + (x1 + x2) / 2;
  const cy = sin * cxp + cos * cyp + (y1 + y2) / 2;
  const ang = (ux, uy, vx, vy) => {
    const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    return a;
  };
  const t1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dt = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!fs && dt > 0) dt -= 2 * Math.PI;
  if (fs && dt < 0) dt += 2 * Math.PI;
  const segs = Math.max(1, Math.ceil(Math.abs(dt) / (Math.PI / 2)));
  const step = dt / segs;
  const k = (4 / 3) * Math.tan(step / 4);
  const out = [];
  let a = t1;
  const pt = (t) => [cx + rx * Math.cos(t) * cos - ry * Math.sin(t) * sin, cy + rx * Math.cos(t) * sin + ry * Math.sin(t) * cos];
  const dpt = (t) => [-rx * Math.sin(t) * cos - ry * Math.cos(t) * sin, -rx * Math.sin(t) * sin + ry * Math.cos(t) * cos];
  for (let i = 0; i < segs; i++) {
    const b = a + step;
    const [ax, ay] = pt(a);
    const [bx, by] = pt(b);
    const [dax, day] = dpt(a);
    const [dbx, dby] = dpt(b);
    out.push([ax + k * dax, ay + k * day, bx - k * dbx, by - k * dby, bx, by]);
    a = b;
  }
  // land exactly on the endpoint
  const last = out[out.length - 1];
  last[4] = x2;
  last[5] = y2;
  return out;
}

/** absolute segments: {c: "M"|"L"|"C"|"Q"|"Z", p: number[]} */
function normalize(d) {
  const tk = unpackArcFlags(tokenize(d));
  const segs = [];
  let i = 0;
  let cmd = "";
  let x = 0;
  let y = 0;
  let sx = 0;
  let sy = 0;
  let lastC = null; // reflected control for S
  let lastQ = null; // reflected control for T
  const n = () => {
    const v = Number(tk[i++]);
    if (!Number.isFinite(v)) throw new Error(`bad number near token ${i} of ${d.slice(0, 40)}`);
    return v;
  };
  while (i < tk.length) {
    if (/^[A-Za-z]$/.test(tk[i])) cmd = tk[i++];
    else if (!cmd) throw new Error("path must start with a command");
    const rel = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();
    const ox = rel ? x : 0;
    const oy = rel ? y : 0;
    let nextC = null;
    let nextQ = null;
    if (C === "M") {
      x = ox + n();
      y = oy + n();
      sx = x;
      sy = y;
      segs.push({ c: "M", p: [x, y] });
      cmd = rel ? "l" : "L"; // extra pairs after M are line-tos
    } else if (C === "L") {
      x = ox + n();
      y = oy + n();
      segs.push({ c: "L", p: [x, y] });
    } else if (C === "H") {
      x = ox + n();
      segs.push({ c: "L", p: [x, y] });
    } else if (C === "V") {
      y = (rel ? y : 0) + n();
      segs.push({ c: "L", p: [x, y] });
    } else if (C === "C") {
      const p = [ox + n(), oy + n(), ox + n(), oy + n(), ox + n(), oy + n()];
      segs.push({ c: "C", p });
      nextC = [p[2], p[3]];
      [x, y] = [p[4], p[5]];
    } else if (C === "S") {
      const c1 = lastC ? [2 * x - lastC[0], 2 * y - lastC[1]] : [x, y];
      const p = [c1[0], c1[1], ox + n(), oy + n(), ox + n(), oy + n()];
      segs.push({ c: "C", p });
      nextC = [p[2], p[3]];
      [x, y] = [p[4], p[5]];
    } else if (C === "Q") {
      const p = [ox + n(), oy + n(), ox + n(), oy + n()];
      segs.push({ c: "Q", p });
      nextQ = [p[0], p[1]];
      [x, y] = [p[2], p[3]];
    } else if (C === "T") {
      const c1 = lastQ ? [2 * x - lastQ[0], 2 * y - lastQ[1]] : [x, y];
      const p = [c1[0], c1[1], ox + n(), oy + n()];
      segs.push({ c: "Q", p });
      nextQ = c1;
      [x, y] = [p[2], p[3]];
    } else if (C === "A") {
      const rx = n();
      const ry = n();
      const phi = n();
      const fa = n();
      const fs = n();
      const x2 = ox + n();
      const y2 = oy + n();
      for (const p of arcToCubics(x, y, rx, ry, phi, fa, fs, x2, y2)) segs.push({ c: "C", p });
      [x, y] = [x2, y2];
    } else if (C === "Z") {
      segs.push({ c: "Z", p: [] });
      x = sx;
      y = sy;
    } else throw new Error(`unsupported command ${cmd}`);
    lastC = nextC;
    lastQ = nextQ;
  }
  return segs;
}

function closed(segs) {
  return segs[segs.length - 1]?.c === "Z" ? segs : [...segs, { c: "Z", p: [] }];
}

// ---------------------------------------------------------------------------
// build both views

const views = {
  front: { parts: readParts("bodyFront.js.txt"), outline: readOutline("front"), dx: 0 },
  back: { parts: readParts("bodyBack.js.txt"), outline: readOutline("back"), dx: -BACK_OFFSET_X },
};

const shift = (segs, dx) => segs.map((s) => ({ c: s.c, p: s.p.map((v, j) => (j % 2 === 0 ? v + dx : v)) }));

function center(segs) {
  const xs = segs.flatMap((s) => s.p.filter((_, j) => j % 2 === 0));
  const ys = segs.flatMap((s) => s.p.filter((_, j) => j % 2 === 1));
  return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
}

// upstream lists right-side parts in a different order than the left, so a
// right part takes the index of the left part it mirrors (by bbox center)
function matchSides(parts, axis) {
  for (const p of parts) p.c = center(normalize(p.d));
  for (const p of parts) {
    if (p.side !== "right") continue;
    const lefts = parts.filter((q) => q.slug === p.slug && q.side === "left");
    if (lefts.length === 0) continue;
    const dist = (q) => Math.hypot(2 * axis - q.c[0] - p.c[0], q.c[1] - p.c[1]);
    p.n = lefts.reduce((a, b) => (dist(b) < dist(a) ? b : a)).n;
  }
}

for (const [name, v] of Object.entries(views)) {
  // the figure's center line: x 362 on the front, 724 + 362 on the back
  matchSides(v.parts, 362 - v.dx);
  v.shapes = v.parts.map((p) => ({ regions: regionsFor(name, p), segs: shift(closed(normalize(p.d)), v.dx) }));
  // the upstream outline is open across the top of the head (the hair/head
  // shapes cover it); close it over the crown so it fills as one silhouette
  const out = shift(normalize(v.outline), v.dx);
  const head = v.parts.filter((p) => p.slug === "head" || p.slug === "hair").flatMap((p) => shift(normalize(p.d), v.dx));
  const hx = head.flatMap((s) => s.p.filter((_, j) => j % 2 === 0));
  const hy = head.flatMap((s) => s.p.filter((_, j) => j % 2 === 1));
  const [minX, maxX, top] = [Math.min(...hx), Math.max(...hx), Math.min(...hy)];
  const start = out[0].p;
  const end = out[out.length - 1].p.slice(-2);
  const cx = (minX + maxX) / 2;
  out.push({ c: "C", p: [maxX, end[1] - (end[1] - top) * 0.6, cx + (maxX - cx) * 0.55, top, cx, top] });
  out.push({ c: "C", p: [cx - (cx - minX) * 0.55, top, minX, start[1] - (start[1] - top) * 0.6, start[0], start[1]] });
  out.push({ c: "Z", p: [] });
  v.outlineSegs = out;
}

// crop: one shared box for both views so they line up side by side
const all = Object.values(views).flatMap((v) => [...v.outlineSegs, ...v.shapes.flatMap((s) => s.segs)]);
const xs = all.flatMap((s) => s.p.filter((_, j) => j % 2 === 0));
const ys = all.flatMap((s) => s.p.filter((_, j) => j % 2 === 1));
const ox = Math.min(...xs) - PAD / SCALE;
const oy = Math.min(...ys) - PAD / SCALE;
const W = Math.ceil((Math.max(...xs) - ox) * SCALE + PAD);
const H = Math.ceil((Math.max(...ys) - oy) * SCALE + PAD);

const num = (v) => {
  const r = Math.round(v * 10) / 10;
  return Object.is(r, -0) ? "0" : String(r);
};
// below a few tenths of a unit (~0.3px at our largest size) detail is invisible:
// near-straight curves become lines and specks get dropped, which halves the data
const TOL = 0.25;
function distToChord([px, py], [ax, ay], [bx, by]) {
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.hypot(dx, dy);
  if (len === 0) return Math.hypot(px - ax, py - ay);
  return Math.abs((px - ax) * dy - (py - ay) * dx) / len;
}
function fmt(segs) {
  const out = [];
  let cur = [0, 0];
  const pts = (s) => {
    const p = [];
    for (let j = 0; j < s.p.length; j += 2) p.push([(s.p[j] - ox) * SCALE, (s.p[j + 1] - oy) * SCALE]);
    return p;
  };
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    const p = pts(s);
    if (s.c === "Z") {
      out.push("Z");
      continue;
    }
    if (s.c === "M") {
      out.push(`M ${num(p[0][0])} ${num(p[0][1])}`);
      cur = p[0];
      continue;
    }
    const end = p[p.length - 1];
    const ctrl = p.slice(0, -1);
    const closesNext = segs[i + 1]?.c === "Z";
    // a speck: everything within TOL of where we already are
    if (!closesNext && [...ctrl, end].every((q) => Math.hypot(q[0] - cur[0], q[1] - cur[1]) < TOL)) continue;
    if (s.c === "L" || ctrl.every((q) => distToChord(q, cur, end) < TOL / 2)) out.push(`L ${num(end[0])} ${num(end[1])}`);
    else out.push([s.c, ...p.flatMap(([x, y]) => [num(x), num(y)])].join(" "));
    cur = end;
  }
  return out.join(" ");
}

// merge every part that lights up the same regions into one multi-subpath shape
function art(v) {
  const groups = new Map();
  for (const s of v.shapes) {
    const key = s.regions.join("+");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(fmt(s.segs));
  }
  // non-muscle parts first so muscles draw over them
  const keys = [...groups.keys()].sort((a, b) => (a === "" ? -1 : b === "" ? 1 : 0));
  return keys
    .map((k) => `  [${JSON.stringify(k ? k.split("+") : [])}, ${JSON.stringify(groups.get(k).join(" "))}],`)
    .join("\n");
}

const block = [
  "// @generated by vendor/body-map/build-body-map.mjs from react-native-body-highlighter 3.2.0 (mit). do not edit by hand.",
  `const VIEW_BOX = "0 0 ${W} ${H}";`,
  `const FRONT_OUTLINE = ${JSON.stringify(fmt(views.front.outlineSegs))};`,
  `const BACK_OUTLINE = ${JSON.stringify(fmt(views.back.outlineSegs))};`,
  `const FRONT_ART: readonly Art[] = [\n${art(views.front)}\n];`,
  `const BACK_ART: readonly Art[] = [\n${art(views.back)}\n];`,
  "// @generated end",
].join("\n");

const ts = readFileSync(BODY_TS, "utf8");
const re = /\/\/ @generated by[\s\S]*?\/\/ @generated end/;
if (!re.test(ts)) throw new Error("generated markers missing from src/body.ts");
writeFileSync(BODY_TS, ts.replace(re, () => block));
console.log(`body.ts: viewBox 0 0 ${W} ${H}, generated block ${block.length} chars`);
