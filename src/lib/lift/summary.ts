import { LB_PER_KG, type LinkRole, type WeightUnit } from "lift-core";
import type { IngestSummary } from "./plan";

// one-line, lowercase, human summary for api responses and the bot reply.
// names no outside services on purpose: it's shown to people.

export interface LinkedActivity {
  activityId: number;
  role: LinkRole;
  method: "auto" | "manual";
  deltaMin: number;
  sportType: string;
  /** 'HH:MM' local start of the recording */
  localTime: string;
}

const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** "2026-11-04T18:12" -> "wed nov 4" (weekday from the wall-clock date itself) */
export function formatLocalDay(startedLocal: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(startedLocal);
  if (!m) return "";
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return `${DAYS[d.getUTCDay()]} ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

/** "WeightTraining" -> "weight training" */
export function sportLabel(sportType: string): string {
  return sportType
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .toLowerCase()
    .trim();
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

export function formatVolume(volumeKg: number, unit: WeightUnit): string {
  const v = unit === "lb" ? volumeKg * LB_PER_KG : volumeKg;
  return `${Math.round(v).toLocaleString("en-US")} ${unit}`;
}

export function formatWatch(links: readonly LinkedActivity[]): string {
  const primary = links.find((l) => l.role === "primary");
  if (!primary) {
    const overrun = links.find((l) => l.role === "overrun");
    // the watch was left running from an earlier start; say so instead of a misleading time
    if (overrun) return `watch: linked (inside ${sportLabel(overrun.sportType)} from ${overrun.localTime})`;
    return "watch: not linked yet";
  }
  const extra = links.filter((l) => l.role === "continuation").length;
  const more = extra ? ` +${extra} more` : "";
  return `watch: linked (${sportLabel(primary.sportType)} ${primary.localTime}${more})`;
}

export function formatIngestSummary(
  summary: IngestSummary,
  links: readonly LinkedActivity[],
  opts: { duplicate?: boolean } = {},
): string {
  const parts = [
    `${opts.duplicate ? "already logged" : "logged"} ${summary.title.toLowerCase()}`,
    formatLocalDay(summary.startedLocal),
    plural(summary.exerciseCount, "exercise"),
    plural(summary.workingSets, "set"),
  ];
  // bodyweight-only days have no meaningful tonnage
  if (summary.volumeKg > 0) parts.push(formatVolume(summary.volumeKg, summary.unit));
  parts.push(formatWatch(links));
  return parts.filter(Boolean).join(" · ");
}
