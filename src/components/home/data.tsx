import * as content from "@/content";
import { formatDay } from "@/content/format";
import ItemContent from "@/components/mdx/ItemContent";
import { figureMarks } from "@/components/figure/marks";
import { countLabel } from "@/components/site/Frame";
import type { FigureEvent } from "@/lib/figure";
import type { HomeRole, HomeShelf, HomeWritingRow } from "./HomeSections";

// what every home layout needs from the content module, shaped for the parts
// that show it. a layout decides where things go; this decides nothing.
export interface HomeData {
  quotes: string[];
  roles: HomeRole[];
  writing: HomeWritingRow[];
  shelves: HomeShelf[];
  marks: FigureEvent[];
  // the newest post, if there is one
  latest: { href: string; title: string; summary: string; dateLabel: string } | null;
  // the last few things added to the library, newest first
  recent: { href?: string; title: string; dateLabel: string }[];
}

export function homeData(): HomeData {
  const site = content.site();
  const marks = figureMarks();
  const newest = [...content.posts()].sort((a, b) => b.date.localeCompare(a.date))[0];

  return {
    quotes: content.quotes().map((q) => `${q.text}\n- ${q.attribution}`),
    roles: content.allRoles().map((r) => ({
      id: `${r.group}/${r.slug}`,
      group: r.group,
      title: r.title,
      company: r.company,
      companyUrl: r.companyUrl,
      location: r.location,
      period: r.period,
      year: r.year,
      description: <ItemContent category={r.group} slug={r.slug} />,
    })),
    writing: content
      .writing()
      .slice(0, 6)
      .map((w) => ({
        href: w.kind === "post" ? content.urls.post(w.entry.slug) : content.urls.item(w.kind, w.entry.slug),
        title: w.entry.title,
        line: w.entry.summary,
        dateLabel: formatDay(w.date),
        kindLabel: w.kind === "post" ? undefined : site.sectionPages.kinds[w.kind],
      })),
    shelves: content.shelves().map((s) => ({
      href: content.urls.shelf(s.id),
      label: site.shelves[s.id].label,
      count: countLabel(s.count, site.sectionPages.entries),
      updated: s.updated ? `${site.sectionPages.updated} ${formatDay(s.updated)}` : undefined,
    })),
    marks,
    latest: newest ? { href: content.urls.post(newest.slug), title: newest.title, summary: newest.summary, dateLabel: formatDay(newest.date) } : null,
    recent: marks
      .filter((m) => m.kind === "library")
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 4)
      .map((m) => ({ href: m.href, title: m.label, dateLabel: formatDay(m.date) })),
  };
}
