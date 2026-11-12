import Image from "next/image";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import * as content from "@/content";
import { SHELF_PATHS, shelfFromPath } from "@/content/kinds";
import { pageTitle } from "@/content/site";
import { formatDay } from "@/content/format";
import { getAdjacentPhotosets } from "@/lib/photos";
import Frame from "@/components/site/Frame";
import Stars from "@/components/site/Stars";
import RenderMdx from "@/components/site/RenderMdx";
import { Figure } from "@/components/blog/mdx";
import PhotosetViewer from "@/components/photos/PhotosetViewer";
import EssayViewer from "@/components/photos/EssayViewer";
import EngagementSection from "@/components/EngagementSection";

const site = content.site();

interface PageProps {
  params: Promise<{ shelf: string; item: string }>;
}

export const dynamicParams = false;

// the shelves whose entries have a page of their own
export function generateStaticParams() {
  return [
    ...content.reading().map((e) => ({ shelf: SHELF_PATHS.reading, item: e.slug })),
    ...content.screen().map((e) => ({ shelf: SHELF_PATHS.screen, item: e.slug })),
    ...content.photoSets().map((e) => ({ shelf: SHELF_PATHS.photos, item: e.slug })),
  ];
}

function find(shelfPath: string, slug: string) {
  const shelf = shelfFromPath(shelfPath);
  if (shelf === "reading") {
    const entry = content.reading().find((e) => e.slug === slug);
    return entry ? ({ shelf, entry } as const) : null;
  }
  if (shelf === "screen") {
    const entry = content.screen().find((e) => e.slug === slug);
    return entry ? ({ shelf, entry } as const) : null;
  }
  if (shelf === "photos") {
    const entry = content.photoSets().find((e) => e.slug === slug);
    return entry ? ({ shelf, entry } as const) : null;
  }
  return null;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { shelf, item } = await params;
  const found = find(shelf, item);
  if (!found) return { title: pageTitle(site, site.site.notFoundTitle) };
  const description = found.shelf === "photos" ? found.entry.caption : found.entry.summary;
  return { title: pageTitle(site, found.entry.title, site.shelves[found.shelf].label), description: description || undefined };
}

const Tags = ({ tags }: { tags: string[] }) => (tags.length > 0 ? <p className="text-sm">{tags.join(" · ")}</p> : null);

export default async function ItemPage({ params }: PageProps) {
  const { shelf: shelfPath, item } = await params;
  const found = find(shelfPath, item);
  if (!found) notFound();

  const trail = [
    { label: site.sections.library.label, href: content.urls.section("library") },
    { label: site.shelves[found.shelf].label, href: content.urls.shelf(found.shelf) },
  ];

  if (found.shelf === "photos") {
    const set = found.entry;
    const { prev, next } = getAdjacentPhotosets(set.slug);
    const shared = { slug: set.slug, title: set.title, date: set.date, caption: set.caption, prevSlug: prev?.slug ?? null, nextSlug: next?.slug ?? null };
    return (
      <Frame section="library" trail={trail} title={set.title} aside={<p className="font-semibold">{formatDay(set.date)}</p>}>
        <section className="py-8">
          {set.kind === "essay" ? <EssayViewer {...shared} blocks={set.blocks} /> : <PhotosetViewer {...shared} photos={set.photos} />}
          <div style={{ maxWidth: "720px", margin: "0 auto" }}>
            <EngagementSection target={`photos:${set.slug}`} />
          </div>
        </section>
      </Frame>
    );
  }

  if (found.shelf === "reading") {
    const e = found.entry;
    const dates = [
      e.dateStarted && `${site.sectionPages.started} ${formatDay(e.dateStarted)}`,
      e.dateCompleted ? `${site.sectionPages.finished} ${formatDay(e.dateCompleted)}` : site.sectionPages.inProgress,
    ].filter((d): d is string => !!d);
    return (
      <Frame
        section="library"
        trail={trail}
        title={e.title}
        aside={
          <>
            <p className="font-semibold text-off-white">{e.creator}</p>
            <Stars value={e.rating} size="1.25rem" />
            {dates.map((d) => (
              <p key={d} className="text-sm">
                {d}
              </p>
            ))}
            <Tags tags={e.tags} />
            {e.sourceUrl && (
              <a href={e.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-sm link-highlight">
                {`${site.sectionPages.source} ↗`}
              </a>
            )}
          </>
        }
      >
        <section className="py-8">
          <article style={{ maxWidth: "720px" }}>
            <p className="font-sans text-off-white text-lg italic leading-[1.5]" style={{ marginBottom: "2rem" }}>
              {e.summary}
            </p>
            {e.cover && <Figure src={e.cover} alt={e.title} />}
            <RenderMdx source={e.body} />
          </article>
        </section>
      </Frame>
    );
  }

  const e = found.entry;
  return (
    <Frame
      section="library"
      trail={trail}
      title={e.title}
      aside={
        <>
          <p className="font-semibold text-off-white">{[site.sectionPages.formats[e.format], e.year].filter(Boolean).join(" · ")}</p>
          {e.latest ? <Stars value={e.latest.rating} size="1.25rem" /> : <p className="text-sm italic">{site.sectionPages.toWatch}</p>}
          {e.rewatches > 0 && <p className="text-sm">{site.sectionPages.rewatched.replace("{n}", String(e.watches.length))}</p>}
          <Tags tags={e.tags} />
          {e.sourceUrl && (
            <a href={e.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-sm link-highlight">
              {`${site.sectionPages.source} ↗`}
            </a>
          )}
        </>
      }
    >
      <section className="py-8">
        <div className="flex flex-col md:flex-row gap-8 md:gap-12">
          <article className="w-full md:w-3/5" style={{ maxWidth: "720px" }}>
            {e.summary && (
              <p className="font-sans text-off-white text-lg italic leading-[1.5]" style={{ marginBottom: "2rem" }}>
                {e.summary}
              </p>
            )}
            <RenderMdx source={e.body} />

            {/* every viewing, newest first, each with its own rating and review */}
            {e.watches.length > 0 && (
              <ul className="flex flex-col gap-4" style={{ marginTop: "2rem" }}>
                {e.watches.map((w) => (
                  <li key={w.date} className="card-bg rounded-lg" style={{ padding: "1rem", paddingLeft: "1.25rem" }}>
                    <div className="flex items-baseline justify-between gap-4">
                      <span className="font-sans font-semibold text-gray text-lg">{`${site.sectionPages.watched} ${formatDay(w.date)}`}</span>
                      <Stars value={w.rating} />
                    </div>
                    {w.review && (
                      <p className="font-sans text-gray text-lg leading-[1.35]" style={{ marginTop: "0.5rem", whiteSpace: "pre-line" }}>
                        {w.review}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </article>
          {e.cover && (
            <aside className="w-full md:w-2/5 flex md:justify-end">
              <div className="card-bg rounded-lg overflow-hidden" style={{ position: "relative", width: "min(100%, 300px)", aspectRatio: "2 / 3" }}>
                <Image src={e.cover} alt="" fill sizes="300px" style={{ objectFit: "cover" }} />
              </div>
            </aside>
          )}
        </div>
      </section>
    </Frame>
  );
}
