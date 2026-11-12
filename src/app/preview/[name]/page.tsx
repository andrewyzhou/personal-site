import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { isAdminViewer } from "@/app/admin/require-admin";
import ActivityFigure from "@/components/figure/ActivityFigure";
import HomeA from "@/components/home/HomeA";
import HomeB from "@/components/home/HomeB";
import { homeData, type HomeData } from "@/components/home/data";
import { formatDay } from "@/content/format";
import { addDays, type FigureEvent } from "@/lib/figure";

export const metadata: Metadata = { title: "preview", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ name: string }>;
  searchParams: Promise<{ sample?: string }>;
}

// work in progress, for the owner only: a local dev server or a signed-in
// admin. /preview/home-a, /preview/home-b, /preview/figure; add ?sample=1 to
// see them with stand-in posts and library entries.
async function allowed(): Promise<boolean> {
  return process.env.NODE_ENV === "development" || (await isAdminViewer());
}

// stand-in posts and library additions spread over the past year, so the
// loud marks, the titles and the "latest" band can be judged before there
// is real writing
function sampleMarks(): FigureEvent[] {
  const today = new Date().toISOString().slice(0, 10);
  const posts: [number, string][] = [
    [-6, "a sample post, the newest"],
    [-9, "one from the same week"],
    [-58, "a longer sample title to see how it is cut"],
    [-131, "short one"],
    [-240, "an older sample post"],
    [-330, "the first"],
  ];
  const library = [-3, -20, -21, -47, -90, -118, -160, -201, -260, -300];
  return [
    ...posts.map(([d, label]) => ({ kind: "writing" as const, date: addDays(today, d), label })),
    ...library.map((d, i) => ({ kind: "library" as const, date: addDays(today, d), label: `sample entry ${i + 1}` })),
    { kind: "library" as const, date: addDays(today, -58), label: "added the same day as a post" },
  ];
}

function withSamples(data: HomeData): HomeData {
  const marks = sampleMarks();
  const byNewest = [...marks].sort((a, b) => b.date.localeCompare(a.date));
  const posts = byNewest.filter((m) => m.kind === "writing");
  const added = byNewest.filter((m) => m.kind === "library");
  return {
    ...data,
    marks,
    latest: { href: "#", title: posts[0].label, summary: "one or two sentences that say what the post is about.", dateLabel: formatDay(posts[0].date) },
    recent: added.slice(0, 4).map((m) => ({ title: m.label, dateLabel: formatDay(m.date) })),
    writing: byNewest.slice(0, 6).map((m) => ({ href: "#" + m.date, title: m.label, line: "a line about it.", dateLabel: formatDay(m.date), kindLabel: m.kind === "library" ? "reading" : undefined })),
  };
}

export default async function PreviewPage({ params, searchParams }: PageProps) {
  if (!(await allowed())) notFound();
  const { name } = await params;
  const { sample } = await searchParams;
  const data = sample ? withSamples(homeData()) : homeData();

  if (name === "home-a") return <HomeA data={data} />;
  if (name === "home-b") return <HomeB data={data} />;
  if (name === "figure")
    return (
      <main className="site-container">
        <section className="py-16">
          <ActivityFigure marks={data.marks} />
        </section>
      </main>
    );
  notFound();
}
