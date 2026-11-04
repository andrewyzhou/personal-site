import { describe, it, expect } from "vitest";
import { rawKey, sha256Hex } from "../raw-store";
import {
  compareContent,
  compareHead,
  compareLegacyOriginal,
  findDangling,
  findOrphans,
  selectForRehash,
  summarizeFindings,
  type ManifestEntry,
} from "../raw-audit";

const bytes = new TextEncoder().encode("hello raw store");
const sha = sha256Hex(bytes);
const entry = (over: Partial<ManifestEntry> = {}): ManifestEntry => ({
  sha256: sha, key: rawKey(sha), sizeBytes: bytes.length, createdAt: new Date("2026-11-01T00:00:00Z"), ...over,
});

describe("compareHead", () => {
  it("passes when present with the manifest size", () => {
    expect(compareHead(entry(), { size: bytes.length })).toBeNull();
  });

  it("fails on missing objects, size mismatches and wrong keys", () => {
    expect(compareHead(entry(), null)).toMatchObject({ severity: "failure", check: "head" });
    expect(compareHead(entry(), { size: 3 })?.detail).toMatch(/size 3/);
    expect(compareHead(entry({ key: "sha256/zz/x" }), { size: bytes.length })).toMatchObject({ check: "manifest" });
  });
});

describe("compareContent", () => {
  it("passes on identical bytes", () => {
    expect(compareContent(entry(), bytes)).toBeNull();
  });

  it("fails on missing, truncated or altered bytes", () => {
    expect(compareContent(entry(), null)?.detail).toMatch(/missing/);
    expect(compareContent(entry(), bytes.slice(1))?.detail).toMatch(/size/);
    const altered = new Uint8Array(bytes);
    altered[0] ^= 1;
    expect(compareContent(entry(), altered)?.detail).toMatch(/hash to/);
  });
});

describe("selectForRehash", () => {
  const now = Date.UTC(2026, 10, 4);
  const day = 24 * 60 * 60 * 1000;
  const rows = Array.from({ length: 50 }, (_, i) => ({ id: i, createdAt: new Date(now - i * day) }));

  it("takes every recent row plus a sample of the rest", () => {
    const picked = selectForRehash(rows, { now, sample: 5, recentDays: 8, random: () => 0 });
    const ids = picked.map((r) => r.id);
    expect(ids.slice(0, 9)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(ids).toHaveLength(14);
    expect(new Set(ids).size).toBe(14);
    expect(ids.slice(9).every((id) => id > 8)).toBe(true);
  });

  it("full selects everything", () => {
    expect(selectForRehash(rows, { full: true })).toHaveLength(50);
  });

  it("samples no more than exist", () => {
    expect(selectForRehash(rows.slice(0, 12), { now, sample: 20 })).toHaveLength(12);
  });
});

describe("findDangling", () => {
  it("warns for backfilled legacy originals, fails for anything else", () => {
    const f = findDangling(
      [
        { id: 1, activityId: 10, kind: "device-file", rawSha256: "a".repeat(64), legacyFitSha256: "a".repeat(64) },
        { id: 2, activityId: 11, kind: "strava-streams", rawSha256: "b".repeat(64), legacyFitSha256: null },
        { id: 3, activityId: 12, kind: "device-file", rawSha256: sha, legacyFitSha256: null }, // present
        { id: 4, activityId: 13, kind: "summary", rawSha256: null, legacyFitSha256: null },
      ],
      new Set([sha])
    );
    expect(f.map((x) => [x.severity, x.subject])).toEqual([
      ["warning", "source 1 (activity 10, device-file)"],
      ["failure", "source 2 (activity 11, strava-streams)"],
    ]);
  });
});

describe("findOrphans", () => {
  it("flags unknown and malformed keys under sha256/ only", () => {
    const other = sha256Hex(new TextEncoder().encode("other"));
    const f = findOrphans(
      [
        { key: rawKey(sha), size: 1 },
        { key: rawKey(other), size: 2 },
        { key: "sha256/zz/not-a-sha", size: 3 },
        { key: `sha256/00/${other}`, size: 4 }, // wrong shard
        { key: "derived/tracks/x.json.gz", size: 5 },
        { key: "backups/pg/2026/11/04/x.dump", size: 6 },
      ],
      new Set([rawKey(sha)])
    );
    expect(f.map((x) => x.subject)).toEqual([rawKey(other), "sha256/zz/not-a-sha", `sha256/00/${other}`]);
    expect(f.every((x) => x.severity === "failure")).toBe(true);
  });
});

describe("compareLegacyOriginal", () => {
  const row = { id: 5, fitBlobPathname: "activities/fit/2026/x.fit", fitSha256: sha };
  it("checks existence and, when bytes are given, the hash", () => {
    expect(compareLegacyOriginal(row, { exists: true })).toBeNull();
    expect(compareLegacyOriginal(row, { exists: true, bytes })).toBeNull();
    expect(compareLegacyOriginal(row, { exists: false })?.detail).toMatch(/missing/);
    expect(compareLegacyOriginal(row, { exists: true, bytes: bytes.slice(2) })?.detail).toMatch(/hashes to/);
  });
});

describe("summarizeFindings", () => {
  it("counts by severity and check", () => {
    const s = summarizeFindings([
      { severity: "failure", check: "head", subject: "a", detail: "" },
      { severity: "warning", check: "dangling", subject: "b", detail: "" },
      { severity: "failure", check: "dangling", subject: "c", detail: "" },
    ]);
    expect(s).toEqual({
      failures: 2,
      warnings: 1,
      byCheck: { head: { failures: 1, warnings: 0 }, dangling: { failures: 1, warnings: 1 } },
    });
  });
});
