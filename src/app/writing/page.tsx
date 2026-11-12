import Link from "next/link";
import type { Metadata } from "next";
import * as content from "@/content";
import { pageTitle } from "@/content/site";
import { formatDay } from "@/content/format";
import Frame, { Empty, countLabel } from "@/components/site/Frame";
import Stars from "@/components/site/Stars";

const site = content.site();

export const metadata: Metadata = {
  title: pageTitle(site, site.sections.writing.label),
  description: site.sections.writing.intro || undefined,
};

function href(item: content.WritingItem): string {
  if (item.kind === "post") return content.urls.post(item.entry.slug);
  return content.urls.item(item.kind, item.entry.slug);
}

// what sits under a title: a post's summary, or a note's one line
function line(item: content.WritingItem): string | undefined {
  return item.entry.summary;
}

// posts and the notes that opted in, newest first. the newest post leads at
// full width; everything after it is a row: date left, title and line right.
export default function WritingPage() {
  const items = content.writing();
  const lead = items.find((i) => i.kind === "post");
  const rest = items.filter((i) => i !== lead);

  return (
    <Frame
      section="writing"
      title={site.sections.writing.label}
      intro={site.sections.writing.intro}
      aside={items.length > 0 ? <span>{countLabel(items.length, site.sectionPages.entries)}</span> : undefined}
    >
      {items.length === 0 ? (
        <section className="py-8">
          <Empty>{site.sectionPages.empty}</Empty>
        </section>
      ) : (
        <>
          {lead && lead.kind === "post" && (
            <section className="py-8">
              <div className="flex flex-col md:flex-row gap-4 md:gap-12 md:items-end">
                <div className="w-full md:w-3/5">
                  <h2 className="font-sans font-bold text-off-white text-4xl" style={{ letterSpacing: "-0.01em", lineHeight: 1.15 }}>
                    <Link href={href(lead)} className="link-highlight">
                      {lead.entry.title}
                    </Link>
                  </h2>
                  <p className="font-sans text-gray text-lg leading-[1.35]" style={{ marginTop: "0.75rem" }}>
                    {lead.entry.summary}
                  </p>
                </div>
                <div className="w-full md:w-2/5 md:text-right font-sans text-gray text-lg">
                  <p className="font-semibold">{formatDay(lead.date)}</p>
                  {lead.entry.tags.length > 0 && <p className="text-sm">{lead.entry.tags.join(" · ")}</p>}
                </div>
              </div>
            </section>
          )}
          {rest.length > 0 && (
            <>
              {lead && <div className="section-divider" />}
              <section className="py-8">
                <ul className="flex flex-col" style={{ gap: "0.4rem" }}>
                  {rest.map((item) => (
                    <li key={`${item.kind}:${item.entry.slug}`}>
                      <Link href={href(item)} className="block rounded card-bg-hover" style={{ padding: "0.35rem 0.5rem" }}>
                        <div className="flex flex-col md:flex-row md:items-baseline gap-1 md:gap-12">
                          <span className="font-sans font-semibold text-gray text-lg md:w-1/5 shrink-0">{formatDay(item.date)}</span>
                          <span className="flex-1 min-w-0">
                            <span className="font-sans text-off-white text-lg">{item.entry.title}</span>
                            {item.kind !== "post" && (
                              <span className="font-sans text-gray text-sm" style={{ marginLeft: "0.6rem" }}>
                                {site.sectionPages.kinds[item.kind]}
                                {item.kind === "reading" && item.entry.rating != null && (
                                  <span style={{ marginLeft: "0.5rem" }}>
                                    <Stars value={item.entry.rating} size="0.8rem" />
                                  </span>
                                )}
                                {item.kind === "screen" && item.entry.latest?.rating != null && (
                                  <span style={{ marginLeft: "0.5rem" }}>
                                    <Stars value={item.entry.latest.rating} size="0.8rem" />
                                  </span>
                                )}
                              </span>
                            )}
                            {line(item) && <span className="font-sans text-gray text-sm block">{line(item)}</span>}
                          </span>
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            </>
          )}
        </>
      )}
    </Frame>
  );
}
