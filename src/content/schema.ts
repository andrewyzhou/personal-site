// a small schema kit for content files: describe a kind's fields once, get
// both its typescript type and a validator that reports every problem with
// the path to it. no dependencies, safe to import anywhere (no fs).

type Check = (value: unknown, at: string, errors: string[]) => void;

export interface Field<T, Opt extends boolean = boolean> {
  readonly check: Check;
  readonly isOptional: Opt;
  // type carrier only, never set
  readonly __type?: T;
}

export type Shape = Record<string, Field<unknown>>;

type RequiredKeys<S extends Shape> = { [K in keyof S]: S[K] extends Field<unknown, true> ? never : K }[keyof S];
type OptionalKeys<S extends Shape> = { [K in keyof S]: S[K] extends Field<unknown, true> ? K : never }[keyof S];
type TypeOf<F> = F extends Field<infer T> ? T : never;

// the typescript type a shape describes
export type Infer<S extends Shape> = { [K in RequiredKeys<S>]: TypeOf<S[K]> } & { [K in OptionalKeys<S>]?: TypeOf<S[K]> };

function field<T>(check: Check): Field<T, false> {
  return { check, isOptional: false };
}

// marks a field as one that may be left out
export function optional<T>(f: Field<T>): Field<T, true> {
  return { check: f.check, isOptional: true };
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

// non-empty text
export const text = () =>
  field<string>((v, at, e) => {
    if (typeof v !== "string" || v.trim() === "") e.push(`${at}: must be text`);
  });

// text that may be empty (wording still to be written)
export const anyText = () =>
  field<string>((v, at, e) => {
    if (typeof v !== "string") e.push(`${at}: must be text`);
  });

// a calendar day, yyyy-mm-dd
export const date = () =>
  field<string>((v, at, e) => {
    if (typeof v !== "string" || !DATE_RE.test(v) || Number.isNaN(Date.parse(v))) e.push(`${at}: must be a date like 2026-05-31`);
  });

export const number = (range?: { min?: number; max?: number }) =>
  field<number>((v, at, e) => {
    if (typeof v !== "number" || Number.isNaN(v)) e.push(`${at}: must be a number`);
    else if (range?.min !== undefined && v < range.min) e.push(`${at}: must be at least ${range.min}`);
    else if (range?.max !== undefined && v > range.max) e.push(`${at}: must be at most ${range.max}`);
  });

// a rating out of five, in half stars
export const stars = () =>
  field<number>((v, at, e) => {
    if (typeof v !== "number" || v < 0.5 || v > 5 || (v * 2) % 1 !== 0) e.push(`${at}: must be 0.5 to 5 in half stars`);
  });

export const bool = () =>
  field<boolean>((v, at, e) => {
    if (typeof v !== "boolean") e.push(`${at}: must be true or false`);
  });

export const oneOf = <const T extends string>(values: readonly T[]) =>
  field<T>((v, at, e) => {
    if (typeof v !== "string" || !values.includes(v as T)) e.push(`${at}: must be one of ${values.join(", ")}`);
  });

export const list = <T>(item: Field<T>, opts?: { min?: number }) =>
  field<T[]>((v, at, e) => {
    if (!Array.isArray(v)) {
      e.push(`${at}: must be a list`);
      return;
    }
    if (opts?.min !== undefined && v.length < opts.min) e.push(`${at}: needs at least ${opts.min}`);
    v.forEach((x, i) => item.check(x, `${at}[${i + 1}]`, e));
  });

export const object = <S extends Shape>(shape: S) =>
  field<Infer<S>>((v, at, e) => {
    checkShape(shape, v, at, e);
  });

// a map from any key to a value of one type (section blurbs)
export const record = <T>(value: Field<T>) =>
  field<Record<string, T>>((v, at, e) => {
    if (!isRecord(v)) {
      e.push(`${at}: must be a set of key: value pairs`);
      return;
    }
    for (const [k, x] of Object.entries(v)) if (x !== null && x !== undefined) value.check(x, at ? `${at}.${k}` : k, e);
  });

function checkShape(shape: Shape, data: unknown, at: string, errors: string[]): void {
  if (!isRecord(data)) {
    errors.push(`${at || "entry"}: must be a set of fields`);
    return;
  }
  for (const [key, f] of Object.entries(shape)) {
    const value = data[key];
    const path = at ? `${at}.${key}` : key;
    if (value === undefined || value === null) {
      if (!f.isOptional) errors.push(`${path}: is required`);
      continue;
    }
    f.check(value, path, errors);
  }
}

// every problem in `data` against `shape`; empty when it is valid. unknown
// keys are allowed, so adding a field to a file never breaks older code.
export function problems(shape: Shape, data: unknown): string[] {
  const errors: string[] = [];
  checkShape(shape, data, "", errors);
  return errors;
}

// problems for a value that isn't a set of fields (a list file)
export function problemsOf(f: Field<unknown>, data: unknown, name: string): string[] {
  const errors: string[] = [];
  f.check(data, name, errors);
  return errors;
}
