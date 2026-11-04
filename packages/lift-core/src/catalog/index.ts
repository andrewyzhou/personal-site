import type { Exercise } from "../types";
import { CURATED_EXERCISES } from "./curated";
import { FREE_DB_ENTRIES, freeEntryToExercise } from "./free";

export { CURATED_EXERCISES, slugify } from "./curated";
export { FREE_DB_ENTRIES, freeEntryToExercise } from "./free";
export type { FreeDbEntry } from "./free";

const linkedFreeIds = new Set(CURATED_EXERCISES.map((e) => e.freeDbId).filter((id): id is string => !!id));
const curatedIds = new Set(CURATED_EXERCISES.map((e) => e.id));

const FREE_EXERCISES: readonly Exercise[] = FREE_DB_ENTRIES.filter((e) => !linkedFreeIds.has(e.id))
  .map(freeEntryToExercise)
  // a curated slug wins; an upstream entry with the same slug gets a stable suffix
  .map((e) => (curatedIds.has(e.id) ? { ...e, id: `${e.id}-fedb` } : e));

/** built-in catalog: curated entries first, then the remaining free-exercise-db entries */
export const EXERCISES: readonly Exercise[] = [...CURATED_EXERCISES, ...FREE_EXERCISES];

const idIndexCache = new WeakMap<readonly Exercise[], Map<string, Exercise>>();

export function getExercise(id: string, catalog: readonly Exercise[] = EXERCISES): Exercise | undefined {
  let index = idIndexCache.get(catalog);
  if (!index) {
    index = new Map();
    for (const e of catalog) if (!index.has(e.id)) index.set(e.id, e);
    idIndexCache.set(catalog, index);
  }
  return index.get(id);
}

/** lowercase, strip punctuation/parens, collapse whitespace: the key used for exact/alias matching */
export function normalizeName(name: string): string {
  return (
    name
      // nfkc folds nbsp, full-width letters and ligatures; nfd then splits off accents
      .normalize("NFKC")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      // apostrophes are dropped, not spaced, so "farmer's" and "farmers" agree
      .replace(/['‘’ʼ`´]/g, "")
      .replace(/[×]/g, " x ")
      .replace(/&/g, " and ")
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
  );
}

// spellings that differ between apps but mean the same thing. keyed per token.
const TOKEN_FOLD: Record<string, string> = {
  biceps: "bicep",
  triceps: "tricep",
  pullup: "pull up",
  pullups: "pull up",
  chinup: "chin up",
  chinups: "chin up",
  pushup: "push up",
  pushups: "push up",
  situp: "sit up",
  situps: "sit up",
  stepup: "step up",
  stepups: "step up",
  skullcrusher: "skull crusher",
  skullcrushers: "skull crusher",
  flye: "fly",
  flyes: "fly",
  flies: "fly",
  crunches: "crunch",
  presses: "press",
  calves: "calf",
  dumbbells: "dumbbell",
  ups: "up",
};

/**
 * looser key than normalizeName: folds plural/singular, "pull-up"/"pullup", "bicep"/"biceps".
 * used only for name resolution, where false positives are cheap to see and fix.
 */
export function looseKey(name: string): string {
  const out: string[] = [];
  for (const tok of normalizeName(name).split(" ")) {
    if (!tok) continue;
    let t = TOKEN_FOLD[tok];
    if (t === undefined) {
      t = tok.length > 3 && tok.endsWith("s") && !tok.endsWith("ss") && !tok.endsWith("us") ? tok.slice(0, -1) : tok;
      t = TOKEN_FOLD[t] ?? t;
    }
    out.push(t);
  }
  return out.join(" ");
}

// share text prints attachment detail after a dash inside the parens: "(Cable - Straight Bar)"
const DASH_SUFFIX = /\(\s*([^()]*?)\s+-\s+[^()]*\)\s*$/;

function reducedSuffix(name: string): string | null {
  return DASH_SUFFIX.test(name) ? name.replace(DASH_SUFFIX, "($1)") : null;
}

/** an entry mapped straight from free-exercise-db (as opposed to curated or user-made) */
export function isUpstream(e: Exercise): boolean {
  return !e.curated && e.freeDbId !== undefined;
}

const nameIndexCache = new WeakMap<readonly Exercise[], Map<string, Exercise>>();

function nameIndex(catalog: readonly Exercise[]): Map<string, Exercise> {
  let index = nameIndexCache.get(catalog);
  if (index) return index;
  const map = new Map<string, Exercise>();
  const add = (key: string, e: Exercise) => {
    if (key && !map.has(key)) map.set(key, e);
  };
  // precedence: curated/custom names, then their aliases, then raw upstream entries,
  // then reduced suffixes. a deliberate curated alias ("split squat") beats an upstream
  // entry that happens to share the name (a stretch called "Split Squats").
  const own = catalog.filter((e) => !isUpstream(e));
  const upstream = catalog.filter(isUpstream);
  for (const group of [own, upstream]) {
    for (const e of group) add(looseKey(e.name), e);
    for (const e of group) for (const a of e.aliases) add(looseKey(a), e);
  }
  for (const e of catalog) {
    const r = reducedSuffix(e.name);
    if (r) add(looseKey(r), e);
  }
  nameIndexCache.set(catalog, map);
  index = map;
  return index;
}

/** exact canonical-name or alias match (after normalizeName); used by the share-text ingest */
export function resolveExerciseName(name: string, catalog: readonly Exercise[] = EXERCISES): Exercise | undefined {
  const index = nameIndex(catalog);
  const hit = index.get(looseKey(name));
  if (hit) return hit;
  const r = reducedSuffix(name);
  const reduced = r ? index.get(looseKey(r)) : undefined;
  if (reduced) return reduced;
  return resolveViaSibling(r ?? name, index);
}

const EQUIPMENT_SUFFIX = /^(.*\S)\s*\(([^()]+)\)\s*$/;

// "Shoulder Press (Dumbbell)": the base resolves through an alias to some variant
// ("Overhead Press (Barbell)"); take that variant's sibling with the same suffix.
function resolveViaSibling(name: string, index: Map<string, Exercise>): Exercise | undefined {
  const m = EQUIPMENT_SUFFIX.exec(name);
  if (!m) return undefined;
  const [, base, suffix] = m;
  const swapped = index.get(looseKey(`${suffix} ${base}`));
  if (swapped) return swapped;
  const variant = index.get(looseKey(base));
  if (!variant) return undefined;
  const vm = EQUIPMENT_SUFFIX.exec(variant.name);
  const variantBase = vm ? vm[1] : variant.name;
  return index.get(looseKey(`${variantBase} (${suffix})`));
}
