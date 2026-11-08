import { describe, it, expect, vi, beforeEach } from "vitest";

const { sync, revalidate } = vi.hoisted(() => ({ sync: vi.fn(), revalidate: vi.fn() }));

vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => revalidate(...a) }));
vi.mock("@/lib/admin-auth", async () => {
  const { NextResponse } = await import("next/server");
  return { unauthorizedResponse: () => NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
});
vi.mock("@/lib/activity-sync", () => ({ syncActivitiesNow: (o: unknown) => sync(o) }));

import { POST } from "@/app/api/sync/activities/route";

const call = (auth = "Bearer s3cret") =>
  POST(new Request("http://localhost/api/sync/activities", { method: "POST", headers: { authorization: auth } }));

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = "s3cret";
  sync.mockResolvedValue({ runId: "r1", dryRun: false, garmin: { off: true }, intervals: { inserted: 0 }, changed: false });
});

describe("POST /api/sync/activities", () => {
  it("needs the cron secret", async () => {
    expect((await call("Bearer nope")).status).toBe(401);
    delete process.env.CRON_SECRET;
    expect((await call()).status).toBe(401);
    expect(sync).not.toHaveBeenCalled();
  });

  it("runs the frequent pull as a poll and answers with what it did", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, runId: "r1", garmin: { off: true } });
    expect(sync).toHaveBeenCalledWith({ trigger: "poll" });
    expect(revalidate).not.toHaveBeenCalled();
  });

  it("revalidates the training pages only when something changed", async () => {
    sync.mockResolvedValue({ runId: "r2", dryRun: false, garmin: { off: true }, intervals: { inserted: 1 }, changed: true });
    await call();
    expect(revalidate).toHaveBeenCalledWith("/training");
  });

  it("a thrown sync is a 500", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    sync.mockRejectedValue(new Error("boom"));
    const res = await call();
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ ok: false, error: "boom" });
  });
});
