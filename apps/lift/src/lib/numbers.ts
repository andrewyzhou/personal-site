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
