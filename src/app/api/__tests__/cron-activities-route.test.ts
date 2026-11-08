import { describe, it, expect, vi, beforeEach } from "vitest";

const { sync, rebuild, prune } = vi.hoisted(() => ({ sync: vi.fn(), rebuild: vi.fn(), prune: vi.fn() }));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/admin-auth", async () => {
  const { NextResponse } = await import("next/server");
  return { unauthorizedResponse: () => NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
});
vi.mock("@/lib/activity-sync", () => ({ syncActivitiesNow: (o: unknown) => sync(o) }));
vi.mock("@/lib/privacy/rebuild", () => ({ DEFAULT_REBUILD_BUDGET_MS: 45_000, republishPending: (o: unknown) => rebuild(o) }));
vi.mock("@/lib/sync-log", async (orig) => ({
  ...(await orig<typeof import("@/lib/sync-log")>()),
  pruneApiCalls: () => prune(),
}));

import { GET } from "@/app/api/cron/activities/route";

const call = (auth = "Bearer s3cret") => GET(new Request("http://localhost/api/cron/activities", { headers: { authorization: auth } }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  process.env.CRON_SECRET = "s3cret";
  sync.mockResolvedValue({ runId: "r", dryRun: false, garmin: { off: true }, intervals: { inserted: 2 }, changed: true });
  rebuild.mockResolvedValue({ results: [{ id: 1, status: "published" }], failedIds: [], remaining: 0, timedOut: false });
  prune.mockResolvedValue(3);
});

describe("GET /api/cron/activities", () => {
  it("rejects without the cron secret", async () => {
    expect((await call("Bearer nope")).status).toBe(401);
    expect(rebuild).not.toHaveBeenCalled();
    expect(sync).not.toHaveBeenCalled();
  });

  it("syncs every source over the daily window, rebuilds within the time left, prunes old api calls", async () => {
    const res = await call();
    const body = await res.json();
    expect(body).toMatchObject({
      ok: true,
      garmin: { off: true },
      intervals: { inserted: 2 },
      rebuild: { processed: 1, failed: 0, remaining: 0 },
      prunedApiCalls: 3,
    });
    expect(Object.keys(body).sort()).toEqual(["garmin", "intervals", "ok", "prunedApiCalls", "rebuild"]);
    expect(sync).toHaveBeenCalledWith({ trigger: "cron", days: 7, metadataDays: 14 });
    const opts = rebuild.mock.calls[0][0];
    expect(opts.timeBudgetMs).toBeGreaterThan(5_000);
    // at most 30 s, even if the library default is larger
    expect(opts.timeBudgetMs).toBeLessThanOrEqual(30_000);
    expect(typeof opts.revalidate).toBe("function");
  });

  it("nothing starts after 35 s of the run: slow imports shrink or skip the rebuild", async () => {
    const t0 = 1_000_000;
    const now = vi.spyOn(Date, "now");
    try {
      now.mockReturnValue(t0);
      sync.mockImplementation(async () => {
        now.mockReturnValue(t0 + 20_000);
        return { garmin: { off: true }, intervals: { inserted: 1 } };
      });
      await call();
      expect(rebuild.mock.calls[0][0].timeBudgetMs).toBe(15_000);

      rebuild.mockClear();
      now.mockReturnValue(t0);
      sync.mockImplementation(async () => {
        now.mockReturnValue(t0 + 31_000);
        return { garmin: { off: true }, intervals: { inserted: 1 } };
      });
      const body = await (await call()).json();
      expect(rebuild).not.toHaveBeenCalled();
      expect(body.rebuild).toEqual({ skipped: "no time left" });
    } finally {
      now.mockRestore();
    }
  });

  it("a rebuild or prune failure never fails the cron", async () => {
    rebuild.mockRejectedValue(new Error("db down"));
    prune.mockRejectedValue(new Error("no table"));
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, intervals: { inserted: 2 }, rebuild: { error: "db down" } });
  });

  it("still rebuilds when the sync fails", async () => {
    sync.mockRejectedValue(new Error("boom"));
    const res = await call();
    expect(await res.json()).toMatchObject({ ok: true, sync: { error: "boom" }, rebuild: { processed: 1 } });
  });
});
