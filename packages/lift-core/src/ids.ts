// stable ids shared by the site (strong ingest) and the phone (custom exercises),
// so the same custom name maps to the same exercise row on both sides.

/** hex sha-256 of the utf-8 bytes of `text` (pure ts, no platform crypto) */
export function sha256Hex(text: string): string {
  void text;
  throw new Error("not implemented");
}

/** normalizeName, or the nfkc-lowercased raw name when normalizing leaves nothing (non-latin names) */
export function nameKey(name: string): string {
  void name;
  throw new Error("not implemented");
}

/** "custom-" + first 12 hex of sha256(nameKey(name)); fixed at creation, renames keep it */
export function customExerciseId(name: string): string {
  void name;
  throw new Error("not implemented");
}
