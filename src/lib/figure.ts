// the activity figure's arithmetic: one cell per day over a year, four kinds
// of event. pure (no fetch, no dom) so it can be tested and shared by the
// server and the browser. days are iso strings (yyyy-mm-dd) throughout and
// all date math is done in utc, so a viewer's timezone can't shift a day.

export const FIGURE_KINDS = ["writing", "library", "workouts", "code"] as const;
export type FigureKind = (typeof FIGURE_KINDS)[number];

// writing and library are rare and marked loudly; workouts and code happen
// most days and make the quiet texture underneath
export const LOUD_KINDS: readonly FigureKind[] = ["writing", "library"];
export const QUIET_KINDS: readonly FigureKind[] = ["workouts", "code"];

export interface FigureEvent {
  kind: FigureKind;
  date: string;
  label: string;
  href?: string;
  // how much: minutes for a workout, a count for code; unused for the rest
  amount?: number;
}

export type Level = 0 | 1 | 2 | 3 | 4;

export interface FigureDay {
  date: string;
  // false for the cells that only pad the first and last week
  inRange: boolean;
  future: boolean;
  events: FigureEvent[];
  workouts: Level;
  code: Level;
}

export interface FigureRange {
  // "past" or a year like "2026"
  id: string;
  from: string;
  to: string;
}

export interface Figure {
  range: FigureRange;
  // columns: each a sunday-to-saturday week
  weeks: FigureDay[][];
  // where each month's label sits: the first week that starts in it
  months: { month: number; week: number }[];
  totals: Record<FigureKind, number>;
}

const DAY_MS = 86_400_000;
const toMs = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
const toIso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export function addDays(iso: string, n: number): string {
  return toIso(toMs(iso) + n * DAY_MS);
}

// 0 = sunday
export function weekday(iso: string): number {
  return new Date(toMs(iso)).getUTCDay();
}

export function yearRange(year: number): FigureRange {
  return { id: String(year), from: `${year}-01-01`, to: `${year}-12-31` };
}

// the 53 weeks ending with the week `today` is in, like a contribution graph
export function pastYearRange(today: string): FigureRange {
  const weekStart = addDays(today, -weekday(today));
  return { id: "past", from: addDays(weekStart, -52 * 7), to: today };
}

// every range worth offering, newest first: the past year, then each
// calendar year from this one back to the earliest with anything in it
export function figureRanges(today: string, earliest: string | undefined): FigureRange[] {
  const thisYear = Number(today.slice(0, 4));
  const firstYear = Math.min(thisYear, earliest ? Number(earliest.slice(0, 4)) : thisYear);
  const years: FigureRange[] = [];
  for (let y = thisYear; y >= firstYear; y--) years.push(yearRange(y));
  return [pastYearRange(today), ...years];
}

// a short session still counts; a long day reads strongest
export function workoutLevel(minutes: number, sessions: number): Level {
  if (sessions <= 0) return 0;
  if (minutes >= 120) return 4;
  if (minutes >= 60) return 3;
  if (minutes >= 30) return 2;
  return 1;
}

export function codeLevel(count: number): Level {
  if (count <= 0) return 0;
  if (count >= 20) return 4;
  if (count >= 10) return 3;
  if (count >= 4) return 2;
  return 1;
}

export function buildFigure(range: FigureRange, events: FigureEvent[], today: string): Figure {
  const byDay = new Map<string, FigureEvent[]>();
  for (const e of events) {
    if (e.date < range.from || e.date > range.to) continue;
    const list = byDay.get(e.date);
    if (list) list.push(e);
    else byDay.set(e.date, [e]);
  }

  const first = addDays(range.from, -weekday(range.from));
  const last = addDays(range.to, 6 - weekday(range.to));
  const weeks: FigureDay[][] = [];
  const months: Figure["months"] = [];
  const totals: Record<FigureKind, number> = { writing: 0, library: 0, workouts: 0, code: 0 };

  for (let start = first; start <= last; start = addDays(start, 7)) {
    const week: FigureDay[] = [];
    for (let i = 0; i < 7; i++) {
      const date = addDays(start, i);
      const inRange = date >= range.from && date <= range.to;
      const dayEvents = inRange ? (byDay.get(date) ?? []) : [];
      const workouts = dayEvents.filter((e) => e.kind === "workouts");
      const code = dayEvents.filter((e) => e.kind === "code");
      const codeCount = code.reduce((n, e) => n + (e.amount ?? 1), 0);
      for (const e of dayEvents) totals[e.kind] += e.kind === "code" ? (e.amount ?? 1) : 1;
      week.push({
        date,
        inRange,
        future: date > today,
        events: dayEvents,
        workouts: workoutLevel(workouts.reduce((n, e) => n + (e.amount ?? 0), 0), workouts.length),
        code: codeLevel(codeCount),
      });
    }
    // a month is labelled at the first week whose sunday falls in it (and in range)
    const sunday = week[0];
    const month = Number(sunday.date.slice(5, 7)) - 1;
    const prev = months[months.length - 1];
    if (sunday.inRange && (!prev || prev.month !== month)) months.push({ month, week: weeks.length });
    weeks.push(week);
  }
  return { range, weeks, months, totals };
}

// how strongly a day's cell is filled, given which kinds are being shown
export function quietLevel(day: FigureDay, visible: ReadonlySet<FigureKind>): Level {
  const w = visible.has("workouts") ? day.workouts : 0;
  const c = visible.has("code") ? day.code : 0;
  return (w > c ? w : c) as Level;
}

export function loudEvents(day: FigureDay, kind: FigureKind, visible: ReadonlySet<FigureKind>): FigureEvent[] {
  return visible.has(kind) ? day.events.filter((e) => e.kind === kind) : [];
}

export interface PlacedLabel {
  week: number;
  text: string;
  // 0 sits right above the grid; higher rows sit above it
  row: number;
  // how many columns the label covers, ending at its own week
  span: number;
}

// puts a title above each post's column. a label ends at its column and runs
// to the left, so the newest post (at the right edge) always has room; its
// line down to the cell is its right edge. two rules keep it legible: labels
// in one row never overlap, and a label never runs under the line of a
// label in a higher row. a title that doesn't fit is cut with an ellipsis,
// and one with no room at all is left off (its cell is still marked).
export function placeLabels(
  items: { week: number; text: string }[],
  opts: { colsPerChar: number; rows?: number; minCols?: number },
): PlacedLabel[] {
  const rows = opts.rows ?? 2;
  const minCols = opts.minCols ?? 3;
  const sorted = [...items].sort((a, b) => a.week - b.week);
  const lastInRow: number[] = Array(rows).fill(-1);
  const placed: PlacedLabel[] = [];

  for (const item of sorted) {
    const wanted = Math.max(1, Math.ceil(item.text.length * opts.colsPerChar) + 1);
    for (let row = 0; row < rows; row++) {
      // nearest thing to the left this label must stay clear of
      let wall = lastInRow[row];
      for (let above = row + 1; above < rows; above++) wall = Math.max(wall, lastInRow[above]);
      const room = item.week - wall;
      if (room < Math.min(wanted, minCols)) continue;
      const span = Math.min(wanted, room);
      const chars = Math.floor((span - 1) / opts.colsPerChar);
      const text = item.text.length > chars ? `${item.text.slice(0, Math.max(1, chars - 1)).trimEnd()}…` : item.text;
      placed.push({ week: item.week, text, row, span });
      lastInRow[row] = item.week;
      break;
    }
  }
  return placed;
}

// "2026-11-10" → "tue, nov 10, 2026"
export function dayLabel(iso: string): string {
  return new Date(toMs(iso)).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).toLowerCase();
}

export const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

// 95 → "1h 35m", 40 → "40m"
export function minutesLabel(minutes: number): string {
  const m = Math.round(minutes);
  if (m < 60) return `${m}m`;
  return m % 60 === 0 ? `${m / 60}h` : `${Math.floor(m / 60)}h ${m % 60}m`;
}
