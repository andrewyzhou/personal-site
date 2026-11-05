import { describe, expect, it } from "vitest";
import type { TrackRecord } from "../geo";
import { metricSegments } from "../metrics/from-track";

const rec = (t: number): TrackRecord => ({ t, lat: 0, lng: 0, ele: 10 + t, hr: 140, cadence: 80, watts: null, speed: 3 });

describe("metricSegments", () => {
  // two visible runs with a hidden stretch between them (t 3..6, 30 m)
  const cum = new Map([[0, 0], [1, 3], [2, 6], [7, 36], [8, 39], [9, 42]]);
  const recs = new Map([...cum.keys()].map((t) => [t, rec(t)]));
  const segs = [[{ t: 0 }, { t: 1 }, { t: 2 }], [{ t: 7 }, { t: 8 }, { t: 9 }]];

  it("keeps segments apart and never counts the distance between them", () => {
    const out = metricSegments(segs, (t) => recs.get(t), (t) => cum.get(t));
    expect(out).toHaveLength(2);
    expect(out[0].map((s) => s.d)).toEqual([0, 3, 6]);
    expect(out[1].map((s) => s.d)).toEqual([6, 9, 12]); // resumes at 6, not 36
    expect(out[1][0]).toMatchObject({ t: 7, ele: 17, hr: 140, cadence: 80, speed: 3 });
  });

  it("skips samples with no record and drops empty segments", () => {
    const out = metricSegments([[{ t: 0 }, { t: 1 }], [{ t: 99 }]], (t) => recs.get(t), (t) => cum.get(t));
    expect(out).toHaveLength(1);
    expect(out[0]).toHaveLength(2);
  });
});
