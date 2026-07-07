import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { redisGet, redisSet, redisDel } = vi.hoisted(() => ({
  redisGet: vi.fn(),
  redisSet: vi.fn(),
  redisDel: vi.fn(),
}));

vi.mock("@upstash/redis", () => ({
  Redis: class {
    get = redisGet;
    set = redisSet;
    del = redisDel;
  },
}));

const { getAllActivities, isStravaApiEnabled } = vi.hoisted(() => ({
  getAllActivities: vi.fn(),
  isStravaApiEnabled: vi.fn(),
}));

// no session in these tests: exercises the x-admin-secret fallback path
vi.mock("@/lib/auth", () => ({
  getSessionUser: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/strava", () => ({
  getAllActivities: (...args: unknown[]) => getAllActivities(...args),
  isStravaApiEnabled: () => isStravaApiEnabled(),
}));

import { POST } from "@/app/api/strava/activities/full-refresh/route";

const SECRET = "test-secret";

function makeRequest(secret?: string): Request {
  return new Request("http://localhost/api/strava/activities/full-refresh", {
    method: "POST",
    headers: secret ? { "x-admin-secret": secret } : {},
  });
}

beforeEach(() => {
  redisGet.mockReset();
  redisSet.mockReset();
  redisDel.mockReset();
  getAllActivities.mockReset();
  isStravaApiEnabled.mockReset();
  isStravaApiEnabled.mockReturnValue(true);
  process.env.ADMIN_API_SECRET = SECRET;
});

afterEach(() => {
  delete process.env.ADMIN_API_SECRET;
});

describe("POST /api/strava/activities/full-refresh", () => {
  it("rejects requests without the admin secret", async () => {
    const res = await POST(makeRequest());
    expect(res.status).toBe(401);
    expect(getAllActivities).not.toHaveBeenCalled();
  });

  it("rejects requests with a wrong secret", async () => {
    const res = await POST(makeRequest("wrong"));
    expect(res.status).toBe(401);
  });

  it("rejects everything when ADMIN_API_SECRET is unset (fail closed)", async () => {
    delete process.env.ADMIN_API_SECRET;
    const res = await POST(makeRequest(""));
    expect(res.status).toBe(401);
  });

  it("refuses to run while the strava api is disabled (a zero-activity 'success' would wipe history)", async () => {
    isStravaApiEnabled.mockReturnValue(false);

    const res = await POST(makeRequest(SECRET));

    expect(res.status).toBe(503);
    expect(getAllActivities).not.toHaveBeenCalled();
    expect(redisSet).not.toHaveBeenCalled();
  });

  it("never touches stored data when the strava fetch fails (regression: delete-first wiped history)", async () => {
    getAllActivities.mockRejectedValue(new Error("403 Application Inactive"));

    const res = await POST(makeRequest(SECRET));

    expect(res.status).toBe(500);
    expect(redisDel).not.toHaveBeenCalled();
    expect(redisSet).not.toHaveBeenCalled();
  });

  it("refuses to overwrite a non-empty history with an empty fetch result (review finding: enabled-but-tokenless wipe)", async () => {
    getAllActivities.mockResolvedValue([]);
    redisGet.mockResolvedValue({
      activities: [{ id: 1, date: "2026-07-01" }],
      lastFetchedAt: 123,
    });

    const res = await POST(makeRequest(SECRET));

    expect(res.status).toBe(409);
    expect(redisSet).not.toHaveBeenCalled();
  });

  it("allows an empty fetch result when nothing is stored (bootstrap case)", async () => {
    getAllActivities.mockResolvedValue([]);
    redisGet.mockResolvedValue(null);
    redisSet.mockResolvedValue("OK");

    const res = await POST(makeRequest(SECRET));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.count).toBe(0);
  });

  it("stores fetched activities on success without deleting first", async () => {
    getAllActivities.mockResolvedValue([
      { id: 1, date: "2026-07-01" },
      { id: 2, date: "2026-07-03" },
    ]);
    redisSet.mockResolvedValue("OK");

    const res = await POST(makeRequest(SECRET));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.count).toBe(2);
    expect(redisDel).not.toHaveBeenCalled();
    // stored sorted by date descending
    const stored = redisSet.mock.calls[0][1];
    expect(stored.activities[0].date).toBe("2026-07-03");
  });
});
