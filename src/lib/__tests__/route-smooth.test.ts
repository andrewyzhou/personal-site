import { describe, it, expect } from "vitest";
import { quadraticPathD, chaikin } from "../route-smooth";

const P: [number, number][] = [
  [0, 0],
  [10, 0],
  [10, 10],
  [0, 10],
  [0, 0],
];

describe("quadraticPathD", () => {
  it("two points degrade to a straight segment", () => {
    expect(quadraticPathD([[1, 2], [3, 4]], 0)).toBe("M1 2L3 4");
  });

  it("n points produce n-2 quadratic segments with exact endpoints", () => {
    const d = quadraticPathD(P, 1);
    expect(d.startsWith("M0.0 0.0")).toBe(true);
    expect(d.match(/Q/g)).toHaveLength(3);
    // closed square: path must end exactly back at the start point
    expect(d.endsWith("0.0 0.0")).toBe(true);
    expect(d).not.toContain("L");
  });

  it("interior joints land on segment midpoints (C1 continuity construction)", () => {
    const d = quadraticPathD(P, 1);
    // first curve: control P1=(10,0), end mid(P1,P2)=(10,5)
    expect(d).toContain("Q10.0 0.0 10.0 5.0");
    // second: control P2=(10,10), end mid(P2,P3)=(5,10)
    expect(d).toContain("Q10.0 10.0 5.0 10.0");
  });
});

describe("chaikin", () => {
  it("preserves endpoints and cuts corners onto the original segments", () => {
    const one = chaikin(P, 1);
    expect(one[0]).toEqual([0, 0]);
    expect(one[one.length - 1]).toEqual([0, 0]);
    // 2(n-1) cut points + 2 endpoints
    expect(one).toHaveLength(2 * (P.length - 1) + 2);
    // first cut point sits ¼ along the first segment
    expect(one[1]).toEqual([2.5, 0]);
    expect(one[2]).toEqual([7.5, 0]);
  });

  it("two iterations roughly quadruple the density", () => {
    const two = chaikin(P, 2);
    expect(two.length).toBeGreaterThan(3 * P.length);
    expect(two.length).toBeLessThan(5 * P.length);
  });

  it("leaves degenerate inputs untouched", () => {
    expect(chaikin([[1, 1], [2, 2]], 2)).toEqual([[1, 1], [2, 2]]);
    expect(chaikin([], 2)).toEqual([]);
  });
});
