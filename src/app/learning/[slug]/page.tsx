import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getAllEntries, getEntryBySlug, getAdjacentEntries } from "@/lib/learning";
import SourceIcon from "@/components/learning/SourceIcon";
import Rating from "@/components/learning/Rating";
import MDXContent from "@/components/learning/MDXContent";

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function generateStaticParams() {
  return getAllEntries().map((e) => ({ slug: e.slug }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const entry = getEntryBySlug(slug);
  if (!entry) return { title: "not found · andrew zhou" };
  return {
    title: `${entry.title} · learning · andrew zhou`,
    description: entry.summary,
  };
}

function formatDate(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso + "T00:00:00");
  const month = d.toLocaleDateString("en-US", { month: "short" }).toLowerCase();
  return `${month} ${d.getDate()}, ${d.getFullYear()}`;
}

export default async function LearningEntryPage({ params }: PageProps) {
  const { slug } = await params;
  const entry = getEntryBySlug(slug);
  if (!entry) notFound();

  const { prev, next } = getAdjacentEntries(slug);

  const dates: string[] = [];
  if (entry.dateStarted) dates.push(`started ${formatDate(entry.dateStarted)}`);
  if (entry.dateCompleted) dates.push(`completed ${formatDate(entry.dateCompleted)}`);
  if (dates.length === 0 && entry.status === "in-progress") dates.push("in progress");

  return (
    <main className="site-container">
      <section className="py-8">
        <Link href="/learning" className="font-sans text-gray text-base link-highlight">
          ← learning
        </Link>
      </section>

      <article className="py-8" style={{ maxWidth: "720px" }}>
        {/* header */}
        <div className="flex items-start gap-3" style={{ marginBottom: "0.5rem" }}>
          <div style={{ marginTop: "0.5rem" }}>
            <SourceIcon type={entry.type} size={24} />
          </div>
          <h1
            className="font-sans font-bold text-off-white text-4xl"
            style={{ letterSpacing: "-0.01em", lineHeight: 1.15 }}
          >
            {entry.title}
          </h1>
        </div>

        <p className="font-sans text-gray text-lg" style={{ marginBottom: "0.5rem" }}>
          {entry.creator} · {entry.type}
          {dates.length > 0 && <> · {dates.join(" · ")}</>}
        </p>

        <div className="flex items-center flex-wrap gap-3" style={{ marginBottom: "1.5rem" }}>
          <Rating value={entry.rating} />
          {entry.sourceUrl && (
            <a
              href={entry.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="font-sans text-gray text-base link-highlight"
            >
              original source ↗
            </a>
          )}
        </div>

        {entry.tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5" style={{ marginBottom: "2rem" }}>
            {entry.tags.map((tag) => (
              <Link
                key={tag}
                href={`/learning?tags=${encodeURIComponent(tag)}`}
                className="font-sans text-gray text-sm link-highlight"
              >
                {tag}
              </Link>
            ))}
          </div>
        )}

        <hr
          style={{
            border: "none",
            height: "1px",
            backgroundColor: "var(--theme-divider)",
            marginBottom: "2rem",
          }}
        />

        {entry.summary && (
          <p
            className="font-sans text-off-white text-lg italic leading-[1.5]"
            style={{ marginBottom: "2rem" }}
          >
            {entry.summary}
          </p>
        )}

        <MDXContent source={entry.content} />
      </article>

      {(prev || next) && (
        <>
          <div className="section-divider" />
          <section className="py-8">
            <div className="flex justify-between gap-6" style={{ maxWidth: "720px" }}>
              <div className="flex-1">
                {prev && (
                  <Link href={`/learning/${prev.slug}`} className="block group">
                    <p className="font-sans text-gray text-sm" style={{ marginBottom: "0.25rem" }}>
                      ← previous
                    </p>
                    <p className="font-sans text-off-white text-lg link-highlight inline-block">
                      {prev.title}
                    </p>
                  </Link>
                )}
              </div>
              <div className="flex-1 text-right">
                {next && (
                  <Link href={`/learning/${next.slug}`} className="block group">
                    <p className="font-sans text-gray text-sm" style={{ marginBottom: "0.25rem" }}>
                      next →
                    </p>
                    <p className="font-sans text-off-white text-lg link-highlight inline-block">
                      {next.title}
                    </p>
                  </Link>
                )}
              </div>
            </div>
          </section>
        </>
      )}

      <div className="section-divider" />

      <footer className="py-8 text-center">
        <p className="font-sans text-gray text-sm">© andrew zhou 2025-2026</p>
      </footer>
    </main>
  );
}
