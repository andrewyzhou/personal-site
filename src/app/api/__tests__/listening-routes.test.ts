import { describe, it, expect, vi, beforeEach } from "vitest";

const { run, configured, requireAdmin } = vi.hoisted(() => ({
  run: vi.fn(),
  configured: vi.fn(),
  requireAdmin: vi.fn(),
}));

vi.mock("@/lib/listening/service", () => {
  class ListeningNotMigratedError extends Error {
    constructor() {
      super("listening tables do not exist yet (migration not applied)");
      this.name = "ListeningNotMigratedError";
    }
  }
  return {
    ListeningNotMigratedError,
    isListeningConfigured: () => configured(),
    runListeningCollect: (...a: unknown[]) => run(...a),
  };
});
vi.mock("@/lib/admin-auth", async () => {
  const { NextResponse } = await import("next/server");
  return {
    unauthorizedResponse: () => NextResponse.json({ error: "unauthorized" }, { status: 401 }),
    requireAdmin: (r: Request) => requireAdmin(r),
  };
});
vi.mock("@/lib/log", () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { NextResponse } from "next/server";
import { GET } from "@/app/api/listening/cron/collect/route";
import { POST } from "@/app/api/admin/listening/sync/route";
import { ListeningNotMigratedError } from "@/lib/listening/service";

const okRun = { ok: true, inserted: 2, cursor: "2024-03-01T12:00:00.000Z", dryRun: false };

function cronReq(auth?: string) {
  return new Request("http://localhost/api/listening/cron/collect", { headers: auth ? { authorization: auth } : {} });
}

describe("GET /api/listening/cron/collect", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = "cron";
    configured.mockReturnValue(true);
    run.mockResolvedValue(okRun);
  });

  it("requires the cron secret", async () => {
    expect((await GET(cronReq())).status).toBe(401);
    expect((await GET(cronReq("Bearer wrong"))).status).toBe(401);
    expect((await GET(cronReq("cron"))).status).toBe(401);
    delete process.env.CRON_SECRET;
    expect((await GET(cronReq("Bearer cron"))).status).toBe(401);
    expect((await GET(cronReq("Bearer undefined"))).status).toBe(401);
    expect(run).not.toHaveBeenCalled();
  });

  it("skips when spotify isn't configured", async () => {
    configured.mockReturnValue(false);
    const res = await GET(cronReq("Bearer cron"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, skipped: "spotify not configured" });
    expect(run).not.toHaveBeenCalled();
  });

  it("returns the run", async () => {
    const res = await GET(cronReq("Bearer cron"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(okRun);
    expect(run).toHaveBeenCalledWith();
  });

  it("502s when the run fails", async () => {
    run.mockResolvedValueOnce({ ok: false, error: "spotify 503", cursor: null });
    const res = await GET(cronReq("Bearer cron"));
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ ok: false, error: "spotify 503" });
  });

  it("500s when the run throws", async () => {
    run.mockRejectedValueOnce(new Error("boom"));
    const res = await GET(cronReq("Bearer cron"));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ ok: false, error: "boom" });
  });

  it("skips quietly before the migration", async () => {
    run.mockRejectedValueOnce(new ListeningNotMigratedError());
    const res = await GET(cronReq("Bearer cron"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, skipped: "not migrated" });
  });
});

function syncReq(body?: unknown) {
  return new Request("http://localhost/api/admin/listening/sync", {
    method: "POST",
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("POST /api/admin/listening/sync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAdmin.mockResolvedValue(null);
    run.mockResolvedValue(okRun);
  });

  it("requires an admin", async () => {
    requireAdmin.mockResolvedValueOnce(NextResponse.json({ error: "unauthorized" }, { status: 401 }));
    const res = await POST(syncReq({ dryRun: true }));
    expect(res.status).toBe(401);
    expect(run).not.toHaveBeenCalled();
  });

  it("passes dryRun from the body", async () => {
    const res = await POST(syncReq({ dryRun: true }));
    expect(res.status).toBe(200);
    expect(run).toHaveBeenCalledWith({ dryRun: true });
  });

  it("only a literal true is a dry run", async () => {
    await POST(syncReq({ dryRun: "yes" }));
    expect(run).toHaveBeenLastCalledWith({ dryRun: false });
    await POST(syncReq({}));
    expect(run).toHaveBeenLastCalledWith({ dryRun: false });
  });

  it("no body or bad json is a real run", async () => {
    await POST(syncReq());
    expect(run).toHaveBeenLastCalledWith({ dryRun: false });
    await POST(syncReq("{nope"));
    expect(run).toHaveBeenLastCalledWith({ dryRun: false });
  });

  it("maps failures to 502 and throws to 500", async () => {
    run.mockResolvedValueOnce({ ok: false, error: "spotify 503" });
    expect((await POST(syncReq())).status).toBe(502);
    run.mockRejectedValueOnce(new Error("not configured"));
    const res = await POST(syncReq());
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ ok: false, error: "not configured" });
  });
});
