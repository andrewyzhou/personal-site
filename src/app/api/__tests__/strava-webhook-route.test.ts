import { describe, it, expect, vi, beforeEach } from "vitest";

const { sync, applyUpdate, hide, enabled, afterFns } = vi.hoisted(() => ({
  sync: vi.fn(),
  applyUpdate: vi.fn(),
  hide: vi.fn(),
  enabled: vi.fn(),
  afterFns: [] as (() => Promise<void>)[],
}));

vi.mock("next/server", async (orig) => ({
  ...(await orig<typeof import("next/server")>()),
  after: (fn: () => Promise<void>) => afterFns.push(fn),
}));

vi.mock("@/lib/strava-sync", () => ({
  syncStravaActivities: () => sync(),
  applyStravaUpdate: (id: number) => applyUpdate(id),
  hideStravaActivity: (id: number) => hide(id),
}));

vi.mock("@/lib/strava", () => ({ isStravaApiEnabled: () => enabled() }));

import { GET, POST } from "@/app/api/strava/webhook/route";

function event(body: unknown): Request {
  return new Request("http://localhost/api/strava/webhook", { method: "POST", body: JSON.stringify(body) });
}

async function flush() {
  for (const fn of afterFns.splice(0)) await fn();
}

describe("strava webhook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    afterFns.length = 0;
    enabled.mockReturnValue(true);
    process.env.STRAVA_WEBHOOK_VERIFY_TOKEN = "vt";
  });

  it("echoes the challenge only with the right verify token", async () => {
    const ok = await GET(new Request("http://x/?hub.mode=subscribe&hub.verify_token=vt&hub.challenge=abc"));
    expect(await ok.json()).toEqual({ "hub.challenge": "abc" });
    const bad = await GET(new Request("http://x/?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=abc"));
    expect(bad.status).toBe(403);
  });

  it("syncs on create, after responding", async () => {
    const res = await POST(event({ object_type: "activity", object_id: 1, aspect_type: "create" }));
    expect(res.status).toBe(200);
    expect(sync).not.toHaveBeenCalled();
    await flush();
    expect(sync).toHaveBeenCalledOnce();
  });

  it("falls back to a sync when an update targets an unsynced activity", async () => {
    applyUpdate.mockResolvedValue(false);
    await POST(event({ object_type: "activity", object_id: 7, aspect_type: "update" }));
    await flush();
    expect(applyUpdate).toHaveBeenCalledWith(7);
    expect(sync).toHaveBeenCalledOnce();
  });

  it("routes deletes to the verified hide", async () => {
    await POST(event({ object_type: "activity", object_id: 9, aspect_type: "delete" }));
    await flush();
    expect(hide).toHaveBeenCalledWith(9);
  });

  it("ignores athlete events and does nothing while disabled", async () => {
    await POST(event({ object_type: "athlete", object_id: 1, aspect_type: "update" }));
    enabled.mockReturnValue(false);
    await POST(event({ object_type: "activity", object_id: 1, aspect_type: "create" }));
    expect(afterFns).toHaveLength(0);
  });
});
