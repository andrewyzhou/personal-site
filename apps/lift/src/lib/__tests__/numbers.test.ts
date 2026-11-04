import { describe, expect, it } from "vitest";
import { formatCount, formatDecimal, parseCount, parseDecimal } from "../numbers";

describe("parseDecimal", () => {
  it.each([
    ["22,5", 22.5],
    ["22.5", 22.5],
    [" 135 ", 135],
    ["22.", 22],
    [".5", 0.5],
    ["-40", -40],
    ["0", 0],
  ])("%j -> %j", (input, out) => {
    expect(parseDecimal(input)).toBe(out);
  });

  it.each(["", "  ", "-", ",", "abc", "1,2,3", "1.2.3", "12kg", "1e3"])("%j -> null", (input) => {
    expect(parseDecimal(input)).toBeNull();
  });
});

describe("parseCount", () => {
  it("parses whole numbers", () => {
    expect(parseCount("8")).toBe(8);
    expect(parseCount(" 12 ")).toBe(12);
    expect(parseCount("0")).toBe(0);
  });
  it.each(["", "8.5", "-1", "x", "8,"])("%j -> null", (input) => {
    expect(parseCount(input)).toBeNull();
  });
});

describe("format", () => {
  it("round-trips without float noise", () => {
    expect(formatDecimal(22.5)).toBe("22.5");
    expect(formatDecimal(100)).toBe("100");
    expect(formatDecimal(0.1 + 0.2)).toBe("0.3");
    expect(formatDecimal(null)).toBe("");
    expect(formatCount(null)).toBe("");
    expect(formatCount(5)).toBe("5");
  });
});
