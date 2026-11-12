import * as content from "@/content";
import type { FigureEvent } from "@/lib/figure";

// the figure's loud marks, known when the site is built: every post, and
// everything added to the library (a finished or started book, each viewing
// of a movie or show, a photo set). workouts and code are fetched live.
export function figureMarks(): FigureEvent[] {
  const marks: FigureEvent[] = [];
  for (const p of content.posts()) marks.push({ kind: "writing", date: p.date, label: p.title, href: content.urls.post(p.slug) });
  for (const r of content.reading()) {
    const day = r.dateCompleted ?? r.dateStarted;
    if (day) marks.push({ kind: "library", date: day, label: r.title, href: content.urls.item("reading", r.slug) });
  }
  for (const s of content.screen()) for (const w of s.watches) marks.push({ kind: "library", date: w.date, label: s.title, href: content.urls.item("screen", s.slug) });
  for (const set of content.photoSets()) marks.push({ kind: "library", date: set.date, label: set.title, href: content.urls.item("photos", set.slug) });
  return marks;
}
