import { describe, it, expect, vi, beforeEach } from "vitest";

const { pull, rebuild } = vi.hoisted(() => ({ pull: vi.fn(), rebuild: vi.fn() }));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/admin-auth", async () => {
  const { NextResponse } = await import("next/server");
  return { unauthorizedResponse: () => NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
});
vi.mock("@/lib/intervals", () => ({ isIntervalsConfigured: () => true, pullIntervalsActivities: () => pull() }));
vi.mock("@/lib/privacy/rebuild", () => ({ DEFAULT_REBUILD_BUDGET_MS: 45_000, republishPending: (o: unknown) => rebuild(o) }));

import { GET } from "@/app/api/cron/activities/route";

const call = (auth = "Bearer s3cret") => GET(new Request("http://localhost/api/cron/activities", { headers: { authorization: auth } }));

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = "s3cret";
  pull.mockResolvedValue({ imported: 2 });
  rebuild.mockResolvedValue({ results: [{ id: 1, status: "published" }], failedIds: [], remaining: 0, timedOut: false });
});

describe("GET /api/cron/activities", () => {
  it("rejects without the cron secret", async () => {
    expect((await call("Bearer nope")).status).toBe(401);
    expect(rebuild).not.toHaveBeenCalled();
    expect(pull).not.toHaveBeenCalled();
  });

  it("pulls from intervals.icu only, then rebuilds pending activities within the time left", async () => {
    const res = await call();
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, intervals: { imported: 2 }, rebuild: { processed: 1, failed: 0, remaining: 0 } });
    expect(Object.keys(body).sort()).toEqual(["intervals", "ok", "rebuild"]);
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
      pull.mockImplementation(async () => {
        now.mockReturnValue(t0 + 20_000);
        return { imported: 1 };
      });
      await call();
      expect(rebuild.mock.calls[0][0].timeBudgetMs).toBe(15_000);

      rebuild.mockClear();
      now.mockReturnValue(t0);
      pull.mockImplementation(async () => {
        now.mockReturnValue(t0 + 31_000);
        return { imported: 1 };
      });
      const body = await (await call()).json();
      expect(rebuild).not.toHaveBeenCalled();
      expect(body.rebuild).toEqual({ skipped: "no time left" });
    } finally {
      now.mockRestore();
    }
  });

  it("a rebuild failure never fails the cron", async () => {
    rebuild.mockRejectedValue(new Error("db down"));
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, intervals: { imported: 2 }, rebuild: { error: "db down" } });
  });

  it("still rebuilds when the pull fails", async () => {
    pull.mockRejectedValue(new Error("rate limited"));
    const res = await call();
    expect(await res.json()).toMatchObject({ ok: true, intervals: { error: "rate limited" }, rebuild: { processed: 1 } });
  });
});
