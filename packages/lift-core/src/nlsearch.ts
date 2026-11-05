// natural-language exercise search on top of searchExercises: "chest dumbbell",
// "back exercises no equipment", "something for rear delts". the query is split
// into equipment / muscle / category terms and leftover text; the terms filter,
// the text ranks with the normal tiers, and a plain search is the fallback.

import { EXERCISES, looseKey } from "./catalog";
import { searchExercises } from "./search";
import type { Equipment, Exercise, ExerciseCategory, MuscleRegion, SearchOptions, SearchResult } from "./types";

export interface ParsedQuery {
  /** words left after the terms were taken out */
  text: string;
  equipment: Equipment[];
  /** equipment named with "no"/"without" ("no machines") */
  excludeEquipment: Equipment[];
  muscles: MuscleRegion[];
  category: ExerciseCategory | null;
  /** the muscle words as typed, so "leg press" can still match by name */
  muscleWords: string[];
  /** name words that rank higher without filtering ("upper chest" prefers incline) */
  prefer: string[];
}

const BW: Equipment[] = ["bodyweight", "weighted_bodyweight"];

// longest phrases are tried first, so "smith machine" wins over "machine"
const EQUIPMENT_TERMS: Record<string, Equipment[]> = {
  barbell: ["barbell"],
  bb: ["barbell"],
  dumbbell: ["dumbbell"],
  dumbell: ["dumbbell"],
  db: ["dumbbell"],
  cable: ["cable"],
  pulley: ["cable"],
  machine: ["machine"],
  smith: ["smith"],
  "smith machine": ["smith"],
  kettlebell: ["kettlebell"],
  kb: ["kettlebell"],
  band: ["band"],
  "resistance band": ["band"],
  ez: ["ez_bar"],
  "ez bar": ["ez_bar"],
  "curl bar": ["ez_bar"],
  "trap bar": ["trap_bar"],
  "hex bar": ["trap_bar"],
  plate: ["plate"],
  "medicine ball": ["medicine_ball"],
  "med ball": ["medicine_ball"],
  "foam roller": ["foam_roll"],
  "foam roll": ["foam_roll"],
  bodyweight: BW,
  "body weight": BW,
  bw: BW,
  calisthenics: BW,
  "no equipment": ["bodyweight"],
  "without equipment": ["bodyweight"],
  "equipment free": ["bodyweight"],
  "at home": ["bodyweight"],
};

const DELTS: MuscleRegion[] = ["front_delts", "side_delts", "rear_delts"];
const LEGS: MuscleRegion[] = ["quads", "hamstrings", "glutes", "calves"];
const BACK: MuscleRegion[] = ["lats", "upper_back", "lower_back"];
const MUSCLE_TERMS: Record<string, MuscleRegion[]> = {
  chest: ["chest"],
  pec: ["chest"],
  pecs: ["chest"],
  "upper chest": ["chest"],
  "lower chest": ["chest"],
  shoulder: DELTS,
  delt: DELTS,
  deltoid: DELTS,
  "front delt": ["front_delts"],
  "anterior delt": ["front_delts"],
  "side delt": ["side_delts"],
  "lateral delt": ["side_delts"],
  "middle delt": ["side_delts"],
  "rear delt": ["rear_delts"],
  "posterior delt": ["rear_delts"],
  "back delt": ["rear_delts"],
  bicep: ["biceps"],
  tricep: ["triceps"],
  arm: ["biceps", "triceps", "forearms"],
  forearm: ["forearms"],
  grip: ["forearms"],
  wrist: ["forearms"],
  trap: ["traps"],
  trapezius: ["traps"],
  lat: ["lats"],
  back: BACK,
  "upper back": ["upper_back"],
  "mid back": ["upper_back"],
  "middle back": ["upper_back"],
  rhomboid: ["upper_back"],
  "lower back": ["lower_back"],
  "low back": ["lower_back"],
  ab: ["abs"],
  abs: ["abs"],
  abdominal: ["abs"],
  "six pack": ["abs"],
  core: ["abs", "obliques"],
  oblique: ["obliques"],
  glute: ["glutes"],
  butt: ["glutes"],
  booty: ["glutes"],
  quad: ["quads"],
  quadricep: ["quads"],
  hamstring: ["hamstrings"],
  ham: ["hamstrings"],
  leg: LEGS,
  thigh: ["quads", "hamstrings"],
  "lower body": [...LEGS, "adductors", "abductors"],
  "upper body": ["chest", ...DELTS, ...BACK, "biceps", "triceps"],
  "posterior chain": ["hamstrings", "glutes", "lower_back"],
  adductor: ["adductors"],
  "inner thigh": ["adductors"],
  abductor: ["abductors"],
  "outer thigh": ["abductors"],
  calf: ["calves"],
  calve: ["calves"],
  neck: ["neck"],
};

const PREFER: Record<string, string[]> = { "upper chest": ["incline"], "lower chest": ["decline"] };

const CATEGORY_TERMS: Record<string, ExerciseCategory> = {
  stretch: "stretching",
  stretching: "stretching",
  stretches: "stretching",
  // looseKey folds "stretches" to this
  stretche: "stretching",
  mobility: "stretching",
  cardio: "cardio",
  conditioning: "cardio",
  plyo: "plyometrics",
  plyometric: "plyometrics",
  olympic: "olympic",
  oly: "olympic",
  strongman: "strongman",
};

// words that carry no meaning in a search box
const FILLER = new Set([
  "a",
  "an",
  "and",
  "any",
  "best",
  "can",
  "do",
  "exercise",
  "find",
  "for",
  "good",
  "hit",
  "i",
  "in",
  "just",
  "me",
  "movement",
  "my",
  "of",
  "on",
  "only",
  "or",
  "show",
  "some",
  "something",
  "target",
  "targeting",
  "that",
  "the",
  "to",
  "train",
  "training",
  "using",
  "what",
  "with",
  "work",
  "workout",
]);

const NEGATIONS = new Set(["no", "without", "not"]);

/** "dumbbells" -> "dumbbell", "calves" stays a known word; only plain plural s */
function singular(w: string): string {
  if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) return w.slice(0, -1);
  return w;
}

function lookup<T>(table: Record<string, T>, words: readonly string[]): T | undefined {
  const phrase = words.join(" ");
  if (phrase in table) return table[phrase];
  const sing = [...words.slice(0, -1), singular(words[words.length - 1]!)].join(" ");
  return sing in table ? table[sing] : undefined;
}

const MAX_PHRASE = 3;

/** split a query into structured terms and leftover text */
export function parseExerciseQuery(query: string): ParsedQuery {
  const words = looseKey(query).split(" ").filter(Boolean);
  const out: ParsedQuery = { text: "", equipment: [], excludeEquipment: [], muscles: [], category: null, muscleWords: [], prefer: [] };
  const text: string[] = [];
  const add = <T>(list: T[], items: readonly T[]) => {
    for (const x of items) if (!list.includes(x)) list.push(x);
  };
  let i = 0;
  while (i < words.length) {
    let used = 0;
    for (let n = Math.min(MAX_PHRASE, words.length - i); n >= 1 && !used; n--) {
      const span = words.slice(i, i + n);
      // "no equipment" is a phrase of its own; "no machines" negates what follows
      const eq = lookup(EQUIPMENT_TERMS, span);
      if (eq) {
        add(out.equipment, eq);
        used = n;
        break;
      }
      if (n >= 2 && NEGATIONS.has(span[0]!)) {
        const neg = lookup(EQUIPMENT_TERMS, span.slice(1));
        if (neg) {
          add(out.excludeEquipment, neg);
          used = n;
          break;
        }
      }
      const mu = lookup(MUSCLE_TERMS, span);
      if (mu) {
        add(out.muscles, mu);
        out.muscleWords.push(...span);
        add(out.prefer, PREFER[span.join(" ")] ?? []);
        used = n;
        break;
      }
      const cat = lookup(CATEGORY_TERMS, span);
      if (cat) {
        out.category = cat;
        used = n;
        break;
      }
    }
    if (used) {
      i += used;
      continue;
    }
    const w = words[i]!;
    if (!FILLER.has(w) && !FILLER.has(singular(w))) text.push(w);
    i++;
  }
  out.equipment = out.equipment.filter((e) => !out.excludeEquipment.includes(e));
  out.text = text.join(" ");
  return out;
}

function isStructured(p: ParsedQuery): boolean {
  return p.equipment.length > 0 || p.excludeEquipment.length > 0 || p.muscles.length > 0 || p.category !== null;
}

const USAGE_MAX = 90;
function usageBoost(usage: SearchOptions["usage"], id: string): number {
  const n = usage?.[id];
  if (!n || !(n > 0)) return 0;
  return Math.min(USAGE_MAX, 15 * Math.log2(1 + n));
}

/** 0 when no requested muscle is worked; primary movers score well above helpers */
function muscleScore(e: Exercise, muscles: readonly MuscleRegion[]): number {
  if (!muscles.length) return 0;
  const hits = e.primary.filter((m) => muscles.includes(m)).length;
  if (hits) {
    // the first-listed primary is the main mover; focus rewards exercises mostly about these muscles
    const lead = muscles.includes(e.primary[0]!) ? 25 : 0;
    const focus = Math.round((20 * hits) / e.primary.length);
    return 60 + lead + focus;
  }
  return e.secondary.some((m) => muscles.includes(m)) ? 20 : 0;
}

export interface NlSearchResult extends SearchResult {
  /** how the query was read, for showing "dumbbell · chest" chips */
  parsed: ParsedQuery;
}

/**
 * natural-language search. plain name matches win when they're strong (an
 * exact or alias hit: "back squat" is a lift, not "back" muscles); otherwise
 * terms filter and the leftover text ranks. falls back to plain search.
 */
export function nlSearchExercises(query: string, options?: SearchOptions): NlSearchResult[] {
  const catalog = options?.catalog ?? EXERCISES;
  const limit = Math.max(0, options?.limit ?? 50);
  const usage = options?.usage;
  const parsed = parseExerciseQuery(query);
  const tag = (rs: readonly SearchResult[]): NlSearchResult[] => rs.slice(0, limit).map((r) => ({ ...r, parsed }));
  const plain = () => searchExercises(query, { catalog, usage, limit });

  if (!isStructured(parsed)) return tag(plain());
  const direct = searchExercises(query, { catalog, usage, limit });
  if (direct[0] && (direct[0].tier === "exact" || direct[0].tier === "alias")) return tag(direct);

  const pool = catalog.filter(
    (e) =>
      (!parsed.equipment.length || parsed.equipment.includes(e.equipment)) &&
      !parsed.excludeEquipment.includes(e.equipment) &&
      (parsed.category === null || e.category === parsed.category)
  );
  const worked = parsed.muscles.length ? pool.filter((e) => muscleScore(e, parsed.muscles) > 0) : pool;

  let ranked: SearchResult[];
  if (parsed.text) {
    // name hits that use the muscle word ("leg press" with a machine) first, then text within the muscles
    const named = parsed.muscleWords.length
      ? searchExercises([...parsed.muscleWords, parsed.text].join(" "), { catalog: pool, usage, limit: pool.length }).filter(
          (r) => r.tier !== "fuzzy" && r.tier !== "muscle"
        )
      : [];
    const seen = new Set(named.map((r) => r.exercise.id));
    const within = searchExercises(parsed.text, { catalog: worked, usage, limit: worked.length }).filter(
      (r) => !seen.has(r.exercise.id)
    );
    ranked = [...named, ...within];
  } else {
    const order = new Map(catalog.map((e, i) => [e.id, i]));
    ranked = worked
      .map((e) => {
        // stretches only when asked for: "chest" means presses before doorway stretches
        const off = parsed.category === null && e.category !== "strength" ? -40 : 0;
        const preferred = parsed.prefer.length && looseKey(e.name).split(" ").some((w) => parsed.prefer.includes(w)) ? 30 : 0;
        const score = muscleScore(e, parsed.muscles) + (e.curated ? 40 : 0) + off + preferred + usageBoost(usage, e.id);
        return { exercise: e, tier: "muscle" as const, score };
      })
      .sort(
        (a, b) =>
          b.score - a.score ||
          (a.exercise.curated && b.exercise.curated
            ? order.get(a.exercise.id)! - order.get(b.exercise.id)!
            : a.exercise.name.length - b.exercise.name.length || a.exercise.name.localeCompare(b.exercise.name))
      );
  }
  if (ranked.length) return tag(ranked);
  const fallback = direct.length ? direct : plain();
  return tag(fallback);
}
