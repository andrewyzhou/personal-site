import { describe, it, expect, vi, beforeEach } from "vitest";

const { relink } = vi.hoisted(() => ({ relink: vi.fn() }));
vi.mock("@/lib/lift/link", () => ({ relinkRecentWorkouts: (...a: unknown[]) => relink(...a) }));
vi.mock("@/lib/admin-auth", async () => {
  const { NextResponse } = await import("next/server");
  return { unauthorizedResponse: () => NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
});

import { GET } from "@/app/api/lift/cron/link/route";

function req(auth?: string) {
  return new Request("http://localhost/api/lift/cron/link", { headers: auth ? { authorization: auth } : {} });
}

describe("GET /api/lift/cron/link", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = "cron";
    relink.mockResolvedValue({ checked: 3, linked: 1 });
  });

  it("requires the cron secret", async () => {
    expect((await GET(req())).status).toBe(401);
    expect((await GET(req("Bearer wrong"))).status).toBe(401);
    delete process.env.CRON_SECRET;
    expect((await GET(req("Bearer cron"))).status).toBe(401);
    expect(relink).not.toHaveBeenCalled();
  });

  it("relinks the last two weeks", async () => {
    const res = await GET(req("Bearer cron"));
    expect(res.status).toBe(200);
    expect(relink).toHaveBeenCalledWith(14);
    expect(await res.json()).toEqual({ ok: true, checked: 3, linked: 1 });
  });

  it("500s when the sweep throws", async () => {
    relink.mockRejectedValueOnce(new Error("boom"));
    expect((await GET(req("Bearer cron"))).status).toBe(500);
  });
});
