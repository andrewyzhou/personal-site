import { describe, expect, it } from "vitest";
import { BODY_FIGURES, loadIntensity, mirrorPath, viewsForRegion, type BodyView } from "../body";
import { MUSCLE_REGIONS } from "../muscles";

type Pt = [number, number];

// independent of body.ts's own parser on purpose: strict tokens, absolute M/L/C/Q/Z only
function parse(d: string): { cmd: string; pts: Pt[] }[] {
  const tokens = d.trim().split(/[\s,]+/);
  const arity: Record<string, number> = { M: 1, L: 1, C: 3, Q: 2, Z: 0 };
  const out: { cmd: string; pts: Pt[] }[] = [];
  let i = 0;
  while (i < tokens.length) {
    const cmd = tokens[i++] as string;
    if (!(cmd in arity)) throw new Error(`bad command ${cmd} in ${d}`);
    const pts: Pt[] = [];
    for (let p = 0; p < (arity[cmd] as number); p++) {
      const x = tokens[i++];
      const y = tokens[i++];
      if (!x || !y || !/^-?\d+(\.\d+)?$/.test(x) || !/^-?\d+(\.\d+)?$/.test(y)) throw new Error(`bad number in ${d}`);
      pts.push([Number(x), Number(y)]);
    }
    out.push({ cmd, pts });
  }
  if (out[0]?.cmd !== "M") throw new Error(`path must start with M: ${d}`);
  return out;
}

/** flatten curves into a polygon (closed shapes only) */
function polygon(d: string, steps = 12): Pt[] {
  const poly: Pt[] = [];
  let cur: Pt = [0, 0];
  for (const { cmd, pts } of parse(d)) {
    if (cmd === "M" || cmd === "L") {
      cur = pts[0] as Pt;
      poly.push(cur);
    } else if (cmd === "C" || cmd === "Q") {
      const [p0, ctrl] = [cur, pts];
      for (let s = 1; s <= steps; s++) {
        const t = s / steps;
        const u = 1 - t;
        let x: number;
        let y: number;
        if (cmd === "C") {
          const [a, b, c] = ctrl as [Pt, Pt, Pt];
          x = u ** 3 * p0[0] + 3 * u * u * t * a[0] + 3 * u * t * t * b[0] + t ** 3 * c[0];
          y = u ** 3 * p0[1] + 3 * u * u * t * a[1] + 3 * u * t * t * b[1] + t ** 3 * c[1];
        } else {
          const [a, c] = ctrl as [Pt, Pt];
          x = u * u * p0[0] + 2 * u * t * a[0] + t * t * c[0];
          y = u * u * p0[1] + 2 * u * t * a[1] + t * t * c[1];
        }
        poly.push([x, y]);
      }
      cur = ctrl[ctrl.length - 1] as Pt;
    }
  }
  return poly;
}

function inside([x, y]: Pt, poly: Pt[]): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i] as Pt;
    const [xj, yj] = poly[j] as Pt;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

/** distance from a point to the polygon's edges */
function edgeDistance([x, y]: Pt, poly: Pt[]): number {
  let best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [x1, y1] = poly[j] as Pt;
    const [x2, y2] = poly[i] as Pt;
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = dx * dx + dy * dy;
    const t = len === 0 ? 0 : Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / len));
    best = Math.min(best, Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy)));
  }
  return best;
}

const VIEWS: BodyView[] = ["front", "back"];

describe("body figures", () => {
  it("every path parses and stays inside the 200x420 viewBox", () => {
    for (const v of VIEWS) {
      const fig = BODY_FIGURES[v];
      expect(fig.viewBox).toBe("0 0 200 420");
      for (const d of [fig.outline, ...fig.shapes.map((s) => s.d)]) {
        for (const { pts } of parse(d)) {
          for (const [x, y] of pts) {
            expect(x).toBeGreaterThanOrEqual(0);
            expect(x).toBeLessThanOrEqual(200);
            expect(y).toBeGreaterThanOrEqual(0);
            expect(y).toBeLessThanOrEqual(420);
          }
        }
        expect(d.trim().endsWith("Z")).toBe(true);
      }
    }
  });

  it("outline is a single symmetric contour", () => {
    const outline = BODY_FIGURES.front.outline;
    expect(outline.match(/M/g)).toHaveLength(1);
    const poly = polygon(outline);
    for (const [x, y] of poly) {
      // the mirror of every outline point is (near) the outline too
      expect(edgeDistance([200 - x, y], poly)).toBeLessThan(0.5);
    }
    expect(BODY_FIGURES.back.outline).toBe(outline);
  });

  it("covers every muscle region on at least one view", () => {
    for (const region of MUSCLE_REGIONS) expect(viewsForRegion(region).length, region).toBeGreaterThan(0);
  });

  it("puts regions on the expected views", () => {
    expect(viewsForRegion("chest")).toEqual(["front"]);
    expect(viewsForRegion("abs")).toEqual(["front"]);
    expect(viewsForRegion("quads")).toEqual(["front"]);
    expect(viewsForRegion("lats")).toEqual(["back"]);
    expect(viewsForRegion("hamstrings")).toEqual(["back"]);
    expect(viewsForRegion("glutes")).toEqual(["back"]);
    expect(viewsForRegion("rear_delts")).toEqual(["back"]);
    expect(viewsForRegion("side_delts")).toEqual(["front", "back"]);
    expect(viewsForRegion("traps")).toEqual(["front", "back"]);
    expect(viewsForRegion("forearms")).toEqual(["front", "back"]);
    expect(viewsForRegion("calves")).toEqual(["front", "back"]);
    expect(viewsForRegion("abductors")).toEqual(["front", "back"]);
  });

  it("bilateral shapes come in mirrored pairs", () => {
    for (const v of VIEWS) {
      const shapes = BODY_FIGURES[v].shapes;
      for (const s of shapes) {
        const xs = parse(s.d).flatMap(({ pts }) => pts.map(([x]) => x));
        const centered = Math.abs(Math.min(...xs) + Math.max(...xs) - 200) < 1e-9;
        if (centered) continue;
        const twin = shapes.find((o) => o !== s && o.region === s.region && o.d === mirrorPath(s.d));
        expect(twin, `${v} ${s.region} ${s.d}`).toBeDefined();
      }
    }
  });

  it("muscle shapes lie inside the silhouette", () => {
    for (const v of VIEWS) {
      const outline = polygon(BODY_FIGURES[v].outline, 24);
      for (const s of BODY_FIGURES[v].shapes) {
        for (const p of polygon(s.d)) expect(inside(p, outline), `${v} ${s.region} at ${p.join(",")}`).toBe(true);
      }
    }
  });

  it("shapes don't overlap each other", () => {
    for (const v of VIEWS) {
      const polys = BODY_FIGURES[v].shapes.map((s) => ({ region: s.region, poly: polygon(s.d) }));
      for (const a of polys) {
        for (const b of polys) {
          if (a === b) continue;
          for (const p of a.poly) {
            // touching edges are fine; real overlap means a point well inside another shape
            const deep = inside(p, b.poly) && edgeDistance(p, b.poly) > 0.75;
            expect(deep, `${v} ${a.region} into ${b.region} at ${p.join(",")}`).toBe(false);
          }
        }
      }
    }
  });

  it("keeps the path data small", () => {
    expect(JSON.stringify(BODY_FIGURES).length).toBeLessThan(25_000);
  });
});

describe("mirrorPath", () => {
  it("flips x around the center line and keeps y", () => {
    expect(mirrorPath("M 10 20 L 30 40 C 50 60 70 80 90 100 Q 1.5 2 3 4 Z")).toBe(
      "M 190 20 L 170 40 C 150 60 130 80 110 100 Q 198.5 2 197 4 Z",
    );
  });

  it("is its own inverse", () => {
    const d = "M 12 34 C 56 78 9 10 11 12 Z";
    expect(mirrorPath(mirrorPath(d))).toBe(d);
  });

  it("rejects relative or unsupported commands", () => {
    expect(() => mirrorPath("m 1 2 l 3 4")).toThrow();
    expect(() => mirrorPath("M 1 2 A 1 1 0 0 1 3 4")).toThrow();
  });
});

describe("loadIntensity", () => {
  it("is 0 only for no load", () => {
    expect(loadIntensity(undefined)).toBe(0);
    expect(loadIntensity(0)).toBe(0);
    expect(loadIntensity(-0.5)).toBe(0);
    expect(loadIntensity(Number.NaN)).toBe(0);
    expect(loadIntensity(0.0001)).toBe(1);
  });

  it("steps up in quarters by default", () => {
    expect(loadIntensity(0.25)).toBe(1);
    expect(loadIntensity(0.26)).toBe(2);
    expect(loadIntensity(0.5)).toBe(2);
    expect(loadIntensity(0.75)).toBe(3);
    expect(loadIntensity(0.76)).toBe(4);
    expect(loadIntensity(1)).toBe(4);
  });

  it("clamps above 1 and honors custom steps", () => {
    expect(loadIntensity(3)).toBe(4);
    expect(loadIntensity(Number.POSITIVE_INFINITY)).toBe(4);
    expect(loadIntensity(0.5, 10)).toBe(5);
    expect(loadIntensity(0.01, 10)).toBe(1);
    expect(loadIntensity(1, 1)).toBe(1);
    expect(loadIntensity(0.3, 1)).toBe(1);
  });
});
