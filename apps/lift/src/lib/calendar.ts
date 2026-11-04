// month grid for the history calendar. local time throughout: a workout
// belongs to the day it started on the phone's clock.

export interface MonthRef {
  year: number;
  /** 0-11 */
  month: number;
}

export interface DayCell {
  /** "yyyy-mm-dd", local */
  key: string;
  day: number;
}

/** weeks of 7; null pads days outside the month. sunday-first by default (ios us style). */
export function monthGrid(ref: MonthRef, weekStartsOn: 0 | 1 = 0): (DayCell | null)[][] {
  const first = new Date(ref.year, ref.month, 1);
  const days = new Date(ref.year, ref.month + 1, 0).getDate();
  const lead = (first.getDay() - weekStartsOn + 7) % 7;
  const cells: (DayCell | null)[] = Array.from({ length: lead }, () => null);
  for (let d = 1; d <= days; d++) cells.push({ key: dayKeyOf(ref.year, ref.month, d), day: d });
  while (cells.length % 7) cells.push(null);
  const weeks: (DayCell | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/** single-letter weekday headers in grid order */
export function weekdayLabels(weekStartsOn: 0 | 1 = 0): string[] {
  const all = ["s", "m", "t", "w", "t", "f", "s"];
  return [...all.slice(weekStartsOn), ...all.slice(0, weekStartsOn)];
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function dayKeyOf(year: number, month: number, day: number): string {
  return `${year}-${pad(month + 1)}-${pad(day)}`;
}

export function dayKey(ms: number): string {
  const d = new Date(ms);
  return dayKeyOf(d.getFullYear(), d.getMonth(), d.getDate());
}

export function monthOf(ms: number): MonthRef {
  const d = new Date(ms);
  return { year: d.getFullYear(), month: d.getMonth() };
}

export function shiftMonth(ref: MonthRef, delta: number): MonthRef {
  const total = ref.year * 12 + ref.month + delta;
  return { year: Math.floor(total / 12), month: ((total % 12) + 12) % 12 };
}

export function sameMonth(a: MonthRef, b: MonthRef): boolean {
  return a.year === b.year && a.month === b.month;
}

const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

export function monthLabel(ref: MonthRef): string {
  return `${MONTHS[ref.month]} ${ref.year}`;
}

/** count of items per local day */
export function countByDay<T>(items: readonly T[], at: (item: T) => number): Map<string, number> {
  const out = new Map<string, number>();
  for (const item of items) {
    const k = dayKey(at(item));
    out.set(k, (out.get(k) ?? 0) + 1);
  }
  return out;
}
