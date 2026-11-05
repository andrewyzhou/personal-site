import { describe, expect, it } from "vitest";
import type { ReplayData, ReplaySegment } from "../replay/build";
import { encodeMultiPolyline } from "../polyline";
import {
  ROUTE_NO_DATA,
  ROUTE_PALETTE,
  ROUTE_SOLID,
  availableMetrics,
  buildReplayView,
  chartX,
  colorFor,
  downsampleIndices,
  formatMetric,
  gradeSeries,
  indexAtDistance,
  indexAtTime,
  linearScale,
  metricDomain,
  nearestIndex,
  nearestSorted,
  paletteAt,
  publishedEndpoints,
  routePieces,
  seriesArea,
  seriesExtent,
  seriesPath,
  speedMetricFor,
} from "../replay/metrics-view";
import {
  BUILDINGS_MINZOOM,
  OVERLAY,
  PALETTES,
  TERRAIN_EXAGGERATION,
  TERRARIUM_TILES,
  buildMapStyle,
  buildSky,
  oklchGray,
  themePaintUpdates,
} from "../../components/activity-map/style";

// a straight eastward line: ~11.1m per 1e-4 deg lng at the equator
function seg(t0: number, n: number, lng0: number, opts: { ele?: (i: number) => number | null; hr?: boolean; speed?: number } = {}): ReplaySegment {
  const s: ReplaySegment = { t: [], lat: [], lng: [], ele: opts.ele ? [] : null, hr: opts.hr ? [] : null, speed: [] };
  for (let i = 0; i < n; i++) {
    s.t.push(t0 + i * 4);
    s.lat.push(0);
    s.lng.push(lng0 + i * 1e-4);
    s.ele?.push(opts.ele!(i));
    s.hr?.push(opts.hr ? 120 + i : null);
    s.speed.push(opts.speed ?? 2.8 + (i % 5) * 0.1);
  }
  return s;
}

function replay(segments: ReplaySegment[]): ReplayData {
  const last = segments[segments.length - 1];
  return {
    v: 1,
    sportType: "Run",
    segments,
    gaps: segments.slice(1).map((_, i) => ({ after: i, kind: "fog" as const, durationS: 300 })),
    totalS: last.t[last.t.length - 1],
  };
}

describe("buildReplayView", () => {
  it("flattens segments with cumulative distance that does not jump gaps", () => {
    const r = replay([seg(0, 10, 0, { ele: () => 10 }), seg(400, 10, 0.01, { ele: () => 10 })]);
    const v = buildReplayView(r);
    expect(v.n).toBe(20);
    expect(v.segStart).toEqual([0, 10, 20]);
    expect(v.seg[9]).toBe(0);
    expect(v.seg[10]).toBe(1);
    // first segment ~100m, the gap (~1km) adds nothing
    expect(v.dist[9]).toBeGreaterThan(95);
    expect(v.dist[9]).toBeLessThan(105);
    expect(v.dist[10]).toBe(v.dist[9]);
    expect(v.totalDist).toBeLessThan(210);
    expect(v.hasEle).toBe(true);
    expect(v.hasHr).toBe(false);
  });
});

describe("metrics", () => {
  it("pace for foot sports, speed otherwise; hr/grade/elevation only when present", () => {
    expect(speedMetricFor("Run")).toBe("pace");
    expect(speedMetricFor("Ride")).toBe("speed");
    const bare = buildReplayView(replay([seg(0, 5, 0)]));
    expect(availableMetrics(bare, "Ride")).toEqual(["speed"]);
    const full = buildReplayView(replay([seg(0, 5, 0, { ele: () => 1, hr: true })]));
    expect(availableMetrics(full, "Run")).toEqual(["pace", "hr", "grade", "elevation"]);
  });

  it("grade from elevation over distance, within a segment", () => {
    // +1m per ~11.1m → ~9% grade
    const v = buildReplayView(replay([seg(0, 30, 0, { ele: (i) => i })]));
    const g = gradeSeries(v);
    const mid = g[15]!;
    expect(mid).toBeGreaterThan(8.5);
    expect(mid).toBeLessThan(9.5);
    const flat = gradeSeries(buildReplayView(replay([seg(0, 30, 0, { ele: () => 5 })])));
    expect(flat[15]).toBeCloseTo(0);
    expect(gradeSeries(buildReplayView(replay([seg(0, 30, 0)]))).every((x) => x === null)).toBe(true);
  });

  it("domains are robust; grade is symmetric; flat series still has a span", () => {
    const vals = [...Array(100).keys()].map((i) => 2 + i / 100);
    vals.push(40); // gps spike
    const [lo, hi] = metricDomain(vals, "speed");
    expect(hi).toBeLessThan(3);
    expect(lo).toBeGreaterThan(2);
    const [glo, ghi] = metricDomain([1, 2, -6, 3], "grade");
    expect(glo).toBe(-ghi);
    const [a, b] = metricDomain([5, 5, 5], "hr");
    expect(b).toBeGreaterThan(a);
    expect(metricDomain([null, null], "hr")).toEqual([0, 1]);
  });

  it("formats each metric", () => {
    expect(formatMetric(1609.344 / 480, "pace")).toBe("8:00 /mi");
    expect(formatMetric(0, "pace")).toBe("—");
    expect(formatMetric(10, "speed")).toBe("22.4 mph");
    expect(formatMetric(151.6, "hr")).toBe("152 bpm");
    expect(formatMetric(4.25, "grade")).toBe("+4.3%");
    expect(formatMetric(100, "elevation")).toBe("328 ft");
    expect(formatMetric(null, "hr")).toBe("—");
  });
});

describe("route colors", () => {
  it("palette ends and clamping", () => {
    expect(paletteAt(0)).toBe(ROUTE_PALETTE[0]);
    expect(paletteAt(1)).toBe(ROUTE_PALETTE[ROUTE_PALETTE.length - 1]);
    expect(paletteAt(-3)).toBe(ROUTE_PALETTE[0]);
    expect(paletteAt(NaN)).toBe(ROUTE_PALETTE[0]);
    expect(colorFor(null, [0, 1])).toBe(ROUTE_NO_DATA);
    expect(colorFor(0.5, [0, 1])).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("pieces cover every segment, stay continuous, never join segments", () => {
    const r = replay([seg(0, 40, 0, { ele: (i) => i }), seg(400, 40, 0.01, { ele: (i) => 40 - i })]);
    const v = buildReplayView(r);
    const pieces = routePieces(v, v.ele, [0, 40], 8);
    expect(pieces.length).toBeGreaterThan(2);
    // no piece mixes points from both segments (segment 2 starts at lng 0.01)
    for (const p of pieces) {
      const inSecond = p.coords.map(([lng]) => lng >= 0.01 - 1e-9);
      expect(inSecond.every((x) => x === inSecond[0])).toBe(true);
      expect(p.coords.length).toBeGreaterThan(1);
    }
    // consecutive pieces in a segment share their joining point
    for (let i = 1; i < pieces.length; i++) {
      const prev = pieces[i - 1].coords;
      const cur = pieces[i].coords;
      const sameSeg = (prev[0][0] >= 0.01 - 1e-9) === (cur[0][0] >= 0.01 - 1e-9);
      if (sameSeg) expect(cur[0]).toEqual(prev[prev.length - 1]);
    }
    // vertex count = points + one shared vertex per break within a segment
    const verts = pieces.reduce((n, p) => n + p.coords.length, 0);
    expect(verts).toBe(v.n + pieces.length - 2);
  });

  it("uses the no-data gray for missing values", () => {
    const v = buildReplayView(replay([seg(0, 5, 0)]));
    const pieces = routePieces(v, v.hr, [0, 1]);
    expect(pieces).toHaveLength(1);
    expect(pieces[0].color).toBe(ROUTE_NO_DATA);
  });
});

describe("lookups", () => {
  const v = buildReplayView(replay([seg(0, 10, 0), seg(400, 10, 0.01)]));

  it("nearest point by lng/lat", () => {
    expect(nearestIndex(v, 0.00031, 0.00001)).toBe(3);
    expect(nearestIndex(v, 0.0102, 0)).toBe(12);
    expect(nearestIndex(v, 5, 5)).toBe(19);
  });

  it("nearest by time and distance (binary search, clamped)", () => {
    expect(nearestSorted([0, 10, 20], 14)).toBe(1);
    expect(nearestSorted([0, 10, 20], 16)).toBe(2);
    expect(nearestSorted([0, 10, 20], -5)).toBe(0);
    expect(nearestSorted([], 1)).toBe(-1);
    expect(indexAtTime(v, 8)).toBe(2);
    expect(indexAtTime(v, 401)).toBe(10);
    expect(indexAtTime(v, 1e9)).toBe(19);
    expect(indexAtDistance(v, v.dist[5] + 1)).toBe(5);
  });
});

describe("start/end markers", () => {
  it("replay: first point of the first segment, last point of the last", () => {
    const v = buildReplayView(replay([seg(0, 5, 0), seg(400, 5, 0.01)]));
    const e = publishedEndpoints(v, "ignored")!;
    expect(e.start).toEqual([0, 0]);
    expect(e.end[0]).toBeCloseTo(0.0104);
  });

  it("polyline: published segment endpoints only, as [lng, lat]", () => {
    const pl = encodeMultiPolyline([
      [[1, 2], [1.001, 2.001]],
      [[1.01, 2.01], [1.02, 2.02]],
    ]);
    expect(publishedEndpoints(null, pl)).toEqual({ start: [2, 1], end: [2.02, 1.02] });
    expect(publishedEndpoints(null, null)).toBeNull();
    expect(publishedEndpoints(null, "")).toBeNull();
  });
});

describe("chart scaling", () => {
  it("linear scale and extents", () => {
    const s = linearScale([0, 10], [100, 0]);
    expect(s(0)).toBe(100);
    expect(s(5)).toBe(50);
    expect(seriesExtent([null, null])).toBeNull();
    const [lo, hi] = seriesExtent([10, 20], 0.1)!;
    expect(lo).toBeCloseTo(9);
    expect(hi).toBeCloseTo(21);
  });

  it("chart x is distance when the track moves, else time", () => {
    const moving = buildReplayView(replay([seg(0, 10, 0)]));
    expect(chartX(moving)).toBe(moving.dist);
    const still = buildReplayView(replay([{ t: [0, 5, 10], lat: [0, 0, 0], lng: [0, 0, 0], ele: null, hr: null, speed: [0, 0, 0] }]));
    expect(chartX(still)).toBe(still.t);
  });

  it("downsampling keeps extremes and caps the point count per pixel", () => {
    const n = 5000;
    const xs = [...Array(n).keys()];
    const ys: (number | null)[] = xs.map((i) => Math.sin(i / 50));
    ys[1234] = 9; // spike must survive
    const idx = downsampleIndices(xs, ys, 0, n, 100);
    expect(idx.length).toBeLessThanOrEqual(400);
    expect(idx).toContain(1234);
    expect(idx[0]).toBe(0);
    expect(idx[idx.length - 1]).toBe(n - 1);
    for (let i = 1; i < idx.length; i++) expect(idx[i]).toBeGreaterThan(idx[i - 1]);
    // small series: everything non-null
    expect(downsampleIndices([0, 1, 2], [1, null, 3], 0, 3, 100)).toEqual([0, 2]);
  });

  it("paths break between segments and at missing values", () => {
    const v = buildReplayView(replay([seg(0, 5, 0, { ele: () => 1 }), seg(400, 5, 0.01, { ele: () => 2 })]));
    const sx = linearScale([0, v.totalDist], [0, 100]);
    const sy = linearScale([0, 3], [50, 0]);
    const d = seriesPath(v, v.ele, sx, sy, 100);
    expect(d.match(/M/g)).toHaveLength(2);
    const holes = [...v.ele];
    holes[2] = null;
    expect(seriesPath(v, holes, sx, sy, 100).match(/M/g)).toHaveLength(3);
    const area = seriesArea(v, v.ele, sx, sy, 50, 100);
    expect(area.match(/Z/g)).toHaveLength(2);
  });
});

// every color string in a style object
function colors(obj: unknown, out: string[] = []): string[] {
  if (typeof obj === "string") {
    if (/^(#|rgb|hsl)/i.test(obj)) out.push(obj);
  } else if (Array.isArray(obj)) obj.forEach((x) => colors(x, out));
  else if (obj && typeof obj === "object") Object.values(obj).forEach((x) => colors(x, out));
  return out;
}

function isGray(c: string): boolean {
  const hex = /^#([0-9a-f]{6})$/i.exec(c);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return (n >> 16) % 256 === (n >> 8) % 256 && (n >> 8) % 256 === n % 256;
  }
  const rgb = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/i.exec(c);
  if (rgb) return rgb[1] === rgb[2] && rgb[2] === rgb[3];
  return false;
}

describe("map style", () => {
  it("oklch grays match the css tokens", () => {
    expect(oklchGray(0.949)).toBe("#eeeeee");
    expect(oklchGray(0)).toBe("#000000");
    expect(oklchGray(1)).toBe("#ffffff");
    expect(PALETTES.light.background).toBe(oklchGray(0.949));
    expect(PALETTES.dark.background).toBe(oklchGray(0.173));
  });

  for (const theme of ["light", "dark"] as const) {
    it(`${theme}: terrain, hillshade and 3d buildings`, () => {
      const s = buildMapStyle(theme);
      expect(s.terrain).toEqual({ source: "terrain", exaggeration: TERRAIN_EXAGGERATION });
      const dem = s.sources.terrain as { type: string; encoding: string; tiles: string[]; maxzoom: number; attribution?: string };
      expect(dem.type).toBe("raster-dem");
      expect(dem.encoding).toBe("terrarium");
      expect(dem.tiles).toEqual([TERRARIUM_TILES]);
      expect(dem.maxzoom).toBeLessThanOrEqual(15);
      expect(dem.attribution).toMatch(/mapzen/);
      expect((s.sources.openmaptiles as { url: string }).url).toBe("https://tiles.openfreemap.org/planet");
      const hill = s.layers.find((l) => l.type === "hillshade");
      expect(hill && "source" in hill && hill.source).toBe("hillshade");
      const b = s.layers.find((l) => l.type === "fill-extrusion") as { minzoom?: number; paint: Record<string, unknown>; "source-layer": string };
      expect(b["source-layer"]).toBe("building");
      expect(b.minzoom).toBe(BUILDINGS_MINZOOM);
      expect(JSON.stringify(b.paint)).toContain("render_height");
      expect(JSON.stringify(b.paint)).toContain("render_min_height");
    });

    it(`${theme}: only grays, no pois`, () => {
      const s = buildMapStyle(theme);
      const cs = colors(s);
      expect(cs.length).toBeGreaterThan(10);
      for (const c of cs) expect(isGray(c), c).toBe(true);
      for (const c of colors(OVERLAY[theme])) expect(isGray(c), c).toBe(true);
      expect(s.layers.some((l) => "source-layer" in l && l["source-layer"] === "poi")).toBe(false);
      // the route color is the only non-gray in play
      expect(isGray(ROUTE_SOLID)).toBe(false);
      for (const c of ROUTE_PALETTE) expect(isGray(c)).toBe(false);
    });
  }

  it("light and dark differ and dark is darker", () => {
    const lum = (c: string) => parseInt(c.slice(1, 3), 16);
    expect(lum(PALETTES.dark.background)).toBeLessThan(lum(PALETTES.light.background));
    expect(lum(PALETTES.dark.label)).toBeGreaterThan(lum(PALETTES.dark.background));
    expect(lum(PALETTES.light.label)).toBeLessThan(lum(PALETTES.light.background));
    expect(buildSky("dark")["sky-color"]).toBe(PALETTES.dark.background);
    const light = buildMapStyle("light");
    const dark = buildMapStyle("dark");
    expect(light.layers.map((l) => l.id)).toEqual(dark.layers.map((l) => l.id));
    expect(JSON.stringify(light.layers)).not.toBe(JSON.stringify(dark.layers));
  });

  it("flat option drops terrain; mobile dem maxzoom is honoured", () => {
    expect(buildMapStyle("light", { terrain: false }).terrain).toBeUndefined();
    const s = buildMapStyle("light", { terrainMaxzoom: 12 });
    expect((s.sources.terrain as { maxzoom: number }).maxzoom).toBe(12);
    expect((s.sources.hillshade as { maxzoom: number }).maxzoom).toBe(12);
  });

  it("theme updates cover every painted layer with the target theme's values", () => {
    const ups = themePaintUpdates("dark");
    const bg = ups.find((u) => u.layer === "background" && u.prop === "background-color");
    expect(bg?.value).toBe(PALETTES.dark.background);
    const painted = buildMapStyle("dark").layers.filter((l) => "paint" in l && l.paint).map((l) => l.id);
    expect(new Set(ups.map((u) => u.layer))).toEqual(new Set(painted));
  });
});
