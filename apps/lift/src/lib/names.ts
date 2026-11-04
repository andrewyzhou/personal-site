// name cleanup + validation for folders, templates and custom exercises.

export const MAX_NAME_LENGTH = 80;

export type NameCheck = { ok: true; name: string } | { ok: false; error: string };

/** trim and collapse inner whitespace, so "  bench   day " and "bench day" agree */
export function cleanName(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

/** case/space-insensitive key for duplicate checks */
export function nameKeyLoose(raw: string): string {
  return cleanName(raw).toLowerCase();
}

export interface NameRules {
  /** names already taken (the item being renamed should be left out) */
  taken?: readonly string[];
  max?: number;
}

export function validateName(raw: string, rules: NameRules = {}): NameCheck {
  const name = cleanName(raw);
  if (!name) return { ok: false, error: "name is required" };
  if (name.length > (rules.max ?? MAX_NAME_LENGTH)) return { ok: false, error: "name is too long" };
  const key = name.toLowerCase();
  if (rules.taken?.some((t) => nameKeyLoose(t) === key)) return { ok: false, error: "that name is taken" };
  return { ok: true, name };
}

/** "push day" -> "push day copy", then "push day copy 2", ... */
export function copyName(name: string, taken: readonly string[]): string {
  const keys = new Set(taken.map(nameKeyLoose));
  const base = `${cleanName(name)} copy`;
  if (!keys.has(base.toLowerCase())) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base} ${n}`;
    if (!keys.has(candidate.toLowerCase())) return candidate;
  }
}
