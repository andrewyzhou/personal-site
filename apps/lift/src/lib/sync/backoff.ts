// retry spacing for auto-sync after failures. manual "sync now" ignores it.

export interface BackoffOptions {
  baseMs?: number;
  maxMs?: number;
  random?: () => number;
}

/** delay before the next attempt after `failures` consecutive failures (>= 1) */
export function backoffDelay(failures: number, options: BackoffOptions = {}): number {
  const base = options.baseMs ?? 30_000;
  const max = options.maxMs ?? 30 * 60_000;
  const random = options.random ?? Math.random;
  if (failures <= 0) return 0;
  const cap = Math.min(max, base * 2 ** Math.min(failures - 1, 30));
  // half fixed, half jitter: spreads retries without ever retrying instantly
  return Math.round(cap / 2 + (random() * cap) / 2);
}
