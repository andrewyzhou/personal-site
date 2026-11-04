import { resolveExerciseName } from "./catalog";
import type {
  DistanceUnit,
  ParsedExercise,
  ParsedSet,
  ParsedWorkout,
  ParseWarning,
  SetKind,
  WeightUnit,
} from "./types";

// ---------------------------------------------------------------------------
// text normalization

// ios inserts nbsp / narrow nbsp around "PM" and between numbers and units
const ODD_SPACE_RE = /[     \t]/g;
const ZERO_WIDTH_RE = /[​‌‍﻿]/g;

function normalizeLines(text: string): string[] {
  return text
    .replace(ZERO_WIDTH_RE, "")
    .replace(ODD_SPACE_RE, " ")
    .split(/\r\n|\r|\n/)
    .map((l) => l.replace(/ {2,}/g, " ").trim());
}

// ---------------------------------------------------------------------------
// share link

const LINK_RE = /https?:\/\/[^\s/?#]+(?:[/?#]\S*)?$/i;

function slugOf(link: string): string | null {
  const path = link.replace(/^https?:\/\/[^/]+/i, "").split(/[?#]/)[0];
  const segs = path.split("/").filter(Boolean);
  return segs.length ? segs[segs.length - 1] : null;
}

// ---------------------------------------------------------------------------
// date line

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const DATE_FILLER = new Set(["at", "on", "the", "of", "um", "a", "à"]);

function monthIndex(tok: string): number {
  if (tok.length < 3) return -1;
  const t = tok === "sept" ? "sep" : tok;
  const i = MONTHS.indexOf(t.slice(0, 3));
  if (i < 0) return -1;
  const full = [
    "january", "february", "march", "april", "may", "june",
    "july", "august", "september", "october", "november", "december",
  ][i];
  return full.startsWith(t) || t === "sep" ? i : -1;
}

function isWeekday(tok: string): boolean {
  if (tok.length < 3) return false;
  const i = WEEKDAYS.indexOf(tok.slice(0, 3));
  if (i < 0) return false;
  const full = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"][i];
  return full.startsWith(tok) || tok === "weds";
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** "Tuesday, November 4, 2026 at 6:12 PM" and friends -> "2026-11-04T18:12" */
export function parseShareDate(line: string): string | null {
  const s = line.toLowerCase().trim();

  const iso = /^(\d{4})-(\d{2})-(\d{2})[t ,]+(\d{1,2}):(\d{2})/.exec(s);
  if (iso) {
    return validDate(Number(iso[1]), Number(iso[2]), Number(iso[3]), Number(iso[4]), Number(iso[5]));
  }

  const tm = /(\d{1,2})[:.](\d{2})(?::\d{2})?\s*([ap])\.?\s?m\.?(?![a-z])/.exec(s) ?? /(\d{1,2}):(\d{2})(?::\d{2})?/.exec(s);
  if (!tm) return null;
  let hour = Number(tm[1]);
  const minute = Number(tm[2]);
  const ampm = tm[3];
  if (ampm) {
    if (hour < 1 || hour > 12) return null;
    hour = (hour % 12) + (ampm === "p" ? 12 : 0);
  }

  const rest = (s.slice(0, tm.index) + " " + s.slice(tm.index + tm[0].length)).replace(/[,.]/g, " ");
  const toks = rest.split(/\s+/).filter(Boolean);
  let month = -1;
  let year = -1;
  const nums: number[] = [];
  for (const raw of toks) {
    const tok = raw.replace(/^(\d{1,2})(st|nd|rd|th)$/, "$1");
    if (/^\d{4}$/.test(tok)) {
      year = Number(tok);
    } else if (/^\d{1,2}$/.test(tok)) {
      nums.push(Number(tok));
    } else if (monthIndex(tok) >= 0 && month < 0) {
      month = monthIndex(tok);
    } else if (!isWeekday(tok) && !DATE_FILLER.has(tok)) {
      // an unknown word means this probably isn't a date line at all
      return null;
    }
  }
  if (month < 0 || year < 0 || nums.length !== 1) return null;
  return validDate(year, month + 1, nums[0], hour, minute);
}

function validDate(y: number, mo: number, d: number, h: number, mi: number): string | null {
  if (h > 23 || mi > 59 || mo < 1 || mo > 12 || d < 1) return null;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${pad(mo)}-${pad(d)}T${pad(h)}:${pad(mi)}`;
}

/** loose test: does this line look like it was meant to be a date? */
function looksDateish(line: string): boolean {
  const toks = line.toLowerCase().replace(/[,.]/g, " ").split(/\s+/);
  const hasMonthOrDay = toks.some((t) => monthIndex(t) >= 0 || isWeekday(t));
  const hasYear = toks.some((t) => /^(19|20)\d{2}$/.test(t));
  return hasMonthOrDay && hasYear;
}

// ---------------------------------------------------------------------------
// set lines

const SET_PREFIX_RE = /^(set|w|warm[- ]?ups?|d|f|drop|failure)\s*(\d+)?\s*:\s*(.*)$/i;

interface SetPrefix {
  kind: SetKind;
  label: number | null;
  body: string;
}

function matchSetPrefix(line: string): SetPrefix | null {
  const m = SET_PREFIX_RE.exec(line);
  if (!m) return null;
  const word = m[1].toLowerCase();
  const label = m[2] !== undefined ? Number(m[2]) : null;
  // a lone "d:" / "f:" / "set:" is too likely to be ordinary prose
  if ((word === "d" || word === "f" || word === "set") && label === null) return null;
  let kind: SetKind = "normal";
  if (word === "w" || word.startsWith("warm")) kind = "warmup";
  else if (word === "d" || word === "drop") kind = "drop";
  else if (word === "f" || word === "failure") kind = "failure";
  return { kind, label, body: m[3] };
}

const NUM = String.raw`\d+(?:[.,]\d+)?`;
const WEIGHT_UNIT = String.raw`(lbs?|pounds?|kgs?|kilos?|kilograms?)`;
const WEIGHT_RE = new RegExp(String.raw`^([+-])?\s*(${NUM})\s*${WEIGHT_UNIT}?\s*(?:[×xX*]\s*(\d+)(?:\s*reps?)?)?$`, "i");
const REPS_RE = /^[×xX*]?\s*(\d+)\s*(?:reps?)?$/i;
const CLOCK_RE = /^(\d+):(\d{2})(?::(\d{2}))?$/;
const SECONDS_RE = new RegExp(String.raw`^(${NUM})\s*(s|secs?|seconds?)$`, "i");
const MINUTES_RE = new RegExp(String.raw`^(${NUM})\s*(mins?|minutes?)$`, "i");
const HOURS_RE = new RegExp(String.raw`^(${NUM})\s*(h|hrs?|hours?)$`, "i");
const DIST_RE = new RegExp(String.raw`^(${NUM})\s*(mi|miles?|km|kms|kilometers?|kilometres?|m|meters?|metres?|yd|yds|yards?|ft|feet|foot)$`, "i");
const LEADING_WEIGHT_RE = new RegExp(String.raw`^([+-]?\s*${NUM}\s*${WEIGHT_UNIT})(?![a-z])`, "i");
const RPE_RE = /(?:@\s*|\bRPE\s*:?\s*)(\d+(?:[.,]\d+)?)/i;
const TAG_RE = /\[([^\]]*)\]/g;

/** "22,5" -> 22.5; a comma before exactly three digits is a thousands separator */
function num(s: string): number {
  if (/^\d+,\d{3}$/.test(s)) return Number(s.replace(",", ""));
  return Number(s.replace(",", "."));
}

function weightUnit(s: string): WeightUnit {
  return s.toLowerCase().startsWith("k") ? "kg" : "lb";
}

function distanceUnit(s: string): DistanceUnit {
  const u = s.toLowerCase();
  if (u.startsWith("mi")) return "mi";
  if (u.startsWith("k")) return "km";
  if (u.startsWith("y")) return "yd";
  if (u.startsWith("f")) return "ft";
  return "m";
}

function tagKind(tag: string): SetKind | null {
  const t = tag.toLowerCase().replace(/[^a-z]/g, "");
  if (t === "drop" || t === "dropset") return "drop";
  if (t === "failure" || t === "fail" || t === "tofailure") return "failure";
  if (t === "warmup" || t === "w") return "warmup";
  return null;
}

interface SetBody {
  set: Omit<ParsedSet, "position" | "kind" | "label" | "raw">;
  tagKind: SetKind | null;
  /** at least one measurement was understood */
  understood: boolean;
  /** pieces that weren't understood */
  leftovers: string[];
}

function parseSetBody(body: string): SetBody {
  const notes: string[] = [];
  const leftovers: string[] = [];
  let kindFromTag: SetKind | null = null;

  let rest = body.replace(TAG_RE, (_m, tag: string) => {
    const k = tagKind(tag);
    if (k && kindFromTag === null) kindFromTag = k;
    else if (tag.trim()) notes.push(tag.trim());
    return " ";
  });

  let rpe: number | null = null;
  const rm = RPE_RE.exec(rest);
  if (rm) {
    const v = num(rm[1]);
    if (v >= 0 && v <= 10) {
      rpe = v;
      rest = rest.slice(0, rm.index) + " " + rest.slice(rm.index + rm[0].length);
    }
  }

  const set: SetBody["set"] = {
    weight: null,
    unit: null,
    reps: null,
    durationS: null,
    distance: null,
    distanceUnit: null,
    rpe,
    bodyweight: false,
    note: null,
  };
  let understood = rpe !== null;

  for (const rawSeg of rest.split("|")) {
    const seg = rawSeg.trim().replace(/\s+/g, " ");
    if (!seg) continue;
    if (parseSegment(seg, set)) {
      understood = true;
      continue;
    }
    // salvage a leading load from a mangled segment like "155 lb ×× five"
    const lead = LEADING_WEIGHT_RE.exec(seg);
    if (lead && set.weight === null && parseSegment(lead[1], set)) {
      understood = true;
      leftovers.push(seg.slice(lead[0].length).trim());
    } else {
      leftovers.push(seg);
    }
  }

  if (set.weight === null && set.reps !== null) set.bodyweight = true;
  const allNotes = [...notes, ...leftovers];
  set.note = allNotes.length ? allNotes.join("; ") : null;
  return { set, tagKind: kindFromTag, understood, leftovers };
}

function parseSegment(seg: string, set: SetBody["set"]): boolean {
  let m: RegExpExecArray | null;

  if ((m = CLOCK_RE.exec(seg))) {
    const [a, b, c] = [Number(m[1]), Number(m[2]), m[3] !== undefined ? Number(m[3]) : null];
    if (b > 59 || (c !== null && c > 59)) return false;
    set.durationS = c === null ? a * 60 + b : a * 3600 + b * 60 + c;
    return true;
  }
  if ((m = SECONDS_RE.exec(seg))) {
    set.durationS = Math.round(num(m[1]));
    return true;
  }
  if ((m = MINUTES_RE.exec(seg))) {
    set.durationS = Math.round(num(m[1]) * 60);
    return true;
  }
  if ((m = HOURS_RE.exec(seg))) {
    set.durationS = Math.round(num(m[1]) * 3600);
    return true;
  }
  if ((m = DIST_RE.exec(seg))) {
    set.distance = num(m[1]);
    set.distanceUnit = distanceUnit(m[2]);
    return true;
  }
  if ((m = REPS_RE.exec(seg))) {
    set.reps = Number(m[1]);
    return true;
  }
  if ((m = WEIGHT_RE.exec(seg))) {
    const [, sign, w, unit, reps] = m;
    // a bare number with neither unit nor reps was handled as reps above
    if (!unit && reps === undefined && !sign) return false;
    const value = num(w);
    set.weight = sign === "-" ? -value : value;
    set.unit = unit ? weightUnit(unit) : null;
    if (sign) set.bodyweight = true;
    if (reps !== undefined) set.reps = Number(reps);
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// line classification

/** something a human would call an exercise name: "Bench Press (Barbell)", "Farmer's Walk" */
function looksLikeExerciseName(line: string): boolean {
  if (line.length > 80) return false;
  return /^[\p{L}\p{N}][\p{L}\p{N} '’()\-/&.,+]*$/u.test(line) && /\p{L}{2,}/u.test(line);
}

/**
 * mid-block, prose like "felt 2x harder" also passes the name shape, so only a
 * catalog hit or an "(Equipment)" suffix starts a new exercise there
 */
function startsNewExercise(line: string): boolean {
  if (!looksLikeExerciseName(line)) return false;
  return /\([^()]+\)\s*$/.test(line) || resolveExerciseName(line) !== undefined;
}

/** malformed measurements or noise: worth a warning instead of being kept as a note */
function looksLikeGarbage(line: string): boolean {
  if (!/\p{L}{2,}/u.test(line)) return true;
  if (/\d\s*[×*]|[×*]\s*\d/.test(line)) return true;
  return /\d\s*(lbs?|kgs?)\b/i.test(line);
}

interface Line {
  no: number;
  text: string;
}

// ---------------------------------------------------------------------------
// main parser

/** parse a "share workout" text. never throws: problems become warnings. */
export function parseShareText(text: string): ParsedWorkout {
  const warnings: ParseWarning[] = [];
  const warn = (line: number, message: string, t: string) => warnings.push({ line, message, text: t });

  const workout: ParsedWorkout = {
    title: "",
    startedLocal: null,
    exercises: [],
    notes: [],
    link: null,
    linkSlug: null,
    warnings,
  };

  let lines: Line[];
  try {
    lines = normalizeLines(typeof text === "string" ? text : "").map((t, i) => ({ no: i + 1, text: t }));
  } catch {
    warn(1, "input could not be read", "");
    return workout;
  }

  // pull the share link out first so it never reads as a title or note
  for (const l of lines) {
    const m = LINK_RE.exec(l.text);
    if (!m) continue;
    if (workout.link === null) {
      workout.link = m[0].replace(/[).,;]+$/, "");
      workout.linkSlug = slugOf(workout.link);
    }
    l.text = l.text.replace(LINK_RE, "").trim();
  }

  let i = 0;
  while (i < lines.length && !lines[i].text) i++;
  if (i >= lines.length) {
    warn(1, "empty input", "");
    return workout;
  }

  // header: title then date, either of which may be missing
  const first = lines[i];
  const firstDate = parseShareDate(first.text);
  if (firstDate) {
    workout.startedLocal = firstDate;
    warn(first.no, "no title line before the date", first.text);
    i++;
  } else if (!matchSetPrefix(first.text)) {
    workout.title = first.text;
    i++;
    while (i < lines.length && !lines[i].text) i++;
    if (i < lines.length) {
      const d = parseShareDate(lines[i].text);
      if (d) {
        workout.startedLocal = d;
        i++;
      } else if (looksDateish(lines[i].text)) {
        warn(lines[i].no, "could not parse the date line", lines[i].text);
        i++;
      } else {
        warn(lines[i].no, "no date line after the title", lines[i].text);
      }
    }
  } else {
    warn(first.no, "no title line", first.text);
  }

  // group the remainder into blank-line separated blocks
  const blocks: Line[][] = [];
  let cur: Line[] = [];
  for (; i < lines.length; i++) {
    if (lines[i].text) cur.push(lines[i]);
    else if (cur.length) {
      blocks.push(cur);
      cur = [];
    }
  }
  if (cur.length) blocks.push(cur);

  const setLines = new Map<ParsedSet, number>();
  for (const block of blocks) parseBlock(block, workout, warn, setLines);

  fillMissingUnits(workout, warn, setLines);

  if (workout.exercises.length === 0) {
    warn(first.no, "no exercises found; this doesn't look like a workout share", first.text);
  }
  return workout;
}

type Warn = (line: number, message: string, text: string) => void;

function parseBlock(block: Line[], workout: ParsedWorkout, warn: Warn, setLines: Map<ParsedSet, number>): void {
  const prefixes = block.map((l) => matchSetPrefix(l.text));
  const hasSets = prefixes.some(Boolean);

  if (!hasSets) {
    if (workout.exercises.length === 0) {
      for (const l of block) workout.notes.push(l.text);
    } else {
      for (const l of block) warn(l.no, "text outside an exercise was ignored", l.text);
    }
    return;
  }

  let ex: ParsedExercise | null = null;
  let seenSet = false;
  for (let k = 0; k < block.length; k++) {
    const l = block[k];
    const prefix = prefixes[k];

    if (!prefix) {
      const setsFollow = prefixes.slice(k + 1).some(Boolean);
      if (ex === null) {
        // the first non-set line of a block names the exercise
        ex = { name: l.text, sets: [], notes: [] };
        workout.exercises.push(ex);
      } else if (seenSet && setsFollow && startsNewExercise(l.text)) {
        // exercises not separated by a blank line
        ex = { name: l.text, sets: [], notes: [] };
        workout.exercises.push(ex);
        seenSet = false;
      } else if (looksLikeGarbage(l.text)) {
        warn(l.no, "unrecognized line", l.text);
      } else {
        ex.notes.push(l.text);
      }
      continue;
    }

    if (ex === null && workout.exercises.length > 0) {
      // a stray blank line inside an exercise: keep adding to the previous one
      ex = workout.exercises[workout.exercises.length - 1];
      seenSet = true;
    } else if (ex === null) {
      warn(l.no, "set line with no exercise name above it", l.text);
      ex = { name: "Unknown Exercise", sets: [], notes: [] };
      workout.exercises.push(ex);
    }

    const parsed = parseSetBody(prefix.body);
    if (!parsed.understood) {
      warn(l.no, "could not read set", l.text);
      continue;
    }
    if (parsed.leftovers.length) warn(l.no, `unrecognized text in set: ${parsed.leftovers.join("; ")}`, l.text);

    seenSet = true;
    const set: ParsedSet = {
      position: ex.sets.length,
      kind: prefix.kind === "normal" && parsed.tagKind ? parsed.tagKind : prefix.kind,
      label: prefix.label,
      ...parsed.set,
      raw: l.text,
    };
    ex.sets.push(set);
    setLines.set(set, l.no);
  }
}

/** sets typed without a unit borrow the unit the rest of the workout uses */
function fillMissingUnits(workout: ParsedWorkout, warn: Warn, setLines: Map<ParsedSet, number>): void {
  let lb = 0;
  let kg = 0;
  for (const ex of workout.exercises) {
    for (const s of ex.sets) {
      if (s.unit === "lb") lb++;
      else if (s.unit === "kg") kg++;
    }
  }
  if (lb === 0 && kg === 0) return;
  const unit: WeightUnit = kg > lb ? "kg" : "lb";
  for (const ex of workout.exercises) {
    for (const s of ex.sets) {
      if (s.weight !== null && s.unit === null) {
        s.unit = unit;
        warn(setLines.get(s) ?? 1, `set had no unit; assumed ${unit}`, s.raw);
      }
    }
  }
}

/** cheap check used by chat bots to decide whether a message is a workout share */
export function looksLikeShareText(text: string): boolean {
  if (typeof text !== "string" || !text.trim()) return false;
  const lines = normalizeLines(text).filter(Boolean);
  const head = lines.slice(0, 4);
  const hasDate = head.some((l) => parseShareDate(l) !== null || looksDateish(l));
  const hasLink = lines.some((l) => LINK_RE.test(l) && /example\.com\/\S+/i.test(l));

  let goodSets = 0;
  for (const l of lines) {
    const p = matchSetPrefix(l);
    if (!p) continue;
    const b = parseSetBody(p.body);
    if (b.understood && b.leftovers.length === 0) goodSets++;
  }

  if (goodSets === 0) return hasLink && hasDate;
  return hasDate || hasLink || goodSets >= 2;
}
