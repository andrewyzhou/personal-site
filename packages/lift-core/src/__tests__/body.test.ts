import { describe, expect, it } from "vitest";
import { BODY_FIGURES, loadIntensity, shapeLoad, shapeRegions, viewsForRegion, type BodyView } from "../body";
import { MUSCLE_REGIONS } from "../muscles";

type Pt = [number, number];

// independent of the generator on purpose: strict tokens, absolute M/L/C/Q/Z only
function parse(d: string): { cmd: string; pts: Pt[] }[] {
  const tokens = d.trim().split(/[\s,]+/);
  const arity: Record<string, number> = { M: 1, L: 1, C: 3, Q: 2, Z: 0 };
  const out: { cmd: string; pts: Pt[] }[] = [];
  let i = 0;
  while (i < tokens.length) {
    const cmd = tokens[i++] as string;
    if (!(cmd in arity)) throw new Error(`bad command ${cmd} in ${d.slice(0, 60)}`);
    const pts: Pt[] = [];
    for (let p = 0; p < (arity[cmd] as number); p++) {
      const x = tokens[i++];
      const y = tokens[i++];
      if (!x || !y || !/^-?\d+(\.\d+)?$/.test(x) || !/^-?\d+(\.\d+)?$/.test(y)) throw new Error(`bad number in ${d.slice(0, 60)}`);
      pts.push([Number(x), Number(y)]);
    }
    out.push({ cmd, pts });
  }
  if (out[0]?.cmd !== "M") throw new Error(`path must start with M: ${d.slice(0, 60)}`);
  return out;
}

/** flatten curves into one point list per subpath */
function polygons(d: string, steps = 8): Pt[][] {
  const polys: Pt[][] = [];
  let poly: Pt[] = [];
  let cur: Pt = [0, 0];
  for (const { cmd, pts } of parse(d)) {
    if (cmd === "M") {
      if (poly.length) polys.push(poly);
      cur = pts[0] as Pt;
      poly = [cur];
    } else if (cmd === "L") {
      cur = pts[0] as Pt;
      poly.push(cur);
    } else if (cmd === "C" || cmd === "Q") {
      const p0 = cur;
      for (let s = 1; s <= steps; s++) {
        const t = s / steps;
        const u = 1 - t;
        if (cmd === "C") {
          const [a, b, c] = pts as [Pt, Pt, Pt];
          poly.push([
            u ** 3 * p0[0] + 3 * u * u * t * a[0] + 3 * u * t * t * b[0] + t ** 3 * c[0],
            u ** 3 * p0[1] + 3 * u * u * t * a[1] + 3 * u * t * t * b[1] + t ** 3 * c[1],
          ]);
        } else {
          const [a, c] = pts as [Pt, Pt];
          poly.push([u * u * p0[0] + 2 * u * t * a[0] + t * t * c[0], u * u * p0[1] + 2 * u * t * a[1] + t * t * c[1]]);
        }
      }
      cur = pts[pts.length - 1] as Pt;
    }
  }
  if (poly.length) polys.push(poly);
  return polys;
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

const VIEWS: BodyView[] = ["front", "back"];

describe("body figures", () => {
  it("both views share one viewBox", () => {
    expect(BODY_FIGURES.front.viewBox).toMatch(/^0 0 \d+ \d+$/);
    expect(BODY_FIGURES.back.viewBox).toBe(BODY_FIGURES.front.viewBox);
  });

  it("every path parses, closes, and stays inside the viewBox", () => {
    for (const v of VIEWS) {
      const fig = BODY_FIGURES[v];
      const [, , w, h] = fig.viewBox.split(" ").map(Number) as [number, number, number, number];
      for (const d of [fig.outline, ...fig.shapes.map((s) => s.d)]) {
        expect(d.length).toBeGreaterThan(0);
        for (const { pts } of parse(d)) {
          for (const [x, y] of pts) {
            expect(x).toBeGreaterThanOrEqual(0);
            expect(x).toBeLessThanOrEqual(w);
            expect(y).toBeGreaterThanOrEqual(0);
            expect(y).toBeLessThanOrEqual(h);
          }
        }
        // every subpath is closed so fills never leak
        for (const sub of d.split(/(?=M )/)) expect(sub.trim().endsWith("Z"), `${v} ${sub.slice(0, 40)}`).toBe(true);
      }
    }
  });

  it("outline is one silhouette per view", () => {
    for (const v of VIEWS) expect(BODY_FIGURES[v].outline.match(/M/g)).toHaveLength(1);
  });

  it("shapes sit on the silhouette", () => {
    for (const v of VIEWS) {
      const [outline] = polygons(BODY_FIGURES[v].outline, 16) as [Pt[]];
      for (const s of BODY_FIGURES[v].shapes) {
        const pts = polygons(s.d).flat();
        // the art's edges hug the silhouette, so allow a few points to sit on or just past it
        const out = pts.filter((p) => !inside(p, outline)).length;
        expect(out / pts.length, `${v} ${s.region}`).toBeLessThan(0.1);
      }
    }
  });

  it("covers every muscle region on at least one view", () => {
    for (const region of MUSCLE_REGIONS) expect(viewsForRegion(region).length, region).toBeGreaterThan(0);
  });

  it("only names real regions, each once per view", () => {
    for (const v of VIEWS) {
      const seen = new Set<string>();
      for (const s of BODY_FIGURES[v].shapes) {
        const rs = shapeRegions(s);
        expect(s.region).toBe(rs[0] ?? null);
        for (const r of rs) {
          expect(MUSCLE_REGIONS).toContain(r);
          expect(seen.has(r), `${v} ${r} twice`).toBe(false);
          seen.add(r);
        }
      }
    }
  });

  it("puts regions on the expected views", () => {
    expect(viewsForRegion("chest")).toEqual(["front"]);
    expect(viewsForRegion("abs")).toEqual(["front"]);
    expect(viewsForRegion("quads")).toEqual(["front"]);
    expect(viewsForRegion("biceps")).toEqual(["front"]);
    expect(viewsForRegion("front_delts")).toEqual(["front"]);
    expect(viewsForRegion("lats")).toEqual(["back"]);
    expect(viewsForRegion("upper_back")).toEqual(["back"]);
    expect(viewsForRegion("lower_back")).toEqual(["back"]);
    expect(viewsForRegion("hamstrings")).toEqual(["back"]);
    expect(viewsForRegion("glutes")).toEqual(["back"]);
    expect(viewsForRegion("abductors")).toEqual(["back"]);
    expect(viewsForRegion("rear_delts")).toEqual(["back"]);
    expect(viewsForRegion("side_delts")).toEqual(["front", "back"]);
    expect(viewsForRegion("triceps")).toEqual(["front", "back"]);
    expect(viewsForRegion("traps")).toEqual(["front", "back"]);
    expect(viewsForRegion("forearms")).toEqual(["front", "back"]);
    expect(viewsForRegion("calves")).toEqual(["front", "back"]);
    expect(viewsForRegion("obliques")).toEqual(["front", "back"]);
    expect(viewsForRegion("adductors")).toEqual(["front", "back"]);
    expect(viewsForRegion("neck")).toEqual(["front", "back"]);
  });

  it("splits the deltoid by view", () => {
    const delt = (v: BodyView) => BODY_FIGURES[v].shapes.find((s) => shapeRegions(s).includes("side_delts"));
    expect(delt("front")?.regions).toEqual(["front_delts", "side_delts"]);
    expect(delt("back")?.regions).toEqual(["rear_delts", "side_delts"]);
    // back-compat: `region` still names the shape's first region
    expect(delt("front")?.region).toBe("front_delts");
  });

  it("keeps non-muscle parts unshaded", () => {
    for (const v of VIEWS) {
      const parts = BODY_FIGURES[v].shapes.filter((s) => s.region === null);
      expect(parts.length).toBeGreaterThan(0);
      for (const s of parts) expect(shapeRegions(s)).toEqual([]);
    }
  });

  it("keeps the path data small", () => {
    expect(JSON.stringify(BODY_FIGURES).length).toBeLessThan(60_000);
  });
});

describe("shapeLoad", () => {
  const delt = { d: "M 0 0 Z", region: "front_delts" as const, regions: ["front_delts" as const, "side_delts" as const] };

  it("takes the heaviest of a shape's regions", () => {
    expect(shapeLoad(delt, { side_delts: 0.4, front_delts: 0.9 })).toBe(0.9);
    expect(shapeLoad(delt, { side_delts: 0.4 })).toBe(0.4);
  });

  it("falls back to `region` and ignores junk", () => {
    expect(shapeLoad({ d: "M 0 0 Z", region: "chest" }, { chest: 0.5, lats: 1 })).toBe(0.5);
    expect(shapeLoad({ d: "M 0 0 Z", region: null }, { chest: 1 })).toBeUndefined();
    expect(shapeLoad(delt, { front_delts: Number.NaN })).toBeUndefined();
    expect(shapeLoad(delt, {})).toBeUndefined();
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
