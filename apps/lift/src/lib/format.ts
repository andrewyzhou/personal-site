// display helpers. region/equipment ids are snake_case slugs; the app formats
// them itself rather than depending on label maps that may not exist yet.

export function humanize(id: string): string {
  return id.replace(/_/g, " ");
}

export function formatList(ids: readonly string[]): string {
  return ids.map(humanize).join(", ");
}

/** 65_000 -> "1:05", 3_723_000 -> "1:02:03"; negative clamps to 0 (clock skew) */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, "0");
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${ss}`;
  return `${m}:${ss}`;
}

/** default title from the local hour, e.g. "morning workout" */
export function defaultWorkoutTitle(date: Date): string {
  const h = date.getHours();
  if (h < 5) return "night workout";
  if (h < 12) return "morning workout";
  if (h < 17) return "afternoon workout";
  if (h < 21) return "evening workout";
  return "night workout";
}
