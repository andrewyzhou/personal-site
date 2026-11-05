import { describe, it, expect } from "vitest";
import { decoyAt, decoyPath, decoySeed, fogBlob, fogPuffs, haversineM, hashSeed, prng, type LatLng } from "@/lib/replay/decoy";

const A: LatLng = [51.5, -0.12];
const B: LatLng = [51.503, -0.115];

describe("fog blob", () => {
  it("is a circle around the midpoint that holds both ends", () => {
    const blob = fogBlob(A, B);
    const d = haversineM(A, B);
    expect(blob.center[0]).toBeCloseTo((A[0] + B[0]) / 2, 9);
    expect(blob.radiusM).toBeGreaterThan(d / 2);
    expect(haversineM(blob.center, A)).toBeLessThan(blob.radiusM);
    expect(haversineM(blob.center, B)).toBeLessThan(blob.radiusM);
  });

  it("has a margin even when the ends coincide", () => {
    expect(fogBlob(A, A).radiusM).toBeGreaterThan(50);
  });
});

describe("prng", () => {
  it("is deterministic and in [0, 1)", () => {
    const a = prng(7);
    const b = prng(7);
    for (let i = 0; i < 100; i++) {
      const x = a();
      expect(x).toBe(b());
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
    expect(prng(8)()).not.toBe(prng(7)());
    expect(hashSeed("a")).not.toBe(hashSeed("b"));
  });

  it("seeds from the activity id and gap index", () => {
    expect(decoySeed(0, A, B, 12)).toBe(decoySeed(0, A, B, 12));
    expect(decoySeed(0, A, B, 12)).not.toBe(decoySeed(1, A, B, 12));
    expect(decoySeed(0, A, B, 12)).not.toBe(decoySeed(0, A, B, 13));
    expect(decoySeed(0, A, B)).toBe(decoySeed(0, A, B));
  });
});

describe("decoy path", () => {
  it("stays within the blob for many seeds", () => {
    for (let seed = 1; seed < 200; seed++) {
      const p = decoyPath(A, B, seed * 7919, 900);
      for (let f = 0; f <= 1; f += 0.01) {
        const q = decoyAt(p, f);
        expect(haversineM(p.blob.center, [q.lat, q.lng])).toBeLessThanOrEqual(p.blob.radiusM);
      }
    }
  });

  it("stays within the blob when the ends are far apart or together", () => {
    for (const [a, b] of [
      [A, [51.52, -0.09]],
      [A, A],
    ] as [LatLng, LatLng][]) {
      const p = decoyPath(a, b, 99, 1800);
      for (let f = 0; f <= 1; f += 0.005) {
        const q = decoyAt(p, f);
        expect(haversineM(p.blob.center, [q.lat, q.lng])).toBeLessThanOrEqual(p.blob.radiusM);
      }
    }
  });

  it("is deterministic per seed and differs between seeds", () => {
    const p1 = decoyPath(A, B, 1234, 600);
    const p2 = decoyPath(A, B, 1234, 600);
    const p3 = decoyPath(A, B, 4321, 600);
    expect(Array.from(p1.xs)).toEqual(Array.from(p2.xs));
    expect(decoyAt(p1, 0.4)).toEqual(decoyAt(p2, 0.4));
    expect(decoyAt(p1, 0.4)).not.toEqual(decoyAt(p3, 0.4));
  });

  it("starts at the exit point and ends at the entry point", () => {
    const p = decoyPath(A, B, 5, 300);
    const s = decoyAt(p, 0);
    const e = decoyAt(p, 1);
    expect(haversineM([s.lat, s.lng], A)).toBeLessThan(0.01);
    expect(haversineM([e.lat, e.lng], B)).toBeLessThan(0.01);
  });

  it("depends only on the endpoints, the seed and the duration", () => {
    // same inputs from a fresh call: identical, nothing else feeds it
    expect(decoyPath(A, B, 5, 300).cum).toEqual(decoyPath(A, B, 5, 300).cum);
    expect(decoyPath(A, B, 5, 300).xs.length).not.toBe(decoyPath(A, B, 5, 1800).xs.length);
  });

  it("moves at a steady pace", () => {
    const p = decoyPath(A, B, 11, 900);
    const steps: number[] = [];
    let prev = decoyAt(p, 0);
    for (let f = 0.05; f <= 1.0001; f += 0.05) {
      const q = decoyAt(p, f);
      steps.push(haversineM([prev.lat, prev.lng], [q.lat, q.lng]));
      prev = q;
    }
    // each 5% step covers 5% of the path length (a chord can only be shorter)
    const share = p.cum[p.cum.length - 1] / 20;
    for (const s of steps) expect(s).toBeLessThanOrEqual(share * 1.01 + 0.5);
    expect(Math.max(...steps)).toBeGreaterThan(share * 0.5);
  });
});

describe("fog puffs", () => {
  it("are seeded and sit around the blob", () => {
    const blob = fogBlob(A, B);
    const a = fogPuffs(blob, 3);
    expect(a).toEqual(fogPuffs(blob, 3));
    expect(a).toHaveLength(5);
    for (const p of a) expect(haversineM(blob.center, [p.lat, p.lng]) + p.radiusM).toBeLessThanOrEqual(blob.radiusM * 1.01);
  });
});
