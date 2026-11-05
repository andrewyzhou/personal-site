// rule-based parser for questions sent to the lift bot. pure and deterministic:
// same text + same `today` -> same intent. no fuzzy guessing beyond what the
// exercise search already does; anything unclear becomes "unknown" and gets help.

import {
  EXERCISES,
  getExercise,
  resolveExerciseName,
  searchExercises,
  type Exercise,
  type MuscleRegion,
} from "lift-core";
import { extractWindow, type DateWindow } from "./window";

export type Subject =
  | { type: "any" }
  | { type: "region"; label: string; regions: MuscleRegion[] }
  | { type: "exercise"; term: string };

export type IntentKind = "sets" | "best" | "e1rm" | "count" | "last" | "volume" | "history";

export type LiftIntent =
  | { kind: "help" }
  | { kind: "unknown"; text: string }
  | {
      kind: IntentKind;
      subject: Subject;
      window: DateWindow | null;
      /** no keyword or time phrase, just a subject ("bench"): resolve it strictly */
      bare?: true;
    };

// ---------------------------------------------------------------------------
// muscle groups people name a day after

const LEGS: MuscleRegion[] = ["quads", "hamstrings", "glutes", "calves", "adductors", "abductors"];
const DELTS: MuscleRegion[] = ["front_delts", "side_delts", "rear_delts"];
// "back day" means lats and upper back; deadlifts loading the lower back don't make one
const BACK: MuscleRegion[] = ["lats", "upper_back"];
const ARMS: MuscleRegion[] = ["biceps", "triceps", "forearms"];

const REGION_WORDS: Record<string, { label: string; regions: MuscleRegion[] }> = {
  leg: { label: "leg", regions: LEGS },
  legs: { label: "leg", regions: LEGS },
  lower: { label: "lower body", regions: LEGS },
  "lower body": { label: "lower body", regions: LEGS },
  back: { label: "back", regions: BACK },
  "lower back": { label: "lower back", regions: ["lower_back"] },
  chest: { label: "chest", regions: ["chest"] },
  pecs: { label: "chest", regions: ["chest"] },
  shoulder: { label: "shoulder", regions: DELTS },
  shoulders: { label: "shoulder", regions: DELTS },
  delts: { label: "shoulder", regions: DELTS },
  arm: { label: "arm", regions: ARMS },
  arms: { label: "arm", regions: ARMS },
  bicep: { label: "biceps", regions: ["biceps"] },
  biceps: { label: "biceps", regions: ["biceps"] },
  tricep: { label: "triceps", regions: ["triceps"] },
  triceps: { label: "triceps", regions: ["triceps"] },
  lats: { label: "lats", regions: ["lats"] },
  traps: { label: "traps", regions: ["traps"] },
  abs: { label: "abs", regions: ["abs", "obliques"] },
  core: { label: "core", regions: ["abs", "obliques"] },
  glutes: { label: "glutes", regions: ["glutes"] },
  quads: { label: "quads", regions: ["quads"] },
  hamstrings: { label: "hamstrings", regions: ["hamstrings"] },
  hams: { label: "hamstrings", regions: ["hamstrings"] },
  calves: { label: "calves", regions: ["calves"] },
  push: { label: "push", regions: ["chest", "front_delts", "triceps"] },
  pull: { label: "pull", regions: ["lats", "upper_back", "biceps"] },
  upper: { label: "upper body", regions: ["chest", ...BACK, ...DELTS, ...ARMS] },
  "upper body": { label: "upper body", regions: ["chest", ...BACK, ...DELTS, ...ARMS] },
};

// ---------------------------------------------------------------------------
// keywords

const HELP_RE = /^(?:help|start|commands?|menu|\?|hi|hello|hey|yo|what can you do|how does this work|what do you do|examples?)$/;

const CHATTER_RE = /^(?:(?:ok|okay|k|kk|cool|nice|great|thanks|thank you|thx|ty|lol|lmao|haha|yes|no|yep|nope|sure|good|awesome|gm|gn|how are you|sup|whats up|what up)\s*)+$/;

const INTENT_RES:[IntentKind, RegExp][] = [
  ["e1rm", /\b(?:e1rm|e1rms|1rm|1 rm|one rep max(?:es)?|1 rep max|estimated (?:1rm|max|one rep max)|orm)\b/],
  ["history", /\b(?:history|progress|progression|trend|over time|log|timeline)\b/],
  ["volume", /\b(?:volume|tonnage|total weight|total load|how much weight did i (?:lift|move)|how much did i lift)\b/],
  ["count", /\bhow (?:many|often)\b|\bnumber of\b|\bcount\b/],
  ["best", /\b(?:prs?|pbs?|personal (?:records?|bests?)|records?|best|max|maxes|heaviest|top set|strongest|how much can i)\b/],
  ["last", /\b(?:last|latest|most recent|previous|when)\b/],
];

// words that carry no subject; removed before resolving what's left
const FILLER = new Set(
  (
    "what whats what's which did do does done doing i im i'm ive i've my me mine the a an was were is are be been " +
    "when whens how much many often can could would should will on for of at to in into with by from " +
    "show tell give list get got see please pls plz about all any some so far now currently current recent " +
    "and or it its that this there here have has had time times ago day days session sessions workout workouts " +
    "lift lifts lifted lifting train trained training work worked working out go went gym hit hitting " +
    "exercise exercises sets set reps rep weight weights lbs lb kg kgs total"
  ).split(" ")
);

// intent words also get stripped from the subject
const INTENT_WORDS = new Set(
  (
    "e1rm e1rms 1rm rm one estimated orm history progress progression trend over log timeline volume tonnage load " +
    "number count pr prs pb pbs personal record records best bests max maxes heaviest top strongest last latest most " +
    "previous move moved"
  ).split(" ")
);

// past tense / -ing forms of the big lifts, so "what did i bench" and "when did i last squat" resolve
const VERB_FOLD: Record<string, string> = {
  benched: "bench",
  benching: "bench",
  squatted: "squat",
  squatting: "squat",
  squats: "squat",
  deadlifted: "deadlift",
  deadlifting: "deadlift",
  deadlifts: "deadlift",
  pressed: "press",
  pressing: "press",
  curled: "curl",
  curling: "curl",
  rowed: "row",
  rowing: "row",
  dipped: "dip",
  lunged: "lunge",
  lunging: "lunge",
  thrusted: "thrust",
};

/** lowercase, curly quotes folded, punctuation (except date characters) to spaces */
export function normalizeQuestion(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[‘’ʼ`´]/g, "'")
    .replace(/'s\b/g, "")
    .replace(/[^a-z0-9/\-'?]+/g, " ")
    .replace(/(?<![\d])-|-(?![\d])/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** strip a leading bot command: "/help@liftbot" -> "help", "/pr bench" -> "pr bench" */
function stripCommand(text: string): string {
  return text.replace(/^\/([a-z0-9_]+)(?:@[a-z0-9_]+)?/, (_m, cmd: string) => cmd.replace(/_/g, " "));
}

function subjectOf(rest: string): Subject {
  const words = rest
    .replace(/\?/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((w) => VERB_FOLD[w] ?? w)
    .filter((w) => !FILLER.has(w) && !INTENT_WORDS.has(w));
  const term = words.join(" ").replace(/'/g, "");
  if (!term) return { type: "any" };
  const region = REGION_WORDS[term];
  if (region) return { type: "region", ...region };
  return { type: "exercise", term };
}

/**
 * question text -> intent. `today` is the local 'YYYY-MM-DD' in the lift
 * timezone; windows are computed from it so tests can pin the clock.
 */
export function parseLiftQuestion(text: string, today: string): LiftIntent {
  const normalized = normalizeQuestion(stripCommand(text.trim().toLowerCase()));
  const plain = normalized.replace(/\?/g, "").trim();
  if (!plain || HELP_RE.test(plain) || normalized === "?") return { kind: "help" };
  // small talk never needs a db round-trip
  if (CHATTER_RE.test(plain)) return { kind: "unknown", text: text.trim() };

  const { window, rest } = extractWindow(plain, today);

  let kind: IntentKind | null = null;
  for (const [k, re] of INTENT_RES) {
    if (re.test(rest)) {
      kind = k;
      break;
    }
  }
  const subject = subjectOf(rest);

  if (kind === null) {
    // "what did i bench last week" / "what did i do yesterday"; a bare "bench" means the latest session
    if (window) kind = "sets";
    else if (subject.type !== "any") return { kind: "last", subject, window: null, bare: true };
    else return { kind: "unknown", text: text.trim() };
  }
  if (kind === "last" && window) kind = "sets";

  // records and trends only make sense for one exercise
  if ((kind === "best" || kind === "e1rm" || kind === "history") && subject.type !== "exercise") {
    return { kind: "unknown", text: text.trim() };
  }
  return { kind, subject, window };
}

// ---------------------------------------------------------------------------
// exercise resolution (pure: the owner's custom exercises and usage are passed in)

export interface KnownExercise {
  id: string;
  name: string;
  /** working sets logged, for the search's usage boost */
  uses: number;
}

/**
 * "bench" -> Bench Press (Barbell). exact names/aliases first (catalog, then the
 * owner's own exercises), then the ranked search with the owner's usage as a
 * boost. muscle-only hits are not an answer: "back" is a region, not a lift.
 */
export function resolveExerciseTerm(
  term: string,
  known: readonly KnownExercise[] = [],
  options: { strict?: boolean } = {},
): Exercise | null {
  const exact = resolveExerciseName(term);
  if (exact) return exact;
  const customs: Exercise[] = known
    .filter((k) => !getExercise(k.id))
    .map((k) => ({
      id: k.id,
      name: k.name,
      aliases: [],
      equipment: "other",
      category: "strength",
      tracking: "weight_reps",
      primary: [],
      secondary: [],
      curated: false,
    }));
  const ownExact = customs.length ? resolveExerciseName(term, customs) : undefined;
  if (ownExact) return ownExact;
  const usage: Record<string, number> = {};
  for (const k of known) usage[k.id] = k.uses;
  const catalog = customs.length ? [...customs, ...EXERCISES] : EXERCISES;
  const [top] = searchExercises(term, { catalog, usage, limit: 1 });
  if (!top || top.tier === "muscle") return null;
  // prefix/typo matches are fine for "squat pr" but not for a bare word that might be anything
  if (options.strict && top.tier !== "exact" && top.tier !== "alias") return null;
  return top.exercise;
}
