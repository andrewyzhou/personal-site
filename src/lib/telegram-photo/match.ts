// which activity a photo sent to the bot belongs to. pure: the caller loads
// candidate activities and hands them in.
//
// order: the photo's capture time (exif, only kept when the image was sent as
// a file), then the caption ("#512", "11/4 night", "yesterday morning"), then
// the most recent activity. ambiguity is reported, never fatal: the closest
// candidate wins and the reply says so.

export interface PhotoCandidate {
  id: number;
  name: string;
  sportType: string;
  startUtcMs: number;
  elapsedS: number;
  utcOffsetMin: number;
  /** 'YYYY-MM-DD' wall-clock date */
  localDate: string;
  /** 'HH:MM' wall-clock start */
  localTime: string;
}

export type MatchedBy = "photo-time" | "caption-id" | "caption-date" | "latest";

export interface PhotoMatch {
  activityId: number;
  by: MatchedBy;
  /** other activities that fit as well; the reply names them */
  alsoMatched: number[];
}

/** how far outside an activity a capture time may fall and still belong to it */
export const PHOTO_SLACK_MIN = 30;

export type DayPart = "morning" | "noon" | "afternoon" | "evening" | "night";

export interface CaptionHint {
  id: number | null;
  /** 'YYYY-MM-DD' */
  date: string | null;
  part: DayPart | null;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

// minutes after local midnight; night runs past midnight
const PARTS: Record<DayPart, [number, number]> = {
  morning: [4 * 60, 12 * 60],
  noon: [11 * 60, 14 * 60],
  afternoon: [12 * 60, 17 * 60],
  evening: [17 * 60, 21 * 60],
  night: [19 * 60, 28 * 60],
};

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function addDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

function validDate(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const t = new Date(Date.UTC(y, m - 1, d));
  if (t.getUTCMonth() !== m - 1) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

/** month/day without a year: the latest such date on or before today */
function recentDate(month: number, day: number, today: string): string | null {
  const year = Number(today.slice(0, 4));
  const thisYear = validDate(year, month, day);
  if (thisYear && thisYear <= today) return thisYear;
  return validDate(year - 1, month, day);
}

/**
 * "#512" → that activity id; "11/4", "11/4/26", "nov 4", "today", "yesterday",
 * "last night" → a date; "morning", "afternoon", "evening", "night", "lunch" →
 * a part of the day. `today` is the owner's local date when the message was sent.
 */
export function parseCaption(caption: string | null | undefined, today: string): CaptionHint {
  const out: CaptionHint = { id: null, date: null, part: null };
  const text = (caption ?? "").toLowerCase();
  if (!text.trim()) return out;

  const id = /#(\d{1,12})\b/.exec(text);
  if (id) out.id = Number(id[1]);

  const slash = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?\b/.exec(text);
  const named = new RegExp(`\\b(${MONTHS.join("|")})[a-z]*\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`).exec(text);
  if (slash) {
    const [m, d] = [Number(slash[1]), Number(slash[2])];
    if (slash[3]) {
      const y = slash[3].length === 2 ? 2000 + Number(slash[3]) : Number(slash[3]);
      out.date = validDate(y, m, d);
    } else out.date = recentDate(m, d, today);
  } else if (named) {
    out.date = recentDate(MONTHS.indexOf(named[1]) + 1, Number(named[2]), today);
  } else if (/\blast night\b/.test(text)) {
    out.date = addDays(today, -1);
    out.part = "night";
  } else if (/\byesterday\b/.test(text)) {
    out.date = addDays(today, -1);
  } else if (/\b(today|tonight|this (morning|afternoon|evening))\b/.test(text)) {
    out.date = today;
  }

  if (!out.part) {
    if (/\b(night|tonight)\b/.test(text)) out.part = "night";
    else if (/\bevening\b/.test(text)) out.part = "evening";
    else if (/\bafternoon\b/.test(text)) out.part = "afternoon";
    else if (/\b(noon|lunch)\b/.test(text)) out.part = "noon";
    else if (/\bmorning\b/.test(text)) out.part = "morning";
  }
  return out;
}

function endMs(c: PhotoCandidate): number {
  return c.startUtcMs + Math.max(0, c.elapsedS) * 1000;
}

/**
 * capture time → the activity whose [start - 30 min, end + 30 min] holds it.
 * `takenAt` is an instant; `takenAtLocal` is a wall clock with no offset, read
 * in each candidate's own offset. several fit: the one the time is inside (or
 * nearest to) wins, then the later start.
 */
export function matchByCaptureTime(
  capture: { takenAt: string | null; takenAtLocal: string | null },
  candidates: readonly PhotoCandidate[],
): PhotoMatch | null {
  const instantFor = (c: PhotoCandidate): number | null => {
    if (capture.takenAt) {
      const ms = Date.parse(capture.takenAt);
      return Number.isFinite(ms) ? ms : null;
    }
    if (capture.takenAtLocal) {
      const ms = Date.parse(`${capture.takenAtLocal}Z`) - c.utcOffsetMin * 60_000;
      return Number.isFinite(ms) ? ms : null;
    }
    return null;
  };
  const slack = PHOTO_SLACK_MIN * 60_000;
  const fits: { c: PhotoCandidate; distance: number }[] = [];
  for (const c of candidates) {
    const t = instantFor(c);
    if (t === null) continue;
    const start = c.startUtcMs;
    const end = endMs(c);
    if (t < start - slack || t > end + slack) continue;
    fits.push({ c, distance: t < start ? start - t : t > end ? t - end : 0 });
  }
  return pick(fits, "photo-time");
}

/** caption date (+ part of day) → an activity that day, nearest the part's window */
export function matchByCaptionDate(hint: CaptionHint, candidates: readonly PhotoCandidate[]): PhotoMatch | null {
  if (!hint.date) return null;
  const date = hint.date;
  const next = addDays(date, 1);
  const fits: { c: PhotoCandidate; distance: number }[] = [];
  for (const c of candidates) {
    const [h, m] = c.localTime.split(":").map(Number);
    let minute: number;
    if (c.localDate === date) minute = h * 60 + m;
    // "night" reaches past midnight into the next date
    else if (c.localDate === next && hint.part === "night" && h * 60 + m < PARTS.night[1] - 24 * 60) minute = 24 * 60 + h * 60 + m;
    else continue;
    // no part given: every activity that day fits equally, and the later one wins the tie
    let distance = 0;
    if (hint.part) {
      const [lo, hi] = PARTS[hint.part];
      distance = minute < lo ? lo - minute : minute > hi ? minute - hi : 0;
    }
    fits.push({ c, distance });
  }
  return pick(fits, "caption-date");
}

/** the most recent activity that started before the photo was sent */
export function matchLatest(sentAtMs: number, candidates: readonly PhotoCandidate[]): PhotoMatch | null {
  let best: PhotoCandidate | null = null;
  for (const c of candidates) {
    if (c.startUtcMs > sentAtMs) continue;
    if (!best || c.startUtcMs > best.startUtcMs) best = c;
  }
  return best ? { activityId: best.id, by: "latest", alsoMatched: [] } : null;
}

function pick(fits: { c: PhotoCandidate; distance: number }[], by: MatchedBy): PhotoMatch | null {
  if (!fits.length) return null;
  fits.sort((a, b) => a.distance - b.distance || b.c.startUtcMs - a.c.startUtcMs || a.c.id - b.c.id);
  return { activityId: fits[0].c.id, by, alsoMatched: fits.slice(1).map((f) => f.c.id) };
}
