import { describe, it, expect } from "vitest";
import type { ReactElement } from "react";
import { encodeMultiPolyline, encodePolyline } from "../polyline";
import { multiQuadraticPathD, projectSegments, quadraticPathD } from "../route-smooth";
import { routeThumbDataUri } from "../route-thumb-uri";
import RouteThumb from "@/components/RouteThumb";

// multi-segment (fogged) routes: every renderer draws each segment on its own
// and never a line across the gap

const a: [number, number][] = [
  [37.87, -122.26],
  [37.871, -122.259],
  [37.872, -122.258],
];
const b: [number, number][] = [
  [37.876, -122.254],
  [37.877, -122.253],
  [37.878, -122.252],
];

const moves = (d: string) => (d.match(/M/g) ?? []).length;

describe("multiQuadraticPathD", () => {
  it("one subpath per segment, joined without a connecting command", () => {
    const d = multiQuadraticPathD([[[0, 0], [1, 0], [1, 1]], [[5, 5], [6, 5]]], 0);
    expect(d).toBe(`${quadraticPathD([[0, 0], [1, 0], [1, 1]], 0)}${quadraticPathD([[5, 5], [6, 5]], 0)}`);
    expect(moves(d)).toBe(2);
  });

  it("drops segments too short to draw", () => {
    expect(multiQuadraticPathD([[[0, 0]], [[1, 1], [2, 2]]], 0)).toBe("M1 1L2 2");
    expect(multiQuadraticPathD([], 0)).toBe("");
  });
});

describe("projectSegments", () => {
  it("projects all segments into one frame (gaps keep their size)", () => {
    const p = projectSegments([a, b])!;
    expect(p.segments).toHaveLength(2);
    const xs = p.segments.flat().map(([x]) => x);
    expect(Math.min(...xs)).toBeCloseTo(0, 9);
    expect(Math.max(...xs)).toBeCloseTo(p.w, 9);
    // b sits up-right of a: in y-down coordinates its y values are smaller
    expect(p.segments[1][0][1]).toBeLessThan(p.segments[0][0][1]);
  });

  it("null when nothing is drawable", () => {
    expect(projectSegments([])).toBeNull();
    expect(projectSegments([[[1, 1]], [[2, 2]]])).toBeNull();
  });
});

describe("routeThumbDataUri with segments", () => {
  it("draws two subpaths for a two-segment polyline", () => {
    const uri = routeThumbDataUri(encodeMultiPolyline([a, b]))!;
    const svg = decodeURIComponent(uri.slice("data:image/svg+xml,".length));
    const d = svg.match(/ d="([^"]+)"/)![1];
    expect(moves(d)).toBe(2);
  });

  it("a single segment renders exactly like before", () => {
    expect(routeThumbDataUri(encodeMultiPolyline([a]))).toBe(routeThumbDataUri(encodePolyline(a)));
  });
});

describe("RouteThumb with segments", () => {
  // the path is the first child (start/end markers follow it)
  const pathD = (el: ReactElement | null) => {
    const kids = (el as ReactElement<{ children: unknown }>).props.children;
    const first = (Array.isArray(kids) ? kids[0] : kids) as ReactElement<{ d: string }>;
    return first.props.d;
  };

  it("start and end markers only where legible", () => {
    const markersOf = (el: ReactElement | null) => {
      const kids = (el as ReactElement<{ children: unknown[] }>).props.children;
      const frag = Array.isArray(kids) ? (kids[1] as ReactElement<{ children: ReactElement<{ "data-marker": string }>[] }> | null) : null;
      return frag ? frag.props.children.map((c) => c.props["data-marker"]) : [];
    };
    expect(markersOf(RouteThumb({ polyline: encodeMultiPolyline([a, b]), height: 80 })).sort()).toEqual(["end", "start"]);
    expect(markersOf(RouteThumb({ polyline: encodeMultiPolyline([a, b]), height: 30 }))).toEqual([]);
  });

  it("one subpath per segment", () => {
    expect(moves(pathD(RouteThumb({ polyline: encodeMultiPolyline([a, b]) })))).toBe(2);
    expect(moves(pathD(RouteThumb({ polyline: encodePolyline(a) })))).toBe(1);
  });

  it("renders nothing for undrawable input", () => {
    expect(RouteThumb({ polyline: "" })).toBeNull();
    expect(RouteThumb({ polyline: encodePolyline([a[0]]) })).toBeNull();
  });
});
