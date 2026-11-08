import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { inserted, insertFails } = vi.hoisted(() => ({
  inserted: [] as Record<string, unknown>[][],
  insertFails: { value: false },
}));

vi.mock("@/lib/db", () => ({
  syncEvents: {},
  getDb: () => ({
    insert: () => ({
      values: async (rows: Record<string, unknown>[]) => {
        if (insertFails.value) throw new Error("db down");
        inserted.push(rows);
      },
    }),
  }),
}));

import {
  currentRun,
  formatEvent,
  isDryRun,
  loggedFetch,
  parseSince,
  redactUrl,
  syncEvent,
  syncFetch,
  throwIfUnavailable,
  UpstreamUnavailableError,
  withSyncRun,
} from "@/lib/sync-log";

let lines: string[] = [];

beforeEach(() => {
  inserted.length = 0;
  insertFails.value = false;
  lines = [];
  process.env.DATABASE_URL = "postgres://test";
  vi.spyOn(console, "log").mockImplementation((l: unknown) => void lines.push(String(l)));
  vi.spyOn(console, "warn").mockImplementation((l: unknown) => void lines.push(String(l)));
});

afterEach(() => {
  delete process.env.DATABASE_URL;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("redactUrl", () => {
  it("keeps host, path and harmless params; redacts anything that could be a secret", () => {
    expect(redactUrl("https://intervals.icu/api/v1/athlete/0/activities?oldest=2026-10-01")).toEqual({
      host: "intervals.icu",
      path: "/api/v1/athlete/0/activities?oldest=2026-10-01",
    });
    const r = redactUrl("https://x.test/a?access_token=abc&api_key=k&client_secret=s&code=c&limit=5");
    expect(r.path).toBe("/a?access_token=[redacted]&api_key=[redacted]&client_secret=[redacted]&code=[redacted]&limit=5");
    expect(redactUrl("not a url")).toEqual({ host: "?", path: "?" });
  });
});

describe("parseSince", () => {
  const now = new Date("2026-11-08T12:00:00Z");
  it("reads relative durations and iso dates", () => {
    expect(parseSince("2d", now)?.toISOString()).toBe("2026-11-06T12:00:00.000Z");
    expect(parseSince("6h", now)?.toISOString()).toBe("2026-11-08T06:00:00.000Z");
    expect(parseSince("30m", now)?.toISOString()).toBe("2026-11-08T11:30:00.000Z");
    expect(parseSince("1w", now)?.toISOString()).toBe("2026-11-01T12:00:00.000Z");
    expect(parseSince("2026-11-01", now)?.toISOString()).toBe("2026-11-01T00:00:00.000Z");
    expect(parseSince("soon", now)).toBeNull();
  });
});

describe("formatEvent", () => {
  it("one compact line", () => {
    const line = formatEvent({
      at: new Date("2026-11-08T12:00:00Z"),
      runId: "0123456789abcdef",
      trigger: "poll",
      source: "intervals",
      kind: "update_field",
      activityId: 5,
      externalId: "i100",
      detail: { field: "name", old: "a", new: "b" },
      durationMs: null,
    });
    expect(line).toBe('2026-11-08 12:00:00 01234567 poll intervals update_field #5 ext=i100 {"field":"name","old":"a","new":"b"}');
  });
});

describe("withSyncRun", () => {
  it("brackets a run with run_start/run_end and writes its events in one batch", async () => {
    const result = await withSyncRun({ trigger: "poll", source: "activities" }, async (run) => {
      expect(currentRun()).toBe(run);
      await syncEvent({ source: "intervals", kind: "insert", activityId: 1 });
      await syncEvent({ source: "intervals", kind: "merge", activityId: 2 });
      expect(inserted).toHaveLength(0); // buffered until the end
      return { inserted: 1 };
    });
    expect(result).toEqual({ inserted: 1 });
    expect(inserted).toHaveLength(1);
    const rows = inserted[0];
    expect(rows.map((r) => r.kind)).toEqual(["run_start", "insert", "merge", "run_end"]);
    expect(new Set(rows.map((r) => r.runId)).size).toBe(1);
    expect(rows.every((r) => r.trigger === "poll")).toBe(true);
    expect(rows[3].detail).toEqual({ inserted: 1 });
    expect(typeof rows[3].durationMs).toBe("number");
    expect(currentRun()).toBeUndefined();
  });

  it("a nested run joins the outer one", async () => {
    await withSyncRun({ trigger: "cron", source: "activities" }, async (outer) => {
      await withSyncRun({ trigger: "poll", source: "activities" }, async (inner) => {
        expect(inner).toBe(outer);
        await syncEvent({ source: "garmin", kind: "skip" });
      });
    });
    expect(inserted).toHaveLength(1);
    expect(inserted[0].map((r) => r.kind)).toEqual(["run_start", "skip", "run_end"]);
    expect(inserted[0][1].trigger).toBe("cron");
  });

  it("a failing run logs the error and still flushes, then rethrows", async () => {
    await expect(
      withSyncRun({ trigger: "poll", source: "activities" }, async () => {
        throw new Error("boom");
      })
    ).rejects.toThrow("boom");
    expect(inserted[0].map((r) => r.kind)).toEqual(["run_start", "error", "run_end"]);
    expect(inserted[0][1].detail).toEqual({ message: "boom" });
  });

  it("a failed write falls back to the console and never breaks the sync", async () => {
    insertFails.value = true;
    const r = await withSyncRun({ trigger: "poll", source: "activities" }, async () => {
      await syncEvent({ source: "intervals", kind: "insert", activityId: 7 });
      return "done";
    });
    expect(r).toBe("done");
    expect(lines.some((l) => l.includes("write failed (db down)"))).toBe(true);
    expect(lines.some((l) => l.startsWith("sync-log ") && l.includes(" insert #7"))).toBe(true);
  });

  it("long runs flush every 100 events", async () => {
    await withSyncRun({ trigger: "poll", source: "activities" }, async () => {
      for (let i = 0; i < 150; i++) await syncEvent({ source: "intervals", kind: "skip" });
    });
    expect(inserted.map((b) => b.length)).toEqual([100, 52]);
  });

  it("a dry run prints its events instead of writing them", async () => {
    await withSyncRun({ trigger: "script", source: "activities", dryRun: true }, async () => {
      expect(isDryRun()).toBe(true);
      await syncEvent({ source: "intervals", kind: "insert", detail: { action: "would insert" } });
    });
    expect(inserted).toHaveLength(0);
    expect(lines.filter((l) => l.startsWith("[dry run]"))).toHaveLength(3);
  });

  it("outside a run an event is written at once as its own run", async () => {
    await syncEvent({ source: "lift", kind: "insert", trigger: "telegram", externalId: "ing_1" });
    expect(inserted).toHaveLength(1);
    expect(inserted[0][0]).toMatchObject({ source: "lift", kind: "insert", trigger: "telegram", externalId: "ing_1" });
  });
});

describe("syncFetch", () => {
  it("logs method, host, path, status, bytes and duration; the caller still reads the body", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("hello", { status: 200, headers: { "content-type": "text/plain" } })));
    const body = await withSyncRun({ trigger: "poll", source: "activities" }, async () => {
      const res = await syncFetch("intervals", "https://intervals.icu/api/v1/x?api_key=sekret&n=1", { method: "post", headers: { Authorization: "Basic abc" } });
      expect(res.headers.get("content-type")).toBe("text/plain");
      return res.text();
    });
    expect(body).toBe("hello");
    const call = inserted[0].find((r) => r.kind === "api_call")!;
    expect(call.source).toBe("intervals");
    expect(call.detail).toEqual({ method: "POST", host: "intervals.icu", path: "/api/v1/x?api_key=[redacted]&n=1", status: 200, bytes: 5 });
    expect(typeof call.durationMs).toBe("number");
    expect(JSON.stringify(inserted)).not.toContain("sekret");
    expect(JSON.stringify(inserted)).not.toContain("Basic abc");
  });

  it("a network failure is logged and becomes an unavailable upstream", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError("fetch failed");
    }));
    await withSyncRun({ trigger: "poll", source: "activities" }, async () => {
      await expect(syncFetch("garmin", "https://g.test/a")).rejects.toBeInstanceOf(UpstreamUnavailableError);
    });
    const call = inserted[0].find((r) => r.kind === "api_call")!;
    expect(call.detail).toMatchObject({ status: null, error: "fetch failed" });
  });

  it("204 answers keep a null body", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 })));
    const res = await syncFetch("spotify", "https://api.spotify.com/v1/me/player/currently-playing");
    expect(res.status).toBe(204);
  });

  it("loggedFetch adapts it for clients that take a fetch", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}")));
    const f = loggedFetch("spotify");
    expect((await f(new URL("https://api.spotify.com/v1/me"))).status).toBe(200);
  });
});

describe("throwIfUnavailable", () => {
  it("429 and 5xx skip the source; anything else is the caller's to handle", () => {
    expect(() => throwIfUnavailable(new Response("", { status: 429 }), "garmin")).toThrow(UpstreamUnavailableError);
    expect(() => throwIfUnavailable(new Response("", { status: 502 }), "garmin")).toThrow("garmin answered 502");
    expect(() => throwIfUnavailable(new Response("", { status: 404 }), "garmin")).not.toThrow();
    expect(() => throwIfUnavailable(new Response("", { status: 401 }), "garmin")).not.toThrow();
  });
});
