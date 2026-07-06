import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// these tests exercise env-dependent module state, so the module is imported
// fresh per test after setting the env

const ENV_KEYS = ["STRAVA_API_ENABLED", "STRAVA_REFRESH_TOKEN", "STRAVA_CLIENT_ID", "STRAVA_CLIENT_SECRET"] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  vi.resetModules();
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  // fail loudly if any code path reaches the network
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network call not expected in this test")));
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.unstubAllGlobals();
});

describe("strava env guards", () => {
  it("getAllActivities resolves [] when the api is disabled, without touching the network", async () => {
    process.env.STRAVA_API_ENABLED = "false";
    const { getAllActivities } = await import("../strava");
    await expect(getAllActivities()).resolves.toEqual([]);
  });

  it("getAllActivities throws when enabled but STRAVA_REFRESH_TOKEN is missing (review finding: silent [] let refresh wipe history)", async () => {
    process.env.STRAVA_API_ENABLED = "true";
    delete process.env.STRAVA_REFRESH_TOKEN;
    const { getAllActivities } = await import("../strava");
    await expect(getAllActivities()).rejects.toThrow("STRAVA_REFRESH_TOKEN");
  });

  it("getLatestActivity resolves null when disabled, throws when enabled but tokenless", async () => {
    process.env.STRAVA_API_ENABLED = "false";
    let mod = await import("../strava");
    await expect(mod.getLatestActivity()).resolves.toBeNull();

    vi.resetModules();
    process.env.STRAVA_API_ENABLED = "true";
    delete process.env.STRAVA_REFRESH_TOKEN;
    mod = await import("../strava");
    await expect(mod.getLatestActivity()).rejects.toThrow("STRAVA_REFRESH_TOKEN");
  });

  it("isStravaApiEnabled reflects the env flag", async () => {
    process.env.STRAVA_API_ENABLED = "true";
    const { isStravaApiEnabled } = await import("../strava");
    expect(isStravaApiEnabled()).toBe(true);
  });
});
