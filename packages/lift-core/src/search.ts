import type { Exercise, MuscleRegion, SearchOptions, SearchResult, SearchTier } from "./types";
import { EXERCISES, isUpstream, looseKey, normalizeName } from "./catalog";

// scores are tier base + match quality (0..100) + usage boost (0..USAGE_MAX).
// tiers sit TIER_GAP apart and quality + boost stays below it, so usage reorders
// results inside a tier but can never lift a weaker tier over a stronger one.
const TIER_GAP = 200;
const USAGE_MAX = 90;
const TIER_BASE: Record<SearchTier, number> = {
  exact: 4 * TIER_GAP,
  alias: 3 * TIER_GAP,
  prefix: 2 * TIER_GAP,
  fuzzy: TIER_GAP,
  muscle: 0,
};

const EQUIPMENT_WORDS = new Set([
  "barbell",
  "bb",
  "dumbbell",
  "db",
  "cable",
  "machine",
  "smith",
  "kettlebell",
  "kb",
  "band",
  "ez",
]);

// shorthand people type in a search box
const ABBREVIATIONS: Record<string, string> = { db: "dumbbell", bb: "barbell", kb: "kettlebell" };

const ALL_DELTS: MuscleRegion[] = ["front_delts", "side_delts", "rear_delts"];
const MUSCLE_TERMS: Record<string, MuscleRegion[]> = {
  chest: ["chest"],
  pecs: ["chest"],
  pec: ["chest"],
  shoulder: ALL_DELTS,
  shoulders: ALL_DELTS,
  delt: ALL_DELTS,
  delts: ALL_DELTS,
  deltoid: ALL_DELTS,
  deltoids: ALL_DELTS,
  "front delt": ["front_delts"],
  "front delts": ["front_delts"],
  "anterior delts": ["front_delts"],
  "side delt": ["side_delts"],
  "side delts": ["side_delts"],
  "lateral delts": ["side_delts"],
  "middle delts": ["side_delts"],
  "rear delt": ["rear_delts"],
  "rear delts": ["rear_delts"],
  "posterior delts": ["rear_delts"],
  bicep: ["biceps"],
  biceps: ["biceps"],
  tricep: ["triceps"],
  triceps: ["triceps"],
  arms: ["biceps", "triceps", "forearms"],
  forearm: ["forearms"],
  forearms: ["forearms"],
  grip: ["forearms"],
  traps: ["traps"],
  trapezius: ["traps"],
  lats: ["lats"],
  back: ["lats", "upper_back", "lower_back"],
  "upper back": ["upper_back"],
  "mid back": ["upper_back"],
  "middle back": ["upper_back"],
  rhomboids: ["upper_back"],
  "lower back": ["lower_back"],
  "low back": ["lower_back"],
  abs: ["abs"],
  core: ["abs", "obliques"],
  abdominals: ["abs"],
  obliques: ["obliques"],
  glutes: ["glutes"],
  glute: ["glutes"],
  butt: ["glutes"],
  quads: ["quads"],
  quad: ["quads"],
  quadriceps: ["quads"],
  hamstrings: ["hamstrings"],
  hamstring: ["hamstrings"],
  hams: ["hamstrings"],
  legs: ["quads", "hamstrings", "glutes", "calves"],
  leg: ["quads", "hamstrings", "glutes", "calves"],
  adductors: ["adductors"],
  "inner thigh": ["adductors"],
  abductors: ["abductors"],
  "outer thigh": ["abductors"],
  calves: ["calves"],
  calf: ["calves"],
  neck: ["neck"],
};

interface Field {
  key: string;
  words: string[];
  isName: boolean;
}

interface Entry {
  exercise: Exercise;
  order: number;
  nameKey: string;
  aliasKeys: Set<string>;
  baseKey: string;
  strippedKeys: Set<string>;
  fields: Field[];
  sortName: string;
  shadowed: boolean;
}

const indexCache = new WeakMap<readonly Exercise[], Entry[]>();

function stripEquipment(key: string): string {
  return key
    .split(" ")
    .filter((w) => !EQUIPMENT_WORDS.has(w))
    .join(" ");
}

function buildIndex(catalog: readonly Exercise[]): Entry[] {
  const cached = indexCache.get(catalog);
  if (cached) return cached;
  const entries = catalog.map((exercise, order): Entry => {
    const nameKey = looseKey(exercise.name);
    const baseKey = looseKey(exercise.name.replace(/\s*\([^()]*\)\s*$/, ""));
    const aliasKeys = new Set(exercise.aliases.map(looseKey).filter(Boolean));
    const strippedKeys = new Set<string>();
    for (const k of [...aliasKeys, baseKey]) {
      const s = stripEquipment(k);
      if (s && s !== k) strippedKeys.add(s);
    }
    const fields: Field[] = [{ key: nameKey, words: nameKey.split(" "), isName: true }];
    for (const k of aliasKeys) fields.push({ key: k, words: k.split(" "), isName: false });
    return {
      exercise,
      order,
      nameKey,
      aliasKeys,
      baseKey,
      strippedKeys,
      fields,
      sortName: normalizeName(exercise.name),
      shadowed: false,
    };
  });
  // an upstream entry whose name is also a curated alias ("split squat") would
  // otherwise take the exact tier from the exercise the alias was written for
  const ownAliases = new Set<string>();
  for (const e of entries) if (!isUpstream(e.exercise)) for (const k of e.aliasKeys) ownAliases.add(k);
  for (const e of entries) if (isUpstream(e.exercise) && ownAliases.has(e.nameKey)) e.shadowed = true;
  indexCache.set(catalog, entries);
  return entries;
}

/** optimal string alignment distance (levenshtein + adjacent transpositions), bailing past `max` */
function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const n = b.length;
  let prev2 = new Array<number>(n + 1).fill(0);
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  let cur = new Array<number>(n + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    let rowMin = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    [prev2, prev, cur] = [prev, cur, prev2];
  }
  return prev[n];
}

function typoBudget(token: string): number {
  if (token.length <= 3) return 0;
  if (token.length <= 6) return 1;
  return 2;
}

/** best typo distance from token to a word, also against the word's prefix so partial typing works */
function tokenDistance(token: string, word: string, max: number): number {
  if (word.startsWith(token)) return 0;
  if (max === 0) return 1;
  let d = editDistance(token, word, max);
  if (d > 0 && word.length > token.length) d = Math.min(d, editDistance(token, word.slice(0, token.length), max));
  return d;
}

function prefixQuality(tokens: string[], query: string, field: Field, wholeWords: boolean): number {
  const starts = wholeWords
    ? field.key === query || field.key.startsWith(query + " ")
    : field.key.startsWith(query);
  if (starts) return field.isName ? 100 : 85;
  for (const t of tokens) {
    if (!field.words.some((w) => (wholeWords ? w === t : w.startsWith(t)))) return -1;
  }
  // upstream names often lead with the equipment ("Dumbbell Floor Press"); that
  // shouldn't count as the movement leading
  const leads = !EQUIPMENT_WORDS.has(field.words[0]) && field.words[0].startsWith(tokens[0]) ? 10 : 0;
  return (field.isName ? 70 : 55) + leads;
}

function fuzzyQuality(tokens: string[], field: Field): number {
  let total = 0;
  for (const t of tokens) {
    const max = typoBudget(t);
    let best = max + 1;
    for (const w of field.words) {
      const d = tokenDistance(t, w, max);
      if (d < best) best = d;
      if (best === 0) break;
    }
    if (best > max) return -1;
    total += best;
  }
  return Math.max(1, 100 - 20 * total - (field.isName ? 0 : 10));
}

function usageBoost(usage: Readonly<Record<string, number>> | undefined, id: string): number {
  const n = usage?.[id];
  if (!n || !(n > 0)) return 0;
  return Math.min(USAGE_MAX, 15 * Math.log2(1 + n));
}

function compare(a: SearchResult & { order: number; sortName: string }, b: typeof a): number {
  if (b.score !== a.score) return b.score - a.score;
  if (a.exercise.curated !== b.exercise.curated) return a.exercise.curated ? -1 : 1;
  // curated order encodes "most common variant first"; upstream entries go shortest name first
  if (a.exercise.curated) return a.order - b.order;
  if (a.sortName.length !== b.sortName.length) return a.sortName.length - b.sortName.length;
  return a.sortName < b.sortName ? -1 : a.sortName > b.sortName ? 1 : a.order - b.order;
}

/** ranked search: exact/aliases -> prefix -> fuzzy -> muscle fallback, with a usage boost */
export function searchExercises(query: string, options?: SearchOptions): SearchResult[] {
  const catalog = options?.catalog ?? EXERCISES;
  const limit = Math.max(0, options?.limit ?? 50);
  const usage = options?.usage;
  const entries = buildIndex(catalog);
  const q = looseKey(query);

  if (!q) {
    // browse mode: everything, most used first, then curated, then alphabetical
    return entries
      .map((e) => ({ e, boost: usage?.[e.exercise.id] ?? 0 }))
      .sort(
        (a, b) =>
          b.boost - a.boost ||
          Number(b.e.exercise.curated) - Number(a.e.exercise.curated) ||
          (a.e.sortName < b.e.sortName ? -1 : a.e.sortName > b.e.sortName ? 1 : 0),
      )
      .slice(0, limit)
      .map(({ e }) => ({ exercise: e.exercise, tier: "prefix" as const, score: usageBoost(usage, e.exercise.id) }));
  }

  const tokens = q.split(" ");
  const expanded = tokens.map((t) => ABBREVIATIONS[t] ?? t);
  const hasAbbrev = expanded.some((t, i) => t !== tokens[i]);
  const expandedQuery = expanded.join(" ");
  const muscleRegions = MUSCLE_TERMS[normalizeName(query)] ?? MUSCLE_TERMS[q];
  // a bare muscle word ("abs") shouldn't drag in "abductor" or typo matches ahead of the muscle tier
  const wholeWords = !!muscleRegions;

  const results: (SearchResult & { order: number; sortName: string })[] = [];
  for (const e of entries) {
    let tier: SearchTier | null = null;
    let quality = 0;

    if (e.nameKey === q && !e.shadowed) {
      tier = "exact";
      quality = 100;
    } else if (e.nameKey === q) {
      tier = "alias";
      quality = 90;
    } else if (e.aliasKeys.has(q)) {
      tier = "alias";
      quality = 100;
    } else if (e.baseKey === q) {
      tier = "alias";
      quality = 80;
    } else if (e.strippedKeys.has(q)) {
      tier = "alias";
      quality = 60;
    } else {
      let best = -1;
      for (const f of e.fields) {
        best = Math.max(best, prefixQuality(tokens, q, f, wholeWords));
        if (hasAbbrev) best = Math.max(best, prefixQuality(expanded, expandedQuery, f, wholeWords) - 5);
      }
      if (best >= 0) {
        tier = "prefix";
        quality = best;
      } else if (!wholeWords) {
        for (const f of e.fields) best = Math.max(best, fuzzyQuality(hasAbbrev ? expanded : tokens, f));
        if (best >= 0) {
          tier = "fuzzy";
          quality = best;
        }
      }
      if (tier === null && muscleRegions) {
        if (e.exercise.primary.some((r) => muscleRegions.includes(r))) {
          tier = "muscle";
          quality = 60;
        } else if (e.exercise.secondary.some((r) => muscleRegions.includes(r))) {
          tier = "muscle";
          quality = 30;
        }
      }
    }

    if (tier === null) continue;
    results.push({
      exercise: e.exercise,
      tier,
      score: TIER_BASE[tier] + quality + usageBoost(usage, e.exercise.id),
      order: e.order,
      sortName: e.sortName,
    });
  }

  results.sort(compare);
  return results.slice(0, limit).map(({ exercise, tier, score }) => ({ exercise, tier, score }));
}
