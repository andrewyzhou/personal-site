import { describe, it, expect, vi, beforeEach } from "vitest";

const { handle, pending, revalidate } = vi.hoisted(() => ({
  handle: vi.fn(),
  pending: [] as (() => Promise<void>)[],
  revalidate: vi.fn(),
}));

vi.mock("next/server", async (orig) => ({
  ...(await orig<typeof import("next/server")>()),
  after: (fn: () => Promise<void>) => void pending.push(fn),
}));
vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => revalidate(...a) }));
vi.mock("@/lib/intervals", async (orig) => ({
  ...(await orig<typeof import("@/lib/intervals")>()),
  isIntervalsConfigured: () => true,
  handleWebhookEvent: (e: unknown) => handle(e),
}));

import { POST, secretMatches } from "@/app/api/intervals/webhook/route";

const post = (body: unknown) =>
  POST(new Request("http://localhost/api/intervals/webhook", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) }));

const payload = (over: Record<string, unknown> = {}) => ({
  secret: "hook-secret",
  events: [{ athlete_id: "i1", type: "ACTIVITY_UPLOADED", timestamp: "2026-10-03T15:20:00Z", activity: { id: "i100" } }],
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  pending.length = 0;
  process.env.INTERVALS_ICU_WEBHOOK_SECRET = "hook-secret";
  delete process.env.INTERVALS_ICU_ATHLETE_ID;
  handle.mockResolvedValue({ id: "i100", type: "ACTIVITY_UPLOADED", result: "inserted" });
});

describe("POST /api/intervals/webhook", () => {
  it("answers 200 at once and does the work after the response", async () => {
    const res = await post(payload());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, events: 1 });
    expect(handle).not.toHaveBeenCalled();
    expect(pending).toHaveLength(1);
    await pending[0]();
    expect(handle).toHaveBeenCalledWith({ type: "ACTIVITY_UPLOADED", activityId: "i100", timestamp: new Date("2026-10-03T15:20:00Z") });
    expect(revalidate).toHaveBeenCalledWith("/training");
  });

  it("rejects a wrong or missing secret without touching anything", async () => {
    for (const body of [payload({ secret: "nope" }), payload({ secret: undefined }), payload({ secret: 42 }), { events: [] }]) {
      const res = await post(body);
      expect(res.status).toBe(401);
    }
    expect(pending).toHaveLength(0);
  });

  it("is off (503) until a secret is configured", async () => {
    delete process.env.INTERVALS_ICU_WEBHOOK_SECRET;
    expect((await post(payload())).status).toBe(503);
    expect(pending).toHaveLength(0);
  });

  it("rejects malformed json", async () => {
    expect((await post("{not json")).status).toBe(400);
  });

  it("a payload with no usable events is acknowledged, with nothing scheduled", async () => {
    const res = await post(payload({ events: [{ type: "WELLNESS_UPDATED" }] }));
    expect(res.status).toBe(200);
    expect(pending).toHaveLength(0);
  });

  it("drops another athlete's events when the athlete id is configured", async () => {
    process.env.INTERVALS_ICU_ATHLETE_ID = "i9";
    const res = await post(payload());
    expect(await res.json()).toEqual({ ok: true, events: 0 });
  });

  it("one failing event doesn't stop the rest", async () => {
    handle.mockRejectedValueOnce(new Error("boom"));
    await post(
      payload({
        events: [
          { type: "ACTIVITY_UPLOADED", activity: { id: "i1" } },
          { type: "ACTIVITY_UPDATED", activity: { id: "i2" } },
        ],
      })
    );
    await pending[0]();
    expect(handle).toHaveBeenCalledTimes(2);
  });
});

describe("secretMatches", () => {
  it("matches only the exact secret", () => {
    expect(secretMatches("abc", "abc")).toBe(true);
    expect(secretMatches("abd", "abc")).toBe(false);
    expect(secretMatches("abcd", "abc")).toBe(false);
    expect(secretMatches("", "abc")).toBe(false);
    expect(secretMatches(undefined, "abc")).toBe(false);
    expect(secretMatches("abc", "")).toBe(false);
  });
});
