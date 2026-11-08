import { LB_PER_KG, e1rm, fromKg, toKg, type LinkRole, type WeightUnit } from "lift-core";
import type { LiftWarning } from "@/lib/db/lift-schema";
import type { ExerciseLine, IngestSummary, SetBrief } from "./plan";
import { publicLiftId } from "./public-id";

// lowercase, human summaries for api responses and the bot reply: a one-liner
// and a multi-line breakdown. names no outside services on purpose: it's shown to people.

export interface LinkedActivity {
  activityId: number;
  role: LinkRole;
  method: "auto" | "manual";
  deltaMin: number;
  sportType: string;
  /** 'HH:MM' local start of the recording */
  localTime: string;
  /** the activity's title, when known */
  name?: string;
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

/** "added to evening ride (ride from 17:00)" / "added to weight training 18:10" / "created lift session" */
export function formatWatch(links: readonly LinkedActivity[]): string {
  const primary = links.find((l) => l.role === "primary");
  // an overrun link means the lift started partway into the recording (a ride
  // with a lift on the end, or the watch left running): say "from" its start
  const rec = primary ?? links.find((l) => l.role === "overrun");
  if (!rec) return "created lift session";
  const when = `${sportLabel(rec.sportType)} ${primary ? "" : "from "}${rec.localTime}`;
  const name = rec.name?.replace(/\s+/g, " ").trim();
  const what = name ? `${truncateText(name, 60)} (${when})` : when;
  const extra = primary ? links.filter((l) => l.role === "continuation").length : 0;
  return `added to ${what}${extra ? ` +${extra} more` : ""}`;
}

export interface SummaryOptions {
  duplicate?: boolean;
  /** an edited re-share rewrote an existing workout */
  updated?: boolean;
}

function verb(opts: SummaryOptions): string {
  if (opts.duplicate) return "already logged";
  return opts.updated ? "updated" : "logged";
}

export function formatIngestSummary(
  summary: IngestSummary,
  links: readonly LinkedActivity[],
  opts: SummaryOptions = {},
): string {
  const parts = [
    `${verb(opts)} ${summary.title.toLowerCase()}`,
    formatLocalDay(summary.startedLocal),
    plural(summary.exerciseCount, "exercise"),
    plural(summary.workingSets, "set"),
  ];
  // bodyweight-only days have no meaningful tonnage
  if (summary.volumeKg > 0) parts.push(formatVolume(summary.volumeKg, summary.unit));
  parts.push(formatWatch(links));
  return parts.filter(Boolean).join(" · ");
}

export const SITE_URL = "https://www.andrewzhou.org";

/** cut to at most `max` utf-16 units with a trailing "…", never splitting a surrogate pair (emoji) */
export function truncateText(text: string, max: number): string {
  if (text.length <= max) return text;
  let out = "";
  for (const ch of Array.from(text)) {
    if (out.length + ch.length > max - 1) break;
    out += ch;
  }
  return `${out}…`;
}

// telegram caps a message at 4096; stay under it with room to spare
export const MAX_DETAILS = 4000;
// one exercise with hundreds of mixed sets shouldn't eat the whole reply
const MAX_LINE = 300;

function num(n: number): string {
  return String(Math.round(n * 100) / 100);
}

function clock(s: number): string {
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rest = String(Math.round(s % 60)).padStart(2, "0");
  return m >= 60 ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}:${rest}` : `${m}:${rest}`;
}

function load(s: SetBrief, unit: boolean): string | null {
  if (s.weight == null) return null;
  // added load on a bodyweight move reads as "+25"
  const w = s.bodyweight && s.weight > 0 ? `+${num(s.weight)}` : num(s.weight);
  return unit && s.unit ? `${w} ${s.unit}` : w;
}

function extras(s: SetBrief): string[] {
  const out: string[] = [];
  if (s.distance != null && s.distanceUnit) out.push(`${num(s.distance)} ${s.distanceUnit}`);
  if (s.durationS != null && s.durationS > 0) out.push(clock(s.durationS));
  return out;
}

/** "185×5", "+25×8", "12", "40 m 1:30" (unit left to the caller unless asked for) */
function setToken(s: SetBrief, unit: boolean): string {
  const l = load(s, unit);
  const head = l != null && s.reps != null ? `${l}×${s.reps}` : (l ?? (s.reps != null ? String(s.reps) : null));
  return [head, ...extras(s)].filter(Boolean).join(" ") || "done";
}

function sameSet(a: SetBrief, b: SetBrief): boolean {
  return (
    a.weight === b.weight &&
    a.unit === b.unit &&
    a.reps === b.reps &&
    a.durationS === b.durationS &&
    a.distance === b.distance &&
    a.distanceUnit === b.distanceUnit &&
    a.bodyweight === b.bodyweight
  );
}

/** "3×5 @ 185 lb" when every set matches, else "185×5, 175×6, 165×8 lb" */
export function formatSets(sets: readonly SetBrief[]): string {
  if (!sets.length) return "warm-up only";
  const units = new Set(sets.filter((s) => s.weight != null && s.unit).map((s) => s.unit));
  const oneUnit = units.size <= 1 ? ([...units][0] ?? null) : null;
  const tail = oneUnit ? ` ${oneUnit}` : "";
  const first = sets[0];

  if (sets.every((s) => sameSet(s, first))) {
    const n = sets.length;
    const l = load(first, false);
    if (l != null && first.reps != null && !extras(first).length) return `${n}×${first.reps} @ ${l}${tail}`;
    return `${n}×${setToken(first, true)}`;
  }

  // consecutive repeats collapse to "185×5 ×2"
  const runs: string[] = [];
  for (let i = 0; i < sets.length; ) {
    let j = i + 1;
    while (j < sets.length && sameSet(sets[j], sets[i])) j++;
    const token = setToken(sets[i], !oneUnit);
    runs.push(j - i > 1 ? `${token} ×${j - i}` : token);
    i = j;
  }
  return `${runs.join(", ")}${sets.some((s) => s.weight != null) ? tail : ""}`;
}

/** best epley estimate over absolute loads, in the exercise's own unit */
function topE1rm(sets: readonly SetBrief[], fallback: WeightUnit): string | null {
  let best: { kg: number; unit: WeightUnit } | null = null;
  for (const s of sets) {
    // "+25 lb" on a pull-up isn't the whole load, so it can't estimate a max
    if (s.bodyweight || s.weight == null || s.reps == null) continue;
    const unit = s.unit ?? fallback;
    const est = e1rm(toKg(s.weight, unit), s.reps);
    if (est != null && (!best || est > best.kg)) best = { kg: est, unit };
  }
  return best ? `top e1rm ${Math.round(fromKg(best.kg, best.unit))} ${best.unit}` : null;
}

export function formatExerciseLine(ex: ExerciseLine, fallback: WeightUnit): string {
  const sets = ex.sets ?? [];
  const parts = [`${ex.name.toLowerCase()}: ${formatSets(sets)}`];
  const est = topE1rm(sets, fallback);
  if (est) parts.push(est);
  const line = parts.join(" · ");
  return truncateText(line, MAX_LINE);
}

/**
 * where the reply points: the watch recording when linked (any role), else the
 * lift's own page by its public id. null when there's no safe link to give
 * (no public id secret), since the internal id must never reach a url.
 */
export function workoutUrl(workoutId: string, links: readonly LinkedActivity[]): string | null {
  const rec = links.find((l) => l.role === "primary") ?? links.find((l) => l.role === "overrun") ?? links[0];
  if (rec) return `${SITE_URL}/activities/${rec.activityId}`;
  const publicId = publicLiftId(workoutId);
  return publicId ? `${SITE_URL}/lifts/${publicId}` : null;
}

function warningLines(warnings: readonly LiftWarning[]): string[] {
  // numbered lines are share text the parser couldn't read
  const skipped = warnings.filter((w) => w.line > 0).length;
  const out = warnings.filter((w) => w.line <= 0 && w.message).map((w) => w.message);
  if (skipped) out.unshift(`${plural(skipped, "line")} skipped`);
  return out;
}

/**
 * the multi-line bot reply: the one-liner, one line per exercise (warm-ups
 * left out), the watch line with a link, then any warnings. trimmed to fit
 * one telegram message by dropping trailing exercises as "+N more".
 */
export function formatIngestDetails(
  summary: IngestSummary,
  links: readonly LinkedActivity[],
  opts: SummaryOptions & {
    workoutId: string;
    warnings?: readonly LiftWarning[];
    /** links couldn't be read, so a lift-only url might point at a linked workout: leave it out */
    linksUnknown?: boolean;
  },
): string {
  const head = formatIngestSummary(summary, links, opts);
  // the head already carries the watch status, so the foot is just the link
  const url = opts.linksUnknown ? null : workoutUrl(opts.workoutId, links);
  const foot = [...(url ? [url] : []), ...warningLines(opts.warnings ?? [])];
  const lines = summary.exercises.map((ex) => formatExerciseLine(ex, summary.unit));

  const size = (body: string[]) => [head, ...body, ...foot].join("\n").length;
  let shown = lines.length;
  const body = () => {
    const rest = lines.length - shown;
    return rest ? [...lines.slice(0, shown), `+${rest} more`] : lines;
  };
  while (shown > 0 && size(body()) > MAX_DETAILS) shown--;
  const text = [head, ...body(), ...foot].join("\n");
  // only absurd warning lists get here; the cap still holds
  return truncateText(text, MAX_DETAILS);
}
