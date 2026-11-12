import Link from "next/link";
import type { Metadata } from "next";
import * as content from "@/content";
import { pageTitle } from "@/content/site";
import { formatDay } from "@/content/format";
import Frame, { countLabel } from "@/components/site/Frame";

const site = content.site();

export const metadata: Metadata = {
  title: pageTitle(site, site.sections.library.label),
  description: site.sections.library.intro || undefined,
};

// one square tile per shelf: its name, how much it holds, when it last grew
export default function LibraryPage() {
  const shelves = content.shelves();
  const total = shelves.reduce((n, s) => n + s.count, 0);

  return (
    <Frame section="library" title={site.sections.library.label} intro={site.sections.library.intro} aside={<span>{countLabel(total, site.sectionPages.entries)}</span>}>
      <section className="py-8">
        <ul className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 md:gap-4">
          {shelves.map((s) => (
            <li key={s.id}>
              <Link
                href={content.urls.shelf(s.id)}
                className="card-bg card-bg-hover rounded-lg flex flex-col items-center justify-center text-center transition-colors"
                style={{ aspectRatio: "1 / 1", padding: "1rem" }}
              >
                <span className="font-sans font-bold text-off-white text-2xl" style={{ letterSpacing: "-0.01em" }}>
                  {site.shelves[s.id].label}
                </span>
                <span className="font-sans text-gray text-sm" style={{ marginTop: "0.5rem" }}>
                  {countLabel(s.count, site.sectionPages.entries)}
                </span>
                {s.updated && <span className="font-sans text-gray text-sm">{`${site.sectionPages.updated} ${formatDay(s.updated)}`}</span>}
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </Frame>
  );
}
