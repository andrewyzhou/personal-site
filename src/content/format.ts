// the site's display formatters. content and pages format through these, so
// every design shows the same date and number strings.

// "2026-05-31" → "may 31, 2026"
export function formatDay(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso + "T00:00:00");
  const month = d.toLocaleDateString("en-US", { month: "short" }).toLowerCase();
  return `${month} ${d.getDate()}, ${d.getFullYear()}`;
}
