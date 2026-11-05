import { describe, it, expect, vi, afterEach } from "vitest";

// the cache is a pass-through and the db always fails, so every load hits the error path
vi.mock("next/cache", () => ({ unstable_cache: (fn: () => unknown) => fn }));
vi.mock("@/lib/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/db")>()),
  getDb: () => {
    throw new Error("db down");
  },
}));
vi.mock("@/lib/log", () => ({ log: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

import { isBuildPhase, loadLiftsOverview } from "@/lib/lift/public-stats";

describe("loadLiftsOverview failures", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("is null by default (the workout page just drops its week line)", async () => {
    await expect(loadLiftsOverview()).resolves.toBeNull();
  });

  it("rethrows when asked, so isr keeps the last good /lifts", async () => {
    await expect(loadLiftsOverview({ rethrow: true })).rejects.toThrow("db down");
  });

  it("knows when next build is prerendering", () => {
    vi.stubEnv("NEXT_PHASE", "phase-production-build");
    expect(isBuildPhase()).toBe(true);
    vi.stubEnv("NEXT_PHASE", "phase-production-server");
    expect(isBuildPhase()).toBe(false);
    vi.stubEnv("NEXT_PHASE", "");
    expect(isBuildPhase()).toBe(false);
  });
});
