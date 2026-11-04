import { describe, it, expect, vi, beforeEach } from "vitest";

const { push, snapshot } = vi.hoisted(() => ({ push: vi.fn(), snapshot: vi.fn() }));
vi.mock("@/lib/lift/sync/push", () => ({ pushMutations: (...a: unknown[]) => push(...a) }));
vi.mock("@/lib/lift/sync/snapshot", () => ({ loadSnapshot: () => snapshot() }));

import { POST } from "@/app/api/lift/sync/route";
import { GET } from "@/app/api/lift/sync/snapshot/route";

const URL_ = "http://localhost/api/lift/sync";
const BODY = { protocol: 1, deviceId: "phone-1234abcd", mutations: [{ seq: 4, entity: "bodyweight", op: "delete", id: "bw1", payload: null, at: 1 }] };

function req(body: BodyInit | null, token: string | null = "tok", headers: Record<string, string> = {}): Request {
  const h: Record<string, string> = { "content-type": "application/json", ...headers };
  if (token) h.authorization = `Bearer ${token}`;
  return new Request(URL_, { method: "POST", body, headers: h });
}

const OK = { ok: true, appliedThrough: 4, applied: 1, skipped: 0, rejected: [] };

describe("POST /api/lift/sync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.LIFT_APP_TOKEN = "tok";
    push.mockResolvedValue(OK);
  });

  it("fails closed without a configured token", async () => {
    delete process.env.LIFT_APP_TOKEN;
    expect((await POST(req(JSON.stringify(BODY)))).status).toBe(401);
    expect(push).not.toHaveBeenCalled();
  });

  it("rejects a missing or wrong bearer", async () => {
    expect((await POST(req(JSON.stringify(BODY), null))).status).toBe(401);
    expect((await POST(req(JSON.stringify(BODY), "nope"))).status).toBe(401);
    // the ingest token is a different secret
    process.env.LIFT_INGEST_TOKEN = "ingest";
    expect((await POST(req(JSON.stringify(BODY), "ingest"))).status).toBe(401);
    expect(push).not.toHaveBeenCalled();
  });

  it("applies a valid push and returns the push response", async () => {
    const res = await POST(req(JSON.stringify(BODY)));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(OK);
    expect(push).toHaveBeenCalledWith("phone-1234abcd", [{ seq: 4, raw: BODY.mutations[0] }]);
  });

  it("400s on bad json or an invalid envelope", async () => {
    expect((await POST(req("{nope"))).status).toBe(400);
    const bad = await POST(req(JSON.stringify({ ...BODY, protocol: 9 })));
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ ok: false, error: "unsupported protocol (expected 1)" });
    expect((await POST(req(JSON.stringify({ ...BODY, deviceId: "x" })))).status).toBe(400);
    expect((await POST(req(JSON.stringify({ ...BODY, mutations: [{ seq: 2 }, { seq: 1 }] })))).status).toBe(400);
    expect(push).not.toHaveBeenCalled();
  });

  it("passes envelope-valid but bad mutations through to be rejected individually", async () => {
    const body = { ...BODY, mutations: [{ seq: 1, entity: "nope" }] };
    expect((await POST(req(JSON.stringify(body)))).status).toBe(200);
    expect(push).toHaveBeenCalledOnce();
  });

  it("413s over 2mb, by header or by actual bytes", async () => {
    const big = JSON.stringify({ ...BODY, pad: "x".repeat(2 * 1024 * 1024) });
    expect((await POST(req(big, "tok", { "content-length": String(big.length) }))).status).toBe(413);
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
    expect(push).not.toHaveBeenCalled();
  });

  it("500s without leaking internals when the batch fails", async () => {
    push.mockRejectedValueOnce(new Error("connection string postgres://secret"));
    const res = await POST(req(JSON.stringify(BODY)));
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("secret");
  });
});

describe("GET /api/lift/sync/snapshot", () => {
  const get = (token: string | null = "tok") =>
    GET(new Request(`${URL_}/snapshot`, { headers: token ? { authorization: `Bearer ${token}` } : {} }));

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.LIFT_APP_TOKEN = "tok";
    snapshot.mockResolvedValue({ protocol: 1, generatedAt: 1, workouts: [] });
  });

  it("requires the app bearer", async () => {
    expect((await get(null)).status).toBe(401);
    expect((await get("nope")).status).toBe(401);
    delete process.env.LIFT_APP_TOKEN;
    expect((await get()).status).toBe(401);
    expect(snapshot).not.toHaveBeenCalled();
  });

  it("returns the snapshot uncached", async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ protocol: 1, generatedAt: 1, workouts: [] });
  });

  it("500s without leaking internals", async () => {
    snapshot.mockRejectedValueOnce(new Error("postgres://secret"));
    const res = await get();
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("secret");
  });
});
