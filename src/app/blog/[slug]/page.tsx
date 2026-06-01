import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getAllPosts, getPostBySlug, getAdjacentPosts } from "@/lib/blog";
import BlogContent from "@/components/blog/BlogContent";
import { Figure } from "@/components/blog/mdx";

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function generateStaticParams() {
  return getAllPosts().map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const post = getPostBySlug(slug);
  if (!post) return { title: "not found · andrew zhou" };
  return {
    title: `${post.title} · blog · andrew zhou`,
    description: post.summary,
  };
}

function formatDate(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso + "T00:00:00");
  const month = d.toLocaleDateString("en-US", { month: "short" }).toLowerCase();
  return `${month} ${d.getDate()}, ${d.getFullYear()}`;
}

export default async function BlogPostPage({ params }: PageProps) {
  const { slug } = await params;
  const post = getPostBySlug(slug);
  if (!post) notFound();

  const { prev, next } = getAdjacentPosts(slug);

  return (
    <main className="site-container">
      <section className="py-8">
        <Link href="/blog" className="font-sans text-gray text-base link-highlight">
          ← blog
        </Link>
      </section>

      <article className="py-8" style={{ maxWidth: "720px" }}>
        {/* header */}
        <h1
          className="font-sans font-bold text-off-white text-4xl"
          style={{ letterSpacing: "-0.01em", lineHeight: 1.15, marginBottom: "0.5rem" }}
        >
          {post.title}
        </h1>

        <p className="font-sans text-gray text-lg" style={{ marginBottom: "1.5rem" }}>
          {formatDate(post.date)}
        </p>

        {post.tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5" style={{ marginBottom: "2rem" }}>
            {post.tags.map((tag) => (
              <Link
                key={tag}
                href={`/blog?tags=${encodeURIComponent(tag)}`}
                className="font-sans text-gray text-sm link-highlight"
              >
                {tag}
              </Link>
            ))}
          </div>
        )}

        {post.cover && (
          <Figure src={post.cover} alt={post.title} />
        )}

        <hr
          style={{
            border: "none",
            height: "1px",
            backgroundColor: "var(--theme-divider)",
            marginBottom: "2rem",
          }}
        />

        {post.summary && (
          <p
            className="font-sans text-off-white text-lg italic leading-[1.5]"
            style={{ marginBottom: "2rem" }}
          >
            {post.summary}
          </p>
        )}

        <BlogContent slug={post.slug} />
      </article>

      {(prev || next) && (
        <>
          <div className="section-divider" />
          <section className="py-8">
            <div className="flex justify-between gap-6" style={{ maxWidth: "720px" }}>
              <div className="flex-1">
                {prev && (
                  <Link href={`/blog/${prev.slug}`} className="block group">
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
                  <Link href={`/blog/${next.slug}`} className="block group">
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
