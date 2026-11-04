import { parseStrongDate } from "./parse-strong";
import type { DistanceUnit, ParsedExercise, ParsedSet, ParsedWorkout, ParseWarning, SetKind, WeightUnit } from "./types";

export interface StrongCsvOptions {
  /** unit the export's weight column is in (strong exports in the app's unit setting); default "lb" */
  weightUnit?: WeightUnit;
  /** unit of the distance column; default "mi" */
  distanceUnit?: "mi" | "km";
}

export interface StrongCsvResult {
  /** one per (date, workout name), oldest first; linkSlug is always null */
  workouts: ParsedWorkout[];
  warnings: ParseWarning[];
}

// ---------------------------------------------------------------------------
// rfc 4180 records

interface CsvRecord {
  fields: string[];
  /** 1-based line the record starts on */
  line: number;
  /** the record's source text, line breaks included */
  raw: string;
}

/** most common of comma / semicolon / tab outside quotes on the first line */
function detectDelimiter(text: string): string {
  const counts: Record<string, number> = { ",": 0, ";": 0, "\t": 0 };
  let quoted = false;
  for (const ch of text) {
    if (ch === '"') quoted = !quoted;
    else if (!quoted && (ch === "\n" || ch === "\r")) break;
    else if (!quoted && ch in counts) counts[ch]++;
  }
  let best = ",";
  for (const d of [";", "\t"]) if (counts[d] > counts[best]) best = d;
  return best;
}

function readRecords(text: string, delim: string, warn: (line: number, message: string, t: string) => void): CsvRecord[] {
  const records: CsvRecord[] = [];
  let fields: string[] = [];
  let field = "";
  let quoted = false;
  let line = 1;
  let startLine = 1;
  let startIdx = 0;
  let i = 0;

  const endRecord = (endIdx: number) => {
    fields.push(field);
    records.push({ fields, line: startLine, raw: text.slice(startIdx, endIdx) });
    fields = [];
    field = "";
  };

  while (i < text.length) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
        } else {
          quoted = false;
          i++;
        }
        continue;
      }
      if (ch === "\r" || ch === "\n") {
        // any run of \r ending in an optional \n is one break (doubled \r\r\n happens)
        let j = i;
        while (text[j] === "\r") j++;
        if (text[j] === "\n") j++;
        field += "\n";
        line++;
        i = j;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"' && field === "") {
      quoted = true;
      i++;
    } else if (ch === delim) {
      fields.push(field);
      field = "";
      i++;
    } else if (ch === "\r" || ch === "\n") {
      let j = i;
      while (text[j] === "\r") j++;
      if (text[j] === "\n") j++;
      endRecord(i);
      line++;
      i = j;
      startLine = line;
      startIdx = j;
    } else {
      // a stray quote mid-field is kept literally
      field += ch;
      i++;
    }
  }
  if (quoted) warn(startLine, "unterminated quoted field", text.slice(startIdx, startIdx + 80));
  if (field !== "" || fields.length > 0 || quoted) endRecord(text.length);
  return records;
}

// ---------------------------------------------------------------------------
// field parsing

/** "22,5" -> 22.5; a comma before exactly three digits is a thousands separator */
function num(s: string): number | null {
  const t = s.trim();
  if (!t) return null;
  if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(t)) return Number(t.replace(/,/g, ""));
  const v = Number(t.replace(",", "."));
  return Number.isFinite(v) ? v : null;
}

function weightUnitOf(s: string): WeightUnit | null {
  const u = s.trim().toLowerCase();
  if (!u) return null;
  if (u.startsWith("k")) return "kg";
  if (u.startsWith("l") || u.startsWith("p")) return "lb";
  return null;
}

function distanceUnitOf(s: string): DistanceUnit | null {
  const u = s.trim().toLowerCase();
  if (!u) return null;
  if (u.startsWith("mi")) return "mi";
  if (u.startsWith("k")) return "km";
  if (u.startsWith("y")) return "yd";
  if (u.startsWith("f")) return "ft";
  if (u.startsWith("m")) return "m";
  return null;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** "2024-03-14 18:30:00" -> "2024-03-14T18:30"; also m/d/yyyy and strong's share-text dates */
export function parseStrongCsvDate(s: string): string | null {
  const t = s.trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?)?(?:Z|[+-]\d{2}:?\d{2})?$/.exec(t);
  if (m) {
    const [y, mo, d, h, mi] = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4] ?? 0), Number(m[5] ?? 0)];
    return valid(y, mo, d, h, mi);
  }
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:,?\s+(\d{1,2}):(\d{2})(?::\d{2})?\s*([ap]\.?m\.?)?)?$/i.exec(t);
  if (m) {
    let h = Number(m[4] ?? 0);
    const ampm = m[6]?.toLowerCase()[0];
    if (ampm === "p" && h < 12) h += 12;
    if (ampm === "a" && h === 12) h = 0;
    return valid(Number(m[3]), Number(m[1]), Number(m[2]), h, Number(m[5] ?? 0));
  }
  return t ? parseStrongDate(t) : null;
}

function valid(y: number, mo: number, d: number, h: number, mi: number): string | null {
  if (mo < 1 || mo > 12 || d < 1 || h > 23 || mi > 59) return null;
  const dim = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  if (d > dim) return null;
  return `${y}-${pad(mo)}-${pad(d)}T${pad(h)}:${pad(mi)}`;
}

/** "1h 5m" / "45m" / "1h" / "30s" / "1:05:00" / bare seconds -> seconds; null when unreadable */
export function parseStrongDuration(s: string): number | null {
  const t = s.trim().toLowerCase();
  if (!t) return null;
  if (/^\d+(\.\d+)?$/.test(t)) return Math.round(Number(t));
  const clock = /^(\d+):(\d{2})(?::(\d{2}))?$/.exec(t);
  if (clock) {
    const [a, b, c] = [Number(clock[1]), Number(clock[2]), clock[3] !== undefined ? Number(clock[3]) : null];
    return c === null ? a * 60 + b : a * 3600 + b * 60 + c;
  }
  const parts = t.split(/\s+/).join("");
  const re = /(\d+(?:\.\d+)?)(h|hr|hrs|hours?|m|min|mins|minutes?|s|sec|secs|seconds?)/gy;
  let total = 0;
  let matched = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(parts))) {
    const v = Number(m[1]);
    const u = m[2][0];
    total += u === "h" ? v * 3600 : u === "m" ? v * 60 : v;
    matched += m[0].length;
  }
  return matched === parts.length && matched > 0 ? Math.round(total) : null;
}

/** "1" normal, "W" warm-up, "D" drop, "F" failure, also "W2" / "2W"; null when unrecognised */
function parseSetOrder(s: string): { kind: SetKind; label: number | null } | null {
  const m = /^([wdf])?\s*(\d+)?\s*([wdf])?$/i.exec(s.trim());
  if (!m || (!m[1] && !m[2] && !m[3]) || (m[1] && m[3])) return null;
  const letter = (m[1] ?? m[3] ?? "").toLowerCase();
  const kind: SetKind = letter === "w" ? "warmup" : letter === "d" ? "drop" : letter === "f" ? "failure" : "normal";
  return { kind, label: m[2] !== undefined ? Number(m[2]) : null };
}

// ---------------------------------------------------------------------------
// columns

type Col =
  | "date"
  | "workout"
  | "duration"
  | "exercise"
  | "order"
  | "weight"
  | "weightUnit"
  | "reps"
  | "distance"
  | "distanceUnit"
  | "seconds"
  | "notes"
  | "workoutNotes"
  | "rpe";

const HEADERS: Record<string, Col> = {
  date: "date",
  "workout name": "workout",
  duration: "duration",
  "workout duration": "duration",
  "exercise name": "exercise",
  "set order": "order",
  weight: "weight",
  "weight unit": "weightUnit",
  reps: "reps",
  distance: "distance",
  "distance unit": "distanceUnit",
  seconds: "seconds",
  notes: "notes",
  "workout notes": "workoutNotes",
  rpe: "rpe",
};

function mapHeader(fields: string[]): Partial<Record<Col, number>> {
  const cols: Partial<Record<Col, number>> = {};
  fields.forEach((f, i) => {
    const col = HEADERS[f.trim().toLowerCase().replace(/\s+/g, " ")];
    if (col && cols[col] === undefined) cols[col] = i;
  });
  return cols;
}

// ---------------------------------------------------------------------------

interface Group {
  workout: ParsedWorkout;
  firstIndex: number;
  /** exercise name of the last row added, to split consecutive runs */
  lastExercise: string | null;
  seenNotes: Set<string>;
  durationSeen: boolean;
}

/**
 * parse strong's "export data" csv (comma or semicolon separated, quoted fields,
 * header row with Date, Workout Name, Duration, Exercise Name, Set Order,
 * Weight, Reps, Distance, Seconds, Notes, Workout Notes, RPE). tolerant:
 * unknown columns ignored, bad rows become warnings. the top-level warnings
 * list everything; each workout also carries the ones for its own rows.
 */
export function parseStrongCsv(text: string, options?: StrongCsvOptions): StrongCsvResult {
  const warnings: ParseWarning[] = [];
  const warn = (line: number, message: string, t: string, into?: ParsedWorkout) => {
    const w = { line, message, text: t };
    warnings.push(w);
    into?.warnings.push(w);
  };
  const defaultWeightUnit = options?.weightUnit ?? "lb";
  const defaultDistanceUnit = options?.distanceUnit ?? "mi";

  const body = text.replace(/^﻿/, "");
  const records = readRecords(body, detectDelimiter(body), (l, m, t) => warn(l, m, t));
  const blank = (r: CsvRecord) => r.fields.every((f) => f.trim() === "");

  const headerIdx = records.findIndex((r) => !blank(r));
  if (headerIdx < 0) return { workouts: [], warnings };
  const header = records[headerIdx];
  const cols = mapHeader(header.fields);
  if (cols.date === undefined || cols.exercise === undefined) {
    warn(header.line, "not a strong csv export: missing Date or Exercise Name column", header.raw.trim());
    return { workouts: [], warnings };
  }
  const get = (r: CsvRecord, c: Col) => {
    const i = cols[c];
    return i === undefined ? "" : (r.fields[i] ?? "").trim();
  };

  const groups = new Map<string, Group>();
  for (let ri = headerIdx + 1; ri < records.length; ri++) {
    const r = records[ri];
    if (blank(r)) continue;
    const raw = r.raw.trim();

    const dateText = get(r, "date");
    const title = get(r, "workout");
    const key = `${dateText}\u0000${title}`;
    let g = groups.get(key);
    if (!g) {
      const startedLocal = parseStrongCsvDate(dateText);
      g = {
        workout: { title, startedLocal, exercises: [], notes: [], link: null, linkSlug: null, warnings: [], durationS: null },
        firstIndex: ri,
        lastExercise: null,
        seenNotes: new Set(),
        durationSeen: false,
      };
      groups.set(key, g);
      if (startedLocal === null) warn(r.line, dateText ? "unreadable date" : "missing date", raw, g.workout);
    }
    const w = g.workout;

    if (!g.durationSeen) {
      const durText = get(r, "duration");
      if (durText) {
        g.durationSeen = true;
        w.durationS = parseStrongDuration(durText);
        if (w.durationS === null) warn(r.line, "unreadable duration", durText, w);
      }
    }
    const workoutNotes = get(r, "workoutNotes");
    if (workoutNotes && !g.seenNotes.has(workoutNotes)) {
      g.seenNotes.add(workoutNotes);
      for (const l of workoutNotes.split("\n")) if (l.trim()) w.notes.push(l.trim());
    }

    const name = get(r, "exercise");
    if (!name) {
      warn(r.line, "row without an exercise name", raw, w);
      continue;
    }
    const orderText = get(r, "order");
    // rest timer rows carry no set
    if (/^rest/i.test(orderText)) continue;
    const order = orderText ? parseSetOrder(orderText) : { kind: "normal" as SetKind, label: null };
    if (!order) {
      warn(r.line, `unrecognised set order "${orderText}"`, raw, w);
      continue;
    }

    const res = rowToSet(r, get, defaultWeightUnit, defaultDistanceUnit, (msg) => warn(r.line, msg, raw, w));
    if (typeof res === "string") {
      warn(r.line, res, raw, w);
      continue;
    }
    const set = res;

    let ex: ParsedExercise | undefined = w.exercises[w.exercises.length - 1];
    if (!ex || g.lastExercise !== name) {
      ex = { name, sets: [], notes: [] };
      w.exercises.push(ex);
      g.lastExercise = name;
    }
    ex.sets.push({ ...set, position: ex.sets.length, kind: order.kind, label: order.label, raw });
  }

  const workouts = [...groups.values()]
    .sort((a, b) => {
      const sa = a.workout.startedLocal;
      const sb = b.workout.startedLocal;
      // undated workouts go last, otherwise file order breaks ties
      if (sa !== sb) {
        if (sa === null) return 1;
        if (sb === null) return -1;
        return sa < sb ? -1 : 1;
      }
      return a.firstIndex - b.firstIndex;
    })
    .map((g) => g.workout);
  return { workouts, warnings };
}

type SetFields = Omit<ParsedSet, "position" | "kind" | "label" | "raw">;

function rowToSet(
  r: CsvRecord,
  get: (r: CsvRecord, c: Col) => string,
  defaultWeightUnit: WeightUnit,
  defaultDistanceUnit: DistanceUnit,
  warn: (message: string) => void,
): SetFields | string {
  const unreadable: string[] = [];
  const numeric = (c: Col): number | null => {
    const t = get(r, c);
    if (!t) return null;
    const v = num(t);
    if (v === null) unreadable.push(`${c} "${t}"`);
    return v;
  };

  const weightRaw = numeric("weight");
  const repsRaw = numeric("reps");
  const distRaw = numeric("distance");
  const secRaw = numeric("seconds");
  const rpeRaw = numeric("rpe");
  // a half-read row would silently become a different set (e.g. bodyweight), so drop it
  if (unreadable.length) return `unreadable ${unreadable.join(", ")}`;

  // strong writes 0 for "not recorded" in every numeric column
  const weight = weightRaw !== null && weightRaw !== 0 ? weightRaw : null;
  const reps = repsRaw !== null && repsRaw > 0 ? Math.round(repsRaw) : null;
  const distance = distRaw !== null && distRaw > 0 ? distRaw : null;
  const durationS = secRaw !== null && secRaw > 0 ? Math.round(secRaw) : null;
  const rpe = rpeRaw !== null && rpeRaw > 0 && rpeRaw <= 10 ? rpeRaw : null;
  if (rpeRaw !== null && rpeRaw !== 0 && rpe === null) warn(`rpe out of range "${get(r, "rpe")}"`);

  if (weight === null && reps === null && distance === null && durationS === null) {
    return "set has no weight, reps, time or distance";
  }

  const unit = weight === null ? null : (weightUnitOf(get(r, "weightUnit")) ?? defaultWeightUnit);
  const dUnit = distance === null ? null : (distanceUnitOf(get(r, "distanceUnit")) ?? defaultDistanceUnit);
  const note = get(r, "notes");
  return {
    weight,
    unit,
    reps,
    durationS,
    distance,
    distanceUnit: dUnit,
    rpe,
    // reps with no load is a bodyweight set; a negative load is assistance
    bodyweight: (weight === null && reps !== null) || (weight !== null && weight < 0),
    note: note || null,
  };
}
