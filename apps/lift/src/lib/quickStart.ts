// home's one-tap template buttons: most recently used first, then the rest
// in list order so a new install with templates still shows something.

export interface QuickTemplate {
  id: string;
}

/**
 * `ordered` is the template list as the templates screen shows it (position,
 * then name); `lastUsed` maps template id -> latest workout startedAt.
 */
export function recentTemplates<T extends QuickTemplate>(
  ordered: readonly T[],
  lastUsed: Readonly<Record<string, number>>,
  limit = 4
): T[] {
  const index = new Map(ordered.map((t, i) => [t.id, i]));
  const used = ordered
    .filter((t) => lastUsed[t.id] !== undefined)
    // ties (same start ms) keep list order so the buttons don't shuffle
    .sort((a, b) => lastUsed[b.id]! - lastUsed[a.id]! || index.get(a.id)! - index.get(b.id)!);
  const rest = ordered.filter((t) => lastUsed[t.id] === undefined);
  return [...used, ...rest].slice(0, Math.max(0, limit));
}
