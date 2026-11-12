import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { isAdminViewer } from "@/app/admin/require-admin";
import ActivityFigure from "@/components/figure/ActivityFigure";
import { figureMarks } from "@/components/figure/marks";
import { addDays, type FigureEvent } from "@/lib/figure";

export const metadata: Metadata = { title: "preview", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ name: string }>;
  searchParams: Promise<{ sample?: string }>;
}

// work in progress, for the owner only: a local dev server or a signed-in admin
async function allowed(): Promise<boolean> {
  return process.env.NODE_ENV === "development" || (await isAdminViewer());
}

// stand-in posts and library additions spread over the past year, so the
// loud marks and the titles can be judged before there is real writing
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

export default async function PreviewPage({ params, searchParams }: PageProps) {
  if (!(await allowed())) notFound();
  const { name } = await params;
  const { sample } = await searchParams;
  if (name !== "figure") notFound();

  return (
    <main className="site-container">
      <section className="py-16">
        <ActivityFigure marks={sample ? sampleMarks() : figureMarks()} />
      </section>
    </main>
  );
}
