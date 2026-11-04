// strava api rate limits, pure. documented defaults: 200 requests / 15 min and
// 2000 / day overall, of which reads are 100 / 15 min and 1000 / day. the short
// window resets on utc quarter hours, the daily one at utc midnight. responses
// carry the live numbers as "15min,daily" pairs:
//   X-RateLimit-Limit / X-RateLimit-Usage           (overall)
//   X-ReadRateLimit-Limit / X-ReadRateLimit-Usage   (reads)

export interface WindowPair {
  short: number; // 15-minute window
  daily: number;
}

export interface LimitState {
  limit: WindowPair;
  usage: WindowPair;
}

export interface RateLimitState {
  overall: LimitState | null;
  read: LimitState | null;
  observedAt: number; // epoch ms the headers were read
}

export const DEFAULT_LIMITS = {
  overall: { short: 200, daily: 2000 },
  read: { short: 100, daily: 1000 },
} as const;

// headroom kept free so other callers (the 30-min import cron) never hit a 429
export const DEFAULT_MARGIN = { short: 10, daily: 50 } as const;

const QUARTER_MS = 15 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export function parseWindowPair(value: string | null | undefined): WindowPair | null {
  if (!value) return null;
  const parts = value.split(",").map((p) => p.trim());
  if (parts.length !== 2 || parts.some((p) => !/^\d+$/.test(p))) return null;
  return { short: Number(parts[0]), daily: Number(parts[1]) };
}

interface HeaderLike {
  get(name: string): string | null;
}

export function parseRateLimitHeaders(headers: HeaderLike, now = Date.now()): RateLimitState {
  const pair = (limitName: string, usageName: string): LimitState | null => {
    const limit = parseWindowPair(headers.get(limitName));
    const usage = parseWindowPair(headers.get(usageName));
    return limit && usage ? { limit, usage } : null;
  };
  return {
    overall: pair("x-ratelimit-limit", "x-ratelimit-usage"),
    read: pair("x-readratelimit-limit", "x-readratelimit-usage"),
    observedAt: now,
  };
}

export function nextQuarterHour(now: number): number {
  return Math.floor(now / QUARTER_MS) * QUARTER_MS + QUARTER_MS;
}

export function nextUtcMidnight(now: number): number {
  return Math.floor(now / DAY_MS) * DAY_MS + DAY_MS;
}

// usage observed in an earlier window has since reset
function currentUsage(state: LimitState, observedAt: number, now: number): WindowPair {
  return {
    short: nextQuarterHour(observedAt) <= now ? 0 : state.usage.short,
    daily: nextUtcMidnight(observedAt) <= now ? 0 : state.usage.daily,
  };
}

export type BudgetDecision =
  | { action: "go" }
  | { action: "wait"; untilMs: number; reason: string }
  | { action: "stop"; reason: string; resumeAfterMs: number };

export interface BudgetOptions {
  margin?: WindowPair;
  // stop (exit cleanly) on daily exhaustion instead of sleeping until midnight
  stopOnDaily?: boolean;
}

// may the next read go out now? checks both the overall and the read limits
export function decideBudget(state: RateLimitState | null, now: number, opts: BudgetOptions = {}): BudgetDecision {
  if (!state) return { action: "go" };
  const margin = opts.margin ?? DEFAULT_MARGIN;
  const stopOnDaily = opts.stopOnDaily ?? true;
  for (const [name, s] of [["overall", state.overall], ["read", state.read]] as const) {
    if (!s) continue;
    const used = currentUsage(s, state.observedAt, now);
    if (used.daily >= s.limit.daily - margin.daily) {
      const midnight = nextUtcMidnight(now);
      const reason = `${name} daily budget near exhaustion (${used.daily}/${s.limit.daily})`;
      if (stopOnDaily) return { action: "stop", reason, resumeAfterMs: midnight };
      return { action: "wait", untilMs: midnight, reason };
    }
    if (used.short >= s.limit.short - margin.short) {
      return {
        action: "wait",
        untilMs: nextQuarterHour(now),
        reason: `${name} 15-min budget near exhaustion (${used.short}/${s.limit.short})`,
      };
    }
  }
  return { action: "go" };
}

// after a 429: the window is spent, so wait for the next quarter hour, and back
// off further on repeated 429s (another caller may be burning the budget)
export function backoffAfter429(attempt: number, now: number): number {
  const boundary = nextQuarterHour(now) + 5_000;
  const exp = now + Math.min(2 ** attempt * 30_000, QUARTER_MS);
  return attempt <= 1 ? boundary : Math.max(boundary, exp);
}

export interface ScheduleEstimate {
  requests: number;
  quarters: number; // distinct 15-min windows used
  days: number; // distinct utc days used
  finishAtMs: number;
  wallMs: number;
}

// simulate sending n reads under the limits (minus margins), starting from
// zero usage at `now`. requestMs is the time a request + store takes.
export function estimateSchedule(
  n: number,
  opts: { now: number; requestMs?: number; perQuarter?: number; perDay?: number }
): ScheduleEstimate {
  const requestMs = opts.requestMs ?? 700;
  const perQuarter = opts.perQuarter ?? DEFAULT_LIMITS.read.short - DEFAULT_MARGIN.short;
  const perDay = opts.perDay ?? DEFAULT_LIMITS.read.daily - DEFAULT_MARGIN.daily;
  if (perQuarter <= 0 || perDay <= 0) throw new Error("budget must be positive");
  let t = opts.now;
  let quarter = Math.floor(t / QUARTER_MS);
  let day = Math.floor(t / DAY_MS);
  let usedQ = 0;
  let usedD = 0;
  let quarters = n > 0 ? 1 : 0;
  let days = n > 0 ? 1 : 0;
  for (let i = 0; i < n; i++) {
    if (usedD >= perDay) t = nextUtcMidnight(t);
    else if (usedQ >= perQuarter) t = nextQuarterHour(t);
    const q = Math.floor(t / QUARTER_MS);
    const d = Math.floor(t / DAY_MS);
    if (d !== day) {
      day = d;
      days++;
      usedD = 0;
    }
    if (q !== quarter) {
      quarter = q;
      quarters++;
      usedQ = 0;
    }
    usedQ++;
    usedD++;
    t += requestMs;
  }
  return { requests: n, quarters, days, finishAtMs: t, wallMs: t - opts.now };
}

export function formatDuration(ms: number): string {
  const totalMin = Math.round(ms / 60_000);
  const d = Math.floor(totalMin / 1440);
  const h = Math.floor((totalMin % 1440) / 60);
  const m = totalMin % 60;
  return [d ? `${d}d` : "", h ? `${h}h` : "", `${m}m`].filter(Boolean).join(" ");
}
