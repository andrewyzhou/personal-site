import path from "path";

// where authored content lives. production and dev always read the repo's
// content/ folder; the design test harness points this at a frozen fixture
// copy so content edits never invalidate the v1 screenshot baselines.
export const CONTENT_ROOT = process.env.CONTENT_ROOT
  ? path.resolve(process.env.CONTENT_ROOT)
  : path.join(process.cwd(), "content");

export function contentPath(...parts: string[]): string {
  return path.join(CONTENT_ROOT, ...parts);
}
