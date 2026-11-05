// date windows for bot questions. everything is a local wall-clock date
// ('YYYY-MM-DD') in LIFT_TIMEZONE, because lift_workouts.started_local is
// wall-clock text: a window is a plain string range, no zone math in sql.

import { addDays } from "../time";

export interface DateWindow {
  /** human label used in replies: "last week", "since oct 1" */
  label: string;
  /** inclusive 'YYYY-MM-DD' */
  start: string;
  /** exclusive 'YYYY-MM-DD' */
  end: string;
}

export const MONTH_NAMES = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MONTH_WORDS: Record<string, number> = {
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
};
const WEEKDAY_WORDS: Record<string, number> = {
  sun: 0, sunday: 0,
  mon: 1, monday: 1,
  tue: 2, tues: 2, tuesday: 2,
  wed: 3, wednesday: 3,
  thu: 4, thur: 4, thurs: 4, thursday: 4,
  fri: 5, friday: 5,
  sat: 6, saturday: 6,
};
const WEEKDAY_NAMES = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

const MONTH_RE = Object.keys(MONTH_WORDS).sort((a, b) => b.length - a.length).join("|");
const WEEKDAY_RE = Object.keys(WEEKDAY_WORDS).sort((a, b) => b.length - a.length).join("|");

const pad = (n: number) => String(n).padStart(2, "0");

function ymd(y: number, m: number, d: number): string {
  return `${y}-${pad(m)}-${pad(d)}`;
}

function parts(date: string): [number, number, number] {
  const [y, m, d] = date.split("-").map(Number);
  return [y, m, d];
}

/** 0 = sunday */
export function weekdayOf(date: string): number {
  const [y, m, d] = parts(date);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function validDate(y: number, m: number, d: number): boolean {
  return m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m);
}

/** monday on or before `date` */
export function mondayOf(date: string): string {
  return addDays(date, -((weekdayOf(date) + 6) % 7));
}

function monthStart(y: number, m: number): string {
  return ymd(y, m, 1);
}

function nextMonthStart(y: number, m: number): string {
  return m === 12 ? ymd(y + 1, 1, 1) : ymd(y, m + 1, 1);
}

/** whole days between two dates (b - a) */
export function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = parts(a);
  const [by, bm, bd] = parts(b);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000);
}

/** "2026-10-01" -> "oct 1" (year only when it isn't `today`'s) */
export function shortDate(date: string, today: string): string {
  const [y, m, d] = parts(date);
  const base = `${MONTH_NAMES[m - 1]} ${d}`;
  return y === parts(today)[0] ? base : `${base} ${y}`;
}

/** a date with no year is the most recent one that isn't in the future */
function pastYear(m: number, d: number, today: string): number {
  const [ty] = parts(today);
  return ymd(ty, m, d) > today ? ty - 1 : ty;
}

/** most recent `weekday` on or before today ("last" skips today) */
function recentWeekday(weekday: number, today: string, skipToday: boolean): string {
  let back = (weekdayOf(today) - weekday + 7) % 7;
  if (back === 0 && skipToday) back = 7;
  return addDays(today, -back);
}

/** "oct 1", "1 oct", "10/1", "10/1/25", "2026-10-01", "monday" -> a date, or null */
export function parseDay(text: string, today: string): string | null {
  const t = text.trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  if (m) return validDate(+m[1], +m[2], +m[3]) ? ymd(+m[1], +m[2], +m[3]) : null;
  m = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?$/.exec(t);
  if (m) {
    const mo = +m[1];
    const d = +m[2];
    const y = m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : pastYear(mo, d, today);
    return validDate(y, mo, d) ? ymd(y, mo, d) : null;
  }
  m = new RegExp(`^(${MONTH_RE}) (\\d{1,2})(?:st|nd|rd|th)?(?: (\\d{4}))?$`).exec(t);
  if (!m) {
    const r = new RegExp(`^(\\d{1,2})(?:st|nd|rd|th)? (?:of )?(${MONTH_RE})(?: (\\d{4}))?$`).exec(t);
    if (r) m = [r[0], r[2], r[1], r[3]] as unknown as RegExpExecArray;
  }
  if (m) {
    const mo = MONTH_WORDS[m[1]];
    const d = +m[2];
    const y = m[3] ? +m[3] : pastYear(mo, d, today);
    return validDate(y, mo, d) ? ymd(y, mo, d) : null;
  }
  m = new RegExp(`^(${MONTH_RE})(?: (\\d{4}))?$`).exec(t);
  if (m) {
    const mo = MONTH_WORDS[m[1]];
    const y = m[2] ? +m[2] : pastYear(mo, 1, today);
    return monthStart(y, mo);
  }
  if (t in WEEKDAY_WORDS) return recentWeekday(WEEKDAY_WORDS[t], today, false);
  if (t === "today") return today;
  if (t === "yesterday") return addDays(today, -1);
  return null;
}

function day(date: string, label: string): DateWindow {
  return { label, start: date, end: addDays(date, 1) };
}

function lastDays(n: number, today: string, label: string): DateWindow {
  return { label, start: addDays(today, -(n - 1)), end: addDays(today, 1) };
}

function monthWindow(y: number, m: number, label: string): DateWindow {
  return { label, start: monthStart(y, m), end: nextMonthStart(y, m) };
}

type Rule = [RegExp, (m: RegExpExecArray, today: string) => DateWindow | null];

const DAY_TEXT = `\\d{4}-\\d{1,2}-\\d{1,2}|\\d{1,2}\\/\\d{1,2}(?:\\/\\d{2,4})?|(?:${MONTH_RE}) \\d{1,2}(?:st|nd|rd|th)?(?: \\d{4})?|\\d{1,2}(?:st|nd|rd|th)? (?:of )?(?:${MONTH_RE})(?: \\d{4})?|(?:${MONTH_RE})(?: \\d{4})?|${WEEKDAY_RE}`;

// order matters: longer, more specific phrases first
const RULES: Rule[] = [
  [
    /\b(?:in |over |for |during )?(?:the )?(?:last|past|previous) (\d{1,3}) (days?|weeks?|months?)\b/,
    (m, today) => {
      const n = Math.max(1, +m[1]);
      const unit = m[2].replace(/s$/, "");
      const days = unit === "day" ? n : unit === "week" ? n * 7 : n * 30;
      return lastDays(days, today, `last ${n} ${unit}${n === 1 ? "" : "s"}`);
    },
  ],
  [/\b(?:in |over |for |during )?(?:the )?(?:this )?past (week|month|year)\b/, (m, today) => {
    const days = m[1] === "week" ? 7 : m[1] === "month" ? 30 : 365;
    return lastDays(days, today, `past ${m[1]}`);
  }],
  [new RegExp(`\\b(?:since|from|after) (${DAY_TEXT})\\b`), (m, today) => {
    const start = parseDay(m[1], today);
    if (!start || start > today) return null;
    return { label: `since ${shortDate(start, today)}`, start, end: addDays(today, 1) };
  }],
  [new RegExp(`\\b(?:on|last) (${WEEKDAY_RE})\\b`), (m, today) => {
    const skip = m[0].startsWith("last");
    const d = recentWeekday(WEEKDAY_WORDS[m[1]], today, skip);
    return day(d, `${WEEKDAY_NAMES[weekdayOf(d)]} ${shortDate(d, today)}`);
  }],
  [new RegExp(`\\bon (${DAY_TEXT})\\b`), (m, today) => {
    const d = parseDay(m[1], today);
    return d ? day(d, `on ${shortDate(d, today)}`) : null;
  }],
  [new RegExp(`\\b(?:in|during|for) (${MONTH_RE})(?: (\\d{4}))?\\b`), (m, today) => {
    const mo = MONTH_WORDS[m[1]];
    const y = m[2] ? +m[2] : pastYear(mo, 1, today);
    const label = `in ${MONTH_NAMES[mo - 1]}${m[2] ? ` ${y}` : ""}`;
    return monthWindow(y, mo, label);
  }],
  [/\b(?:in|during) (20\d\d)\b/, (m) => ({ label: `in ${m[1]}`, start: `${m[1]}-01-01`, end: `${+m[1] + 1}-01-01` })],
  [/\b(this|last|previous) week\b/, (m, today) => {
    const mon = mondayOf(today);
    if (m[1] === "this") return { label: "this week", start: mon, end: addDays(mon, 7) };
    return { label: "last week", start: addDays(mon, -7), end: mon };
  }],
  [/\b(this|last|previous) month\b/, (m, today) => {
    const [y, mo] = parts(today);
    if (m[1] === "this") return monthWindow(y, mo, "this month");
    return mo === 1 ? monthWindow(y - 1, 12, "last month") : monthWindow(y, mo - 1, "last month");
  }],
  [/\b(this|last|previous) year\b/, (m, today) => {
    const y = parts(today)[0] - (m[1] === "this" ? 0 : 1);
    return { label: m[1] === "this" ? "this year" : "last year", start: `${y}-01-01`, end: `${y + 1}-01-01` };
  }],
  [/\b(?:today|tonight|this morning|this afternoon|this evening)\b/, (_m, today) => day(today, "today")],
  [/\b(?:yesterday|last night)\b/, (_m, today) => day(addDays(today, -1), "yesterday")],
  [/\b(?:this|the) weekend\b|\blast weekend\b/, (m, today) => {
    // the weekend that has started (or the one just past)
    const sat = m[0].startsWith("last") ? addDays(mondayOf(today), -2) : addDays(mondayOf(today), 5);
    const start = sat > today ? addDays(sat, -7) : sat;
    return { label: m[0].startsWith("last") ? "last weekend" : "this weekend", start, end: addDays(start, 2) };
  }],
  [new RegExp(`\\b(${WEEKDAY_RE})\\b`), (m, today) => {
    const d = recentWeekday(WEEKDAY_WORDS[m[1]], today, false);
    return day(d, `${WEEKDAY_NAMES[weekdayOf(d)]} ${shortDate(d, today)}`);
  }],
];

const ALL_TIME_RE = /\b(?:of all time|all time|all-time|ever|lifetime|overall)\b/;

export interface WindowMatch {
  window: DateWindow | null;
  /** "ever" / "all time" was said */
  allTime: boolean;
  /** the text with the window phrase cut out */
  rest: string;
}

/** pulls the first time phrase out of a normalized question */
export function extractWindow(text: string, today: string): WindowMatch {
  let rest = text;
  let allTime = false;
  if (ALL_TIME_RE.test(rest)) {
    allTime = true;
    rest = rest.replace(ALL_TIME_RE, " ");
  }
  for (const [re, build] of RULES) {
    const m = re.exec(rest);
    if (!m) continue;
    const window = build(m, today);
    if (!window) continue;
    rest = (rest.slice(0, m.index) + " " + rest.slice(m.index + m[0].length)).replace(/\s+/g, " ").trim();
    return { window, allTime: false, rest };
  }
  return { window: null, allTime, rest: rest.replace(/\s+/g, " ").trim() };
}
