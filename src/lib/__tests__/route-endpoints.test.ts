import { describe, it, expect } from "vitest";
import { routeEndpoints } from "../route-smooth";

describe("routeEndpoints", () => {
  it("uses the first point of the first segment and the last of the last", () => {
    expect(routeEndpoints([[[0, 0], [1, 1]], [], [[5, 5], [6, 7]]])).toEqual({ start: [0, 0], end: [6, 7] });
  });

  it("is null without points", () => {
    expect(routeEndpoints([])).toBeNull();
    expect(routeEndpoints([[]])).toBeNull();
  });
});
