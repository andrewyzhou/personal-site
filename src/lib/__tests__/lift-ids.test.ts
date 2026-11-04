import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { customExerciseId as coreCustomId, sha256Hex as coreSha } from "lift-core";
import { customExerciseId, nameKey, sha256Hex } from "@/lib/lift/rows";

const nodeSha = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

// small seeded prng so failures reproduce
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomString(next: () => number, len: number): string {
  let out = "";
  for (let i = 0; i < len; i++) {
    const r = next();
    if (r < 0.4) out += String.fromCharCode(32 + Math.floor(next() * 95));
    else if (r < 0.6) out += String.fromCharCode(0x80 + Math.floor(next() * 0x780));
    else if (r < 0.8) out += String.fromCharCode(0x800 + Math.floor(next() * 0xd000));
    else if (r < 0.95) out += String.fromCodePoint(0x10000 + Math.floor(next() * 0xfffff));
    // lone surrogates: both sides must encode them as U+FFFD
    else out += String.fromCharCode(0xd800 + Math.floor(next() * 0x800));
  }
  return out;
}

describe("lift-core sha256Hex vs node:crypto", () => {
  it("matches across many random strings and lengths around block boundaries", () => {
    const next = rng(1234);
    for (let i = 0; i < 600; i++) {
      const len = i < 200 ? i : Math.floor(next() * 400);
      const s = randomString(next, len);
      expect(coreSha(s)).toBe(nodeSha(s));
    }
  });

  it("matches on a large input", () => {
    const s = randomString(rng(9), 50_000);
    expect(coreSha(s)).toBe(nodeSha(s));
  });

  it("rows.ts re-exports the lift-core versions", () => {
    expect(sha256Hex).toBe(coreSha);
    expect(customExerciseId).toBe(coreCustomId);
  });
});

describe("customExerciseId stays what the site already stored", () => {
  // produced by the previous node:crypto implementation in rows.ts
  const KNOWN: [string, string, string][] = [
    ["Bench Press (Barbell)", "bench press barbell", "custom-aaa9f6997ce1"],
    ["My Weird Curl", "my weird curl", "custom-62c0a1a29d9c"],
    ["  my weird curl  ", "my weird curl", "custom-62c0a1a29d9c"],
    ["Жим лёжа", "жим лёжа", "custom-bca82a171ce9"],
    ["深蹲", "深蹲", "custom-14906fe65951"],
    ["Farmer's Walk", "farmers walk", "custom-7a62becb7381"],
    ["Ｂｅｎｃｈ", "bench", "custom-1b32c28cb38c"],
    ["Café Row", "cafe row", "custom-fb083ab3bd8a"],
    ["🏋️ Thing", "thing", "custom-5de94d691ae3"],
    ["", "", "custom-e3b0c44298fc"],
    ["Cable Fly × 2", "cable fly x 2", "custom-0133046ae850"],
    ["   ", "", "custom-e3b0c44298fc"],
    ["ＷＥＩＲＤ 深蹲", "weird", "custom-0728c355c79c"],
  ];
  it.each(KNOWN)("%j", (name, key, id) => {
    expect(nameKey(name)).toBe(key);
    expect(customExerciseId(name)).toBe(id);
  });
});
