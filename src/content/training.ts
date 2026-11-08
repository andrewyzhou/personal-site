import { desc, eq } from "drizzle-orm";
import { getDb, activities } from "@/lib/db";
import { isPublic, publicCalendarActivity } from "@/lib/public-activity";
import { liftCalendarEntries } from "@/lib/lift/public";
import { formatClockDuration, formatMiles, sportIcon, sportLabel } from "@/lib/activity-format";
import type { CalendarActivity } from "@/lib/calendar-activity";
import { sportFamily, type SportFamily } from "@/lib/sport-types";
import { log } from "@/lib/log";

// the training hub: recorded activities and lift-only sessions as one feed,
// newest first, already formatted for display.

export type SportGroup = "runs" | "rides" | "hikes" | "walks" | "lifts" | "other";

// by sport family (src/lib/sport-types.ts): every run variant is a run, every
// ride variant a ride, snowshoeing a hike…
const GROUP: Partial<Record<SportFamily, SportGroup>> = {
  run: "runs",
  ride: "rides",
  hike: "hikes",
  walk: "walks",
  strength: "lifts",
};

export function sportGroup(type: string): SportGroup {
  return GROUP[sportFamily(type)] ?? "other";
}

export interface TrainingItem {
  key: string;
  href: string | null;
  name: string;
  group: SportGroup;
  sport: string; // display label ("hike", "lift")
  icon: string; // file under /icons/activities
  date: string; // yyyy-mm-dd
  dateLabel: string; // "nov 2"
  stat: string; // the one number that matters most for this kind of session
  distanceM: number;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

export function dayLabel(iso: string): string {
  const [, m, d] = iso.split("-").map(Number);
  return `${MONTHS[(m ?? 1) - 1]} ${d}`;
}

export function toTrainingItem(a: CalendarActivity): TrainingItem {
  const group = sportGroup(a.type);
  const usesDistance = a.distance > 100 && group !== "lifts";
  return {
    key: a.href ?? `a${a.id}`,
    href: a.href ?? `/activities/${a.id}`,
    name: a.name,
    group,
    sport: sportLabel(a.type),
    icon: sportIcon(a.type),
    date: a.date,
    dateLabel: dayLabel(a.date),
    stat: a.liftSummary ?? (usesDistance ? formatMiles(a.distance) : formatClockDuration(a.duration || a.elapsedTime)),
    distanceM: usesDistance ? a.distance : 0,
  };
}

// the design harness renders from frozen public data instead of a database
async function fixtureFeed(): Promise<CalendarActivity[] | null> {
  if (process.env.DESIGN_FIXTURES !== "1" || process.env.VERCEL_ENV === "production") return null;
  const { readFile } = await import("fs/promises");
  const path = await import("path");
  const raw = await readFile(path.join(process.cwd(), "tests/design/fixtures/api/activities.json"), "utf8");
  const json = JSON.parse(raw) as { activities?: CalendarActivity[]; lifts?: CalendarActivity[] };
  return [...(json.activities ?? []), ...(json.lifts ?? [])];
}

export async function loadTrainingFeed(): Promise<TrainingItem[]> {
  const fixture = await fixtureFeed().catch(() => null);
  if (fixture) return fixture.map(toTrainingItem).sort((x, y) => (x.date < y.date ? 1 : x.date > y.date ? -1 : 0));
  let recorded: CalendarActivity[] = [];
  try {
    const rows = await getDb()
      .select()
      .from(activities)
      .where(eq(activities.hidden, false))
      .orderBy(desc(activities.localDate), desc(activities.localTime));
    recorded = rows.filter(isPublic).map(publicCalendarActivity);
  } catch (error) {
    log.error("content:training", "activities load failed", error);
  }
  const lifts = await liftCalendarEntries();
  return [...recorded, ...lifts]
    .map(toTrainingItem)
    .sort((x, y) => (x.date < y.date ? 1 : x.date > y.date ? -1 : 0));
}

export interface TrainingSummary {
  thisWeek: number;
  yearDistanceMi: string;
  year: number;
  total: number;
}

// "this week" counts from monday, in the same local dates the feed uses
export function summarize(items: TrainingItem[], today: string): TrainingSummary {
  const t = new Date(today + "T00:00:00Z");
  const monday = new Date(t);
  monday.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7));
  const mondayIso = monday.toISOString().slice(0, 10);
  const year = Number(today.slice(0, 4));
  const meters = items.filter((i) => i.date.startsWith(String(year))).reduce((s, i) => s + i.distanceM, 0);
  return {
    thisWeek: items.filter((i) => i.date >= mondayIso && i.date <= today).length,
    yearDistanceMi: (meters / 1609.344).toFixed(1),
    year,
    total: items.length,
  };
}
