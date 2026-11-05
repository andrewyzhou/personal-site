import { describe, it, expect, vi, beforeEach } from "vitest";

const { load } = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock("@/lib/db", () => ({}));
vi.mock("@/lib/lift/export", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/lift/export")>();
  return { ...actual, loadExportWorkouts: () => load() };
});

import { GET } from "@/app/api/lift/export/route";
import { ExportTooLargeError, type ExportWorkout } from "@/lib/lift/export";

const WORKOUT: ExportWorkout = {
  id: "strong-a",
  title: "Push Day",
  startedLocal: "2026-10-27T18:00",
  startedAt: null,
  endedAt: null,
  durationS: 2700,
  notes: "private note",
  source: "strong-text",
  status: "finished",
  templateId: null,
  workingSets: 1,
  volumeKg: 419.6,
  exercises: [
    {
      exerciseId: "bench-press-barbell",
      name: "Bench Press (Barbell)",
      nameRaw: "Bench Press (Barbell)",
      position: 0,
      notes: null,
      supersetGroup: null,
      restS: null,
      sets: [
        {
          position: 0,
          kind: "normal",
          weight: 185,
          unit: "lb",
          weightKg: 83.9,
          reps: 5,
          durationS: null,
          distanceM: null,
          rpe: null,
          bodyweight: false,
          note: null,
          completed: true,
          e1rmKg: 97.9,
        },
      ],
    },
  ],
};

function req(query: string, token: string | null = "app-token") {
  const headers: Record<string, string> = {};
  if (token) headers.authorization = `Bearer ${token}`;
  return new Request(`http://localhost/api/lift/export${query}`, { headers });
}

describe("GET /api/lift/export", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-05T03:00:00Z"));
    process.env.LIFT_APP_TOKEN = "app-token";
    process.env.LIFT_INGEST_TOKEN = "ingest-token";
    process.env.LIFT_TIMEZONE = "America/Los_Angeles";
    load.mockResolvedValue([WORKOUT]);
  });

  it("401s without a valid token and never loads", async () => {
    expect((await GET(req("?format=csv", null))).status).toBe(401);
    expect((await GET(req("?format=csv", "nope"))).status).toBe(401);
    delete process.env.LIFT_APP_TOKEN;
    delete process.env.LIFT_INGEST_TOKEN;
    expect((await GET(req("?format=csv", "app-token"))).status).toBe(401);
    expect(load).not.toHaveBeenCalled();
  });

  it("accepts either lift token", async () => {
    expect((await GET(req("?format=csv", "app-token"))).status).toBe(200);
    expect((await GET(req("?format=csv", "ingest-token"))).status).toBe(200);
  });

  it("400s on an unknown format", async () => {
    const res = await GET(req("?format=xml"));
    expect(res.status).toBe(400);
    expect(load).not.toHaveBeenCalled();
  });

  it("csv is an attachment named for the local date", async () => {
    const res = await GET(req("?format=csv"));
    expect(res.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    // 7pm on nov 4 in la, though utc has rolled over
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="lifts-2026-11-04.csv"');
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.text();
    expect(body.split("\n")[1]).toBe("2026-10-27 18:00:00,Push Day,45m,Bench Press (Barbell),1,185,5,0,0,,private note,,lb,");
  });

  it("defaults to csv", async () => {
    const res = await GET(req(""));
    expect(res.headers.get("content-disposition")).toMatch(/\.csv"$/);
  });

  it("json carries the version, timezone and notes", async () => {
    const res = await GET(req("?format=json"));
    expect(res.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="lifts-2026-11-04.json"');
    const doc = await res.json();
    expect(doc).toMatchObject({
      version: 1,
      timezone: "America/Los_Angeles",
      counts: { workouts: 1, exercises: 1, sets: 1 },
      workouts: [{ id: "strong-a", notes: "private note" }],
    });
  });

  it("413s with a clear message past the cap", async () => {
    load.mockRejectedValueOnce(new ExportTooLargeError(250_000));
    const res = await GET(req("?format=json"));
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ ok: false, error: "export too large: 250,000 sets (limit 200,000)" });
  });

  it("500s without leaking db errors", async () => {
    load.mockRejectedValueOnce(new Error("password=hunter2"));
    const res = await GET(req("?format=csv"));
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain("hunter2");
  });
});
