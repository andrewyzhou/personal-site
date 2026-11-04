import { describe, it, expect } from "vitest";
import {
  backoffAfter429,
  decideBudget,
  estimateSchedule,
  formatDuration,
  nextQuarterHour,
  nextUtcMidnight,
  parseRateLimitHeaders,
  parseWindowPair,
  type RateLimitState,
} from "../strava-rate-limit";

const T = Date.UTC(2026, 10, 4, 10, 7, 30); // 10:07:30 utc
const MIN = 60_000;

function state(read: [number, number], overall: [number, number] = [0, 0], observedAt = T): RateLimitState {
  return {
    overall: { limit: { short: 200, daily: 2000 }, usage: { short: overall[0], daily: overall[1] } },
    read: { limit: { short: 100, daily: 1000 }, usage: { short: read[0], daily: read[1] } },
    observedAt,
  };
}

describe("header parsing", () => {
  it("parses 15min,daily pairs", () => {
    expect(parseWindowPair("200,2000")).toEqual({ short: 200, daily: 2000 });
    expect(parseWindowPair(" 12 , 345 ")).toEqual({ short: 12, daily: 345 });
  });

  it("rejects malformed pairs", () => {
    expect(parseWindowPair(null)).toBeNull();
    expect(parseWindowPair("")).toBeNull();
    expect(parseWindowPair("200")).toBeNull();
    expect(parseWindowPair("a,b")).toBeNull();
    expect(parseWindowPair("1,2,3")).toBeNull();
  });

  it("reads overall and read limits from response headers", () => {
    const h = new Headers({
      "X-RateLimit-Limit": "200,2000",
      "X-RateLimit-Usage": "31,410",
      "X-ReadRateLimit-Limit": "100,1000",
      "X-ReadRateLimit-Usage": "30,400",
    });
    expect(parseRateLimitHeaders(h, T)).toEqual({
      overall: { limit: { short: 200, daily: 2000 }, usage: { short: 31, daily: 410 } },
      read: { limit: { short: 100, daily: 1000 }, usage: { short: 30, daily: 400 } },
      observedAt: T,
    });
  });

  it("leaves a limit null when its headers are absent", () => {
    const s = parseRateLimitHeaders(new Headers({ "X-RateLimit-Limit": "200,2000", "X-RateLimit-Usage": "1,1" }), T);
    expect(s.overall).not.toBeNull();
    expect(s.read).toBeNull();
  });
});

describe("window boundaries", () => {
  it("next utc quarter hour", () => {
    expect(new Date(nextQuarterHour(T)).toISOString()).toBe("2026-11-04T10:15:00.000Z");
    expect(new Date(nextQuarterHour(Date.UTC(2026, 10, 4, 10, 15))).toISOString()).toBe("2026-11-04T10:30:00.000Z");
    expect(new Date(nextQuarterHour(Date.UTC(2026, 10, 4, 23, 59))).toISOString()).toBe("2026-11-05T00:00:00.000Z");
  });

  it("next utc midnight", () => {
    expect(new Date(nextUtcMidnight(T)).toISOString()).toBe("2026-11-05T00:00:00.000Z");
  });
});

describe("decideBudget", () => {
  it("goes with no headers yet", () => {
    expect(decideBudget(null, T)).toEqual({ action: "go" });
  });

  it("goes with headroom", () => {
    expect(decideBudget(state([50, 300]), T)).toEqual({ action: "go" });
  });

  it("waits for the next quarter hour inside the 15-min margin", () => {
    const d = decideBudget(state([90, 300]), T);
    expect(d.action).toBe("wait");
    if (d.action === "wait") {
      expect(d.untilMs).toBe(Date.UTC(2026, 10, 4, 10, 15));
      expect(d.reason).toMatch(/read 15-min/);
    }
  });

  it("checks the overall limit too", () => {
    const d = decideBudget(state([10, 300], [195, 500]), T);
    expect(d.action).toBe("wait");
    if (d.action === "wait") expect(d.reason).toMatch(/overall 15-min/);
  });

  it("stops near the daily budget", () => {
    const d = decideBudget(state([10, 960]), T);
    expect(d).toEqual({
      action: "stop",
      reason: "read daily budget near exhaustion (960/1000)",
      resumeAfterMs: Date.UTC(2026, 10, 5),
    });
  });

  it("can wait for midnight instead of stopping", () => {
    const d = decideBudget(state([10, 960]), T, { stopOnDaily: false });
    expect(d).toMatchObject({ action: "wait", untilMs: Date.UTC(2026, 10, 5) });
  });

  it("treats usage observed in an earlier window as reset", () => {
    // observed at 10:07 with the short window spent; now it's 10:16
    expect(decideBudget(state([99, 300]), T + 9 * MIN)).toEqual({ action: "go" });
    // daily spent yesterday, now past midnight
    expect(decideBudget(state([0, 999]), Date.UTC(2026, 10, 5, 0, 1))).toEqual({ action: "go" });
  });

  it("honors custom margins", () => {
    expect(decideBudget(state([95, 300]), T, { margin: { short: 0, daily: 0 } })).toEqual({ action: "go" });
    expect(decideBudget(state([100, 300]), T, { margin: { short: 0, daily: 0 } }).action).toBe("wait");
  });
});

describe("backoffAfter429", () => {
  it("first 429 waits for the quarter boundary", () => {
    expect(backoffAfter429(1, T)).toBe(Date.UTC(2026, 10, 4, 10, 15) + 5000);
  });

  it("repeated 429s back off at least as long as the boundary, growing", () => {
    const a = backoffAfter429(3, T);
    const b = backoffAfter429(6, T);
    expect(a).toBeGreaterThanOrEqual(nextQuarterHour(T));
    expect(b).toBeGreaterThanOrEqual(a);
    expect(b - T).toBeLessThanOrEqual(15 * MIN + 5000);
  });
});

describe("estimateSchedule", () => {
  it("fits small runs in one window", () => {
    const e = estimateSchedule(10, { now: T, requestMs: 1000 });
    expect(e).toMatchObject({ requests: 10, quarters: 1, days: 1, wallMs: 10_000 });
  });

  it("spills into later quarters at the per-quarter budget", () => {
    const now = Date.UTC(2026, 10, 4, 10, 0);
    const e = estimateSchedule(200, { now, requestMs: 100, perQuarter: 90, perDay: 950 });
    expect(e.quarters).toBe(3);
    // third window starts at 10:30, 20 requests in it
    expect(e.finishAtMs).toBe(Date.UTC(2026, 10, 4, 10, 30) + 20 * 100);
  });

  it("waits for utc midnight when the daily budget runs out", () => {
    const now = Date.UTC(2026, 10, 4, 0, 0);
    const e = estimateSchedule(1148, { now, requestMs: 100, perQuarter: 90, perDay: 950 });
    expect(e.days).toBe(2);
    expect(e.finishAtMs).toBeGreaterThan(Date.UTC(2026, 10, 5));
    // 198 requests on day 2: 3 quarters (90 + 90 + 18)
    expect(e.finishAtMs).toBe(Date.UTC(2026, 10, 5, 0, 30) + 18 * 100);
  });

  it("zero requests take no time", () => {
    expect(estimateSchedule(0, { now: T })).toMatchObject({ quarters: 0, days: 0, wallMs: 0 });
  });

  it("formats durations", () => {
    expect(formatDuration(0)).toBe("0m");
    expect(formatDuration(95 * MIN)).toBe("1h 35m");
    expect(formatDuration(26 * 60 * MIN + 5 * MIN)).toBe("1d 2h 5m");
  });
});
