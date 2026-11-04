// shape usage-count rows into the map searchExercises expects for its boost.

export function toUsageMap(rows: readonly { exerciseId: string; count: number }[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) out[r.exerciseId] = (out[r.exerciseId] ?? 0) + Number(r.count);
  return out;
}
