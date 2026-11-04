// text-input parsing for set fields. pure so it runs under vitest in node.

const DECIMAL = /^-?(\d+\.?\d*|\.\d+)$/;
const INTEGER = /^\d+$/;

/**
 * "22,5" -> 22.5, "" -> null, "22." -> 22, "abc" -> null.
 * comma is accepted because eu keyboards only offer "," on the decimal pad.
 * negatives are allowed: assisted sets log a negative load.
 */
export function parseDecimal(text: string): number | null {
  const s = text.trim().replace(",", ".");
  if (s === "" || !DECIMAL.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** reps and seconds: whole, non-negative. "8" -> 8, "8.5" / "-1" / "" -> null */
export function parseCount(text: string): number | null {
  const s = text.trim();
  if (!INTEGER.test(s)) return null;
  const n = Number(s);
  return Number.isSafeInteger(n) ? n : null;
}

/** inverse of parseDecimal for prefilling inputs; avoids float noise like 22.500000001 */
export function formatDecimal(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "";
  return String(Math.round(n * 1000) / 1000);
}

export function formatCount(n: number | null | undefined): string {
  return n == null ? "" : String(n);
}

// --- server bounds ----------------------------------------------------------
// mirrors src/lib/lift/sync/validate.ts. the server rejects an out-of-range
// row forever, so a fat-fingered "1000000" is clamped here instead.

export type NumericField = "weight" | "reps" | "durationS" | "distanceM" | "rpe" | "bodyweight";

export const NUMERIC_LIMITS: Record<NumericField, { min: number; max: number; integer: boolean }> = {
  weight: { min: -100_000, max: 100_000, integer: false },
  reps: { min: 0, max: 100_000, integer: true },
  durationS: { min: 0, max: 10_000_000, integer: true },
  distanceM: { min: 0, max: 10_000_000, integer: false },
  rpe: { min: 0, max: 10, integer: false },
  bodyweight: { min: 0.001, max: 100_000, integer: false },
};

/** workout.title on the server; names are validated shorter (80) already */
export const MAX_TITLE_LENGTH = 500;
/** notes on every entity */
export const MAX_NOTE_LENGTH = 10_000;

export function clampNumber(n: number | null | undefined, field: NumericField): number | null {
  if (n == null || !Number.isFinite(n)) return null;
  const { min, max, integer } = NUMERIC_LIMITS[field];
  const v = integer ? Math.round(n) : n;
  return Math.min(max, Math.max(min, v));
}

/** trimmed and cut to the server limit; empty -> null */
export function cleanNote(text: string | null | undefined, max = MAX_NOTE_LENGTH): string | null {
  const t = text?.trim() ?? "";
  return t ? t.slice(0, max) : null;
}

export function clampTitle(text: string): string {
  return text.slice(0, MAX_TITLE_LENGTH);
}

type SetNumbers = Partial<Record<"weight" | "reps" | "durationS" | "distanceM" | "rpe", number | null>>;

/** clamps whichever numeric set fields are present; absent keys stay absent */
export function clampSetNumbers<T extends SetNumbers>(patch: T): T {
  const out = { ...patch };
  for (const f of ["weight", "reps", "durationS", "distanceM", "rpe"] as const) {
    if (f in out) (out as SetNumbers)[f] = clampNumber(out[f], f);
  }
  return out;
}
