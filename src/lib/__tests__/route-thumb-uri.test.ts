import { describe, it, expect } from "vitest";
import { encodePolyline } from "@/lib/polyline";
import { routeThumbDataUri } from "../route-thumb-uri";

const square: [number, number][] = [
  [37.87, -122.26],
  [37.88, -122.26],
  [37.88, -122.25],
  [37.87, -122.25],
  [37.87, -122.26],
];

describe("routeThumbDataUri", () => {
  it("renders an encoded polyline into a self-contained svg data uri", () => {
    const uri = routeThumbDataUri(encodePolyline(square));
    expect(uri).toMatch(/^data:image\/svg\+xml,/);
    const svg = decodeURIComponent(uri!.slice("data:image/svg+xml,".length));
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain('stroke="#EEEEEE"');
    // midpoint quadratic smoothing: 5 points → M + 3 Q segments, no chords
    expect(svg).toMatch(/<path d="M[\d.]+ [\d.]+Q/);
    expect(svg.match(/Q/g)).toHaveLength(3);
  });

  it("scales coordinates into a ~100-unit viewbox regardless of route size", () => {
    const uri = routeThumbDataUri(encodePolyline(square));
    const svg = decodeURIComponent(uri!.slice("data:image/svg+xml,".length));
    const [, vw, vh] = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/)!;
    expect(Number(vw)).toBeGreaterThan(50);
    expect(Number(vw)).toBeLessThanOrEqual(120);
    expect(Number(vh)).toBeGreaterThan(50);
    expect(Number(vh)).toBeLessThanOrEqual(120);
  });

  it("returns null for empty or single-point polylines", () => {
    expect(routeThumbDataUri("")).toBeNull();
    expect(routeThumbDataUri(encodePolyline([[37.87, -122.26]]))).toBeNull();
  });

  it("uri stays small enough for css backgrounds at card-polyline density", () => {
    const many: [number, number][] = Array.from({ length: 100 }, (_, i) => [37.8 + i * 0.001, -122.3 + i * 0.0007]);
    const uri = routeThumbDataUri(encodePolyline(many));
    expect(uri!.length).toBeLessThan(4000);
  });
});
