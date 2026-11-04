import { describe, it, expect, vi, beforeEach } from "vitest";

const { ingest } = vi.hoisted(() => ({ ingest: vi.fn() }));
vi.mock("@/lib/lift/ingest", () => ({ ingestStrongText: (...a: unknown[]) => ingest(...a) }));

import { POST } from "@/app/api/lift/ingest/strong-text/route";

const URL_ = "http://localhost/api/lift/ingest/strong-text";
const TEXT = "Push Day\nWednesday, November 4, 2026 at 6:12 PM\n\nBench Press (Barbell)\nSet 1: 185 lb × 5";

function req(body: BodyInit | null, headers: Record<string, string> = {}, token: string | null = "tok"): Request {
  const h: Record<string, string> = { ...headers };
  if (token) h.authorization = `Bearer ${token}`;
  return new Request(URL_, { method: "POST", body, headers: h });
}

const DETAILS = "logged push day\nbench press (barbell): 2×5 @ 185 lb · top e1rm 216 lb\nwatch: not linked yet · https://www.andrewzhou.org/lifts/q2W8vN0aZk1pL4xE";

function result(status: "created" | "updated" | "duplicate" | "empty") {
  const empty = "no exercises found in that text, so nothing was logged";
  return {
    status,
    duplicate: status === "duplicate",
    ingestId: "ing_1",
    workoutId: status === "empty" ? null : "strong-x",
    summary: null,
    text: status === "empty" ? empty : "logged push day",
    details: status === "empty" ? empty : DETAILS,
    links: [],
    warnings: [],
  };
}

describe("POST /api/lift/ingest/strong-text", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.LIFT_INGEST_TOKEN = "tok";
    ingest.mockResolvedValue(result("created"));
  });

  it("fails closed without a configured token", async () => {
    delete process.env.LIFT_INGEST_TOKEN;
    const res = await POST(req(TEXT, { "content-type": "text/plain" }));
    expect(res.status).toBe(401);
    expect(ingest).not.toHaveBeenCalled();
  });

  it("rejects a missing or wrong bearer", async () => {
    expect((await POST(req(TEXT, {}, null))).status).toBe(401);
    expect((await POST(req(TEXT, {}, "nope"))).status).toBe(401);
    expect((await POST(req(TEXT, { authorization: "tok" }, null))).status).toBe(401);
    expect(ingest).not.toHaveBeenCalled();
  });

  it("accepts the share text as text/plain", async () => {
    const res = await POST(req(TEXT, { "content-type": "text/plain; charset=utf-8" }));
    expect(res.status).toBe(201);
    expect(ingest).toHaveBeenCalledWith(TEXT, { source: "shortcut" });
    expect(await res.json()).toEqual({
      ok: true,
      duplicate: false,
      updated: false,
      ingestId: "ing_1",
      workoutId: "strong-x",
      summary: null,
      // the shortcut notification stays one line; details carries the breakdown
      text: "logged push day",
      details: DETAILS,
      warnings: [],
      links: [],
    });
  });

  it("treats a body with no content type as text", async () => {
    await POST(req(new TextEncoder().encode(TEXT)));
    expect(ingest).toHaveBeenCalledWith(TEXT, { source: "shortcut" });
  });

  it("accepts json {text, source}", async () => {
    await POST(req(JSON.stringify({ text: TEXT, source: "api" }), { "content-type": "application/json" }));
    expect(ingest).toHaveBeenLastCalledWith(TEXT, { source: "api" });
    // clients can't claim to be the bot
    await POST(req(JSON.stringify({ text: TEXT, source: "telegram" }), { "content-type": "application/json" }));
    expect(ingest).toHaveBeenLastCalledWith(TEXT, { source: "api" });
    await POST(req(JSON.stringify({ text: TEXT, source: "shortcut" }), { "content-type": "application/json" }));
    expect(ingest).toHaveBeenLastCalledWith(TEXT, { source: "shortcut" });
  });

  it("accepts a form field", async () => {
    const body = new URLSearchParams({ text: TEXT }).toString();
    await POST(req(body, { "content-type": "application/x-www-form-urlencoded" }));
    expect(ingest).toHaveBeenCalledWith(TEXT, { source: "shortcut" });
  });

  it("400s on bad json and empty text", async () => {
    expect((await POST(req("{nope", { "content-type": "application/json" }))).status).toBe(400);
    expect((await POST(req(JSON.stringify({ body: TEXT }), { "content-type": "application/json" }))).status).toBe(400);
    expect((await POST(req("   \n", { "content-type": "text/plain" }))).status).toBe(400);
    expect(ingest).not.toHaveBeenCalled();
  });

  it("413s over 64kb, by header or by actual bytes", async () => {
    const big = "x".repeat(64 * 1024 + 1);
    expect((await POST(req(big, { "content-type": "text/plain", "content-length": String(big.length) }))).status).toBe(413);
    const stream = new ReadableStream({
      start(c) {
        c.enqueue(new TextEncoder().encode(big));
        c.close();
      },
    });
    const streamed = new Request(URL_, {
      method: "POST",
      body: stream,
      headers: { authorization: "Bearer tok" },
      duplex: "half",
    } as RequestInit);
    expect((await POST(streamed)).status).toBe(413);
    expect(ingest).not.toHaveBeenCalled();
    // exactly at the limit is fine
    expect((await POST(req("x".repeat(64 * 1024), { "content-type": "text/plain" }))).status).toBe(201);
  });

  it("returns 200 for a duplicate and 422 for an empty parse", async () => {
    ingest.mockResolvedValueOnce(result("duplicate"));
    const dup = await POST(req(TEXT, { "content-type": "text/plain" }));
    expect(dup.status).toBe(200);
    expect(await dup.json()).toMatchObject({ ok: true, duplicate: true, updated: false, workoutId: "strong-x" });

    ingest.mockResolvedValueOnce(result("updated"));
    const upd = await POST(req(TEXT, { "content-type": "text/plain" }));
    expect(upd.status).toBe(200);
    expect(await upd.json()).toMatchObject({ ok: true, duplicate: false, updated: true, workoutId: "strong-x", details: DETAILS });

    ingest.mockResolvedValueOnce(result("empty"));
    const empty = await POST(req("hello", { "content-type": "text/plain" }));
    expect(empty.status).toBe(422);
    expect(await empty.json()).toMatchObject({ ok: false, error: expect.stringMatching(/no exercises/), ingestId: "ing_1" });
  });

  it("500s without leaking internals when ingest throws", async () => {
    ingest.mockRejectedValueOnce(new Error("connection string postgres://secret"));
    const res = await POST(req(TEXT, { "content-type": "text/plain" }));
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("secret");
  });
});
