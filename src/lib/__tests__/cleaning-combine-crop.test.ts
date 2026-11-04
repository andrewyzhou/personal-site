import { describe, it, expect } from "vitest";
import { combineCrop } from "../cleaning/edits";

const crop = (id: number, startS: number | null, endS: number | null) => ({ id, kind: "crop", params: { startS, endS } });

describe("combineCrop", () => {
  it("a tail crop keeps an earlier head crop (and vice versa)", () => {
    expect(combineCrop([crop(1, 300, null)], { startS: null, endS: 3000 })).toEqual({ startS: 300, endS: 3000 });
    expect(combineCrop([crop(1, null, 3000)], { startS: 300, endS: null })).toEqual({ startS: 300, endS: 3000 });
  });

  it("uses the crop in effect (the latest) and passes through without one", () => {
    expect(combineCrop([crop(1, 10, null), crop(2, 50, 900)], { startS: null, endS: 800 })).toEqual({ startS: 50, endS: 800 });
    expect(combineCrop([], { startS: null, endS: 800 })).toEqual({ startS: null, endS: 800 });
  });

  it("drops a stale other side that would make an empty window", () => {
    expect(combineCrop([crop(1, 900, null)], { startS: null, endS: 800 })).toEqual({ startS: null, endS: 800 });
  });
});
