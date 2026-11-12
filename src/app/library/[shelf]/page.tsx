import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import * as content from "@/content";
import { SHELVES, SHELF_PATHS, shelfFromPath, type ShelfId } from "@/content/kinds";
import { pageTitle } from "@/content/site";
import { formatDay } from "@/content/format";
import Frame, { Empty, countLabel } from "@/components/site/Frame";
import Stars from "@/components/site/Stars";
import ItemContent from "@/components/mdx/ItemContent";
import JustifiedLayout from "@/components/photos/JustifiedLayout";

const site = content.site();

interface PageProps {
  params: Promise<{ shelf: string }>;
}

export const dynamicParams = false;

export function generateStaticParams() {
  return SHELVES.map((id) => ({ shelf: SHELF_PATHS[id] }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const id = shelfFromPath((await params).shelf);
  if (!id) return { title: pageTitle(site, site.site.notFoundTitle) };
  return { title: pageTitle(site, site.shelves[id].label, site.sections.library.label), description: site.shelves[id].intro || undefined };
}

function Reading() {
  const entries = content.reading();
  if (entries.length === 0) return <Empty>{site.sectionPages.empty}</Empty>;
  return (
    <ul className="flex flex-col" style={{ gap: "0.4rem" }}>
      {entries.map((e) => {
        const when = e.dateCompleted
          ? `${site.sectionPages.finished} ${formatDay(e.dateCompleted)}`
          : e.dateStarted
            ? `${site.sectionPages.started} ${formatDay(e.dateStarted)}`
            : site.sectionPages.inProgress;
        return (
          <li key={e.slug}>
            <Link href={content.urls.item("reading", e.slug)} className="block rounded card-bg-hover" style={{ padding: "0.35rem 0.5rem" }}>
              <div className="flex items-baseline justify-between gap-4">
                <span className="font-sans text-off-white text-lg">{e.title}</span>
                <span className="shrink-0">
                  <Stars value={e.rating} />
                </span>
              </div>
              <div className="flex items-baseline justify-between gap-4" style={{ marginTop: "-0.15rem" }}>
                <span className="font-sans text-gray text-sm">{e.creator}</span>
                <span className="font-sans text-gray text-sm shrink-0">{when}</span>
              </div>
              <p className="font-sans text-gray text-sm leading-[1.35]" style={{ marginTop: "0.25rem", maxWidth: "720px" }}>
                {e.summary}
              </p>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function Screen() {
  const entries = content.screen();
  if (entries.length === 0) return <Empty>{site.sectionPages.empty}</Empty>;
  return (
    <ul className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-4">
      {entries.map((e) => (
        <li key={e.slug}>
          <Link href={content.urls.item("screen", e.slug)} className="block group">
            <div className="card-bg rounded-lg overflow-hidden flex items-center justify-center text-center" style={{ aspectRatio: "2 / 3", position: "relative" }}>
              {e.cover ? (
                <Image src={e.cover} alt="" fill sizes="(min-width: 1024px) 190px, (min-width: 640px) 25vw, 50vw" style={{ objectFit: "cover" }} />
              ) : (
                <span className="font-sans text-gray text-lg" style={{ padding: "0.75rem" }}>
                  {e.title}
                </span>
              )}
            </div>
            <p className="font-sans text-off-white text-base leading-[1.25]" style={{ marginTop: "0.5rem" }}>
              {e.title}
            </p>
            <p className="font-sans text-gray text-sm">
              {[site.sectionPages.formats[e.format], e.year].filter(Boolean).join(" · ")}
              {e.rewatches > 0 && ` · ${site.sectionPages.rewatched.replace("{n}", String(e.watches.length))}`}
            </p>
            {e.latest ? <Stars value={e.latest.rating} size="0.9rem" /> : <p className="font-sans text-gray text-sm italic">{site.sectionPages.toWatch}</p>}
          </Link>
        </li>
      ))}
    </ul>
  );
}

function Photos() {
  const sets = content.photoSets();
  if (sets.length === 0) return <Empty>{site.sectionPages.empty}</Empty>;
  return <JustifiedLayout sets={sets} />;
}

function Projects() {
  const projects = content.projects();
  if (projects.length === 0) return <Empty>{site.sectionPages.empty}</Empty>;
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {projects.map((p) => (
        <article key={p.slug} className="card-bg rounded-lg" style={{ padding: "1rem", paddingLeft: "1.25rem" }}>
          <div className="flex justify-between" style={{ marginBottom: "0.5rem" }}>
            <div>
              <h2 className="font-sans text-off-white text-lg font-bold">{p.title}</h2>
              {p.companyUrl ? (
                <a href={p.companyUrl} target="_blank" rel="noopener noreferrer" className="font-sans text-secondary text-lg link-highlight inline-block">
                  {p.company}
                </a>
              ) : (
                <p className="font-sans text-secondary text-lg italic">{p.company}</p>
              )}
            </div>
            <span className="font-sans font-semibold text-gray text-lg shrink-0" style={{ marginLeft: "1rem" }}>
              {p.period || p.year}
            </span>
          </div>
          <div className="font-sans text-gray text-lg leading-[1.35]">
            <ItemContent category="projects" slug={p.slug} />
          </div>
        </article>
      ))}
    </div>
  );
}

function Coursework() {
  const semesters = content.coursework();
  if (semesters.length === 0) return <Empty>{site.sectionPages.empty}</Empty>;
  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {semesters.map((semester) => (
          <div key={semester.name} className="card-bg rounded-lg" style={{ padding: "1rem", paddingLeft: "1.25rem" }}>
            <h2 className="font-sans text-off-white text-lg font-bold mb-4">{semester.name}</h2>
            <ul className="space-y-2">
              {semester.courses.map((course) => {
                const links = [...(course.cheatsheets ?? []), ...(course.links ?? [])];
                return (
                  <li key={course.code} className="font-sans text-gray text-lg leading-[1.35]">
                    <span className="text-off-white">{course.code}</span>: {course.title}
                    {links.length > 0 && (
                      <span>
                        {" ("}
                        {links.map((l, i) => (
                          <span key={`${l.label}:${l.url}`}>
                            <a href={l.url} target="_blank" rel="noopener noreferrer" className="link-highlight">
                              {l.label}
                            </a>
                            {i < links.length - 1 && ", "}
                          </span>
                        ))}
                        {")"}
                      </span>
                    )}
                    {course.review && <span className="block text-sm">{course.review}</span>}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
      <p className="font-sans text-gray text-lg" style={{ marginTop: "2rem" }}>
        {site.experience.courseworkFootnote}
      </p>
    </>
  );
}

const BODY: Record<ShelfId, () => React.ReactNode> = { reading: Reading, screen: Screen, photos: Photos, projects: Projects, coursework: Coursework };

export default async function ShelfPage({ params }: PageProps) {
  const id = shelfFromPath((await params).shelf);
  if (!id) notFound();
  const shelf = content.shelves().find((s) => s.id === id)!;
  const Body = BODY[id];

  return (
    <Frame
      section="library"
      trail={[{ label: site.sections.library.label, href: content.urls.section("library") }]}
      title={site.shelves[id].label}
      intro={site.shelves[id].intro}
      aside={
        <>
          <span>{countLabel(shelf.count, site.sectionPages.entries)}</span>
          {shelf.updated && <span className="text-sm">{`${site.sectionPages.updated} ${formatDay(shelf.updated)}`}</span>}
        </>
      }
    >
      <section className="py-8">
        <Body />
      </section>
    </Frame>
  );
}
