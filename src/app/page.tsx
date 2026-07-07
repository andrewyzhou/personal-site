import Hero from "@/components/Hero";
import Experience, { LibraryPreviewItem, BlogPreviewItem, PhotosetPreviewItem } from "@/components/Experience";
import GitHubActivity from "@/components/GitHubActivity";
import Currently from "@/components/Currently";
import Contact from "@/components/Contact";
import ActivityCalendar from "@/components/ActivityCalendar";
import ErrorBoundary from "@/components/ErrorBoundary";
import Bio from "@/components/mdx/Bio";
import ItemContent from "@/components/mdx/ItemContent";
import { getAllEntries } from "@/lib/library";
import { getAllPosts } from "@/lib/blog";
import { getAllPhotosets } from "@/lib/photos";
import { getItems, type ItemCategory } from "@/lib/items";
import { getHeroQuotes, getSectionDescriptions, getCoursework } from "@/lib/content";

function loadCategory(category: ItemCategory) {
  return getItems(category).map((m) => ({
    id: m.slug,
    title: m.title,
    company: m.company,
    companyUrl: m.companyUrl,
    location: m.location,
    period: m.period,
    year: m.year,
    description: <ItemContent category={category} slug={m.slug} />,
  }));
}

function formatDateLabel(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso + "T00:00:00");
  const month = d.toLocaleDateString("en-US", { month: "short" }).toLowerCase();
  return `${month} ${d.getDate()}, ${d.getFullYear()}`;
}

export default function Home() {
  const workItems = loadCategory("work");
  const researchItems = loadCategory("research");
  const teachingItems = loadCategory("teaching");
  const projectsItems = loadCategory("projects");

  const libraryPreview: LibraryPreviewItem[] = getAllEntries().slice(0, 5).map((e) => {
    const dateLabel = e.dateCompleted
      ? `completed ${formatDateLabel(e.dateCompleted)}`
      : e.dateStarted
      ? `started ${formatDateLabel(e.dateStarted)}`
      : "in progress";
    const year =
      (e.dateCompleted ?? e.dateStarted ?? "").slice(0, 4) || "";
    return {
      slug: e.slug,
      title: e.title,
      creator: e.creator,
      type: e.type,
      summary: e.summary,
      dateLabel,
      year,
    };
  });

  const blogPreview: BlogPreviewItem[] = getAllPosts().slice(0, 5).map((p) => ({
    slug: p.slug,
    title: p.title,
    summary: p.summary,
    dateLabel: formatDateLabel(p.date),
    year: (p.date ?? "").slice(0, 4) || "",
  }));

  const photosPreview: PhotosetPreviewItem[] = getAllPhotosets().slice(0, 5).map((s) => ({
    slug: s.slug,
    title: s.title,
    caption: s.caption,
    dateLabel: formatDateLabel(s.date),
    year: (s.date ?? "").slice(0, 4) || "",
    count: s.photoCount,
  }));

  return (
    <main className="site-container">
      {/* section 1: hero */}
      <Hero quotes={getHeroQuotes()} />
      <div className="section-divider" />

      {/* section 2: experience/work/research/teaching/projects/library */}
      <Experience
        libraryPreview={libraryPreview}
        blogPreview={blogPreview}
        photosPreview={photosPreview}
        sectionDescriptions={getSectionDescriptions()}
        semesters={getCoursework()}
        bio={<Bio />}
        workItems={workItems}
        researchItems={researchItems}
        teachingItems={teachingItems}
        projectsItems={projectsItems}
      />
      <div className="section-divider" />

      {/* section 3: currently + contact */}
      <section className="py-16">
        <div className="flex flex-col sm:flex-row justify-between gap-12">
          {/* left side - currently */}
          <div className="w-full sm:w-1/2">
            <ErrorBoundary fallback={<p className="font-sans text-gray text-lg">couldn&apos;t load this section.</p>}>
              <Currently />
            </ErrorBoundary>
          </div>

          {/* right side - contact */}
          <div className="w-full sm:w-1/2">
            <Contact />
          </div>
        </div>
      </section>
      <div className="section-divider" />

      {/* section 4: github activity + strava calendar */}
      <section className="py-16">
        {/* heading - visible on mobile only, above everything */}
        <h3 className="font-sans font-bold text-off-white text-3xl activity-stack:hidden" style={{ marginBottom: '1rem' }}>
          activity
        </h3>

        <div className="flex flex-col activity-stack:flex-row justify-between gap-8 activity-stack:gap-12">
          {/* strava calendar - shows first on mobile, right on desktop */}
          <div className="w-full activity-stack:w-2/5 flex justify-center activity-stack:justify-end activity-stack:items-center order-first activity-stack:order-last">
            <ErrorBoundary fallback={<p className="font-sans text-gray text-lg">couldn&apos;t load the activity calendar.</p>}>
              <ActivityCalendar />
            </ErrorBoundary>
          </div>

          {/* github activity - shows second on mobile, left on desktop */}
          <div className="w-full activity-stack:w-3/5 order-last activity-stack:order-first">
            <ErrorBoundary fallback={<p className="font-sans text-gray text-lg">couldn&apos;t load github activity.</p>}>
              <GitHubActivity showHeading={true} mobileHeading={false} />
            </ErrorBoundary>
          </div>
        </div>
      </section>
      <div className="section-divider" />

      {/* footer */}
      <footer className="py-8 text-center">
        <p className="font-sans text-gray text-sm">© andrew zhou 2025-2026</p>
      </footer>
    </main>
  );
}
