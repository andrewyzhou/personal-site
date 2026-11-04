import { createHmac } from "node:crypto";

// internal workout ids leak things ("strong-<slug>" is the share link, the sha
// form can be brute-forced back to the start minute), so public urls carry an
// hmac of the id instead. no secret means no lift-only pages at all.

export const PUBLIC_LIFT_ID_RE = /^[A-Za-z0-9_-]{16}$/;

function secret(): string | null {
  return process.env.LIFT_PUBLIC_ID_SECRET || process.env.AUTH_SECRET || null;
}

/** true when lift-only pages can be served (a secret is configured) */
export function publicLiftIdsEnabled(): boolean {
  return secret() !== null;
}

/** opaque, stable public id for a workout; null when no secret is set */
export function publicLiftId(workoutId: string): string | null {
  const key = secret();
  if (!key) return null;
  return createHmac("sha256", key).update(workoutId).digest("base64url").slice(0, 16);
}

/** shape check before any lookup */
export function isPublicLiftId(id: string): boolean {
  return PUBLIC_LIFT_ID_RE.test(id);
}
