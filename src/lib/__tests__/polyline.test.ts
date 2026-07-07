import { describe, it, expect } from "vitest";
import { encodePolyline, decodePolyline } from "../polyline";

describe("polyline codec", () => {
  it("matches the google reference vector", () => {
    // https://developers.google.com/maps/documentation/utilities/polylinealgorithm
    const points: [number, number][] = [
      [38.5, -120.2],
      [40.7, -120.95],
      [43.252, -126.453],
    ];
    expect(encodePolyline(points)).toBe("_p~iF~ps|U_ulLnnqC_mqNvxq`@");
    expect(decodePolyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@")).toEqual(points);
  });

  it("round-trips at precision 5", () => {
    const points: [number, number][] = [
      [37.86612, -122.25431],
      [37.86611, -122.25429],
      [37.87005, -122.26001],
    ];
    const decoded = decodePolyline(encodePolyline(points));
    for (let i = 0; i < points.length; i++) {
      expect(decoded[i][0]).toBeCloseTo(points[i][0], 5);
      expect(decoded[i][1]).toBeCloseTo(points[i][1], 5);
    }
  });

  it("handles empty and single-point inputs", () => {
    expect(encodePolyline([])).toBe("");
    expect(decodePolyline("")).toEqual([]);
    const one = decodePolyline(encodePolyline([[1.23456, -4.56789]]));
    expect(one).toHaveLength(1);
    expect(one[0][0]).toBeCloseTo(1.23456, 5);
  });
});
