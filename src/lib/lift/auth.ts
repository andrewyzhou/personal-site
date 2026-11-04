import { createHash, timingSafeEqual } from "node:crypto";

// constant-time secret compare. hashing first gives equal-length buffers, so
// neither the content nor the length of the secret leaks through timing.
export function safeEqual(given: string | null | undefined, expected: string | null | undefined): boolean {
  if (!expected || given == null) return false;
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

/** true when `Authorization: Bearer <secret>` matches; false when the secret is unset */
export function bearerMatches(header: string | null, secret: string | undefined): boolean {
  if (!secret || !header) return false;
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  return m ? safeEqual(m[1], secret) : false;
}
