import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import * as content from "@/content";
import { pageTitle } from "@/content/site";
import { formatDay } from "@/content/format";
import Frame from "@/components/site/Frame";
import RenderMdx from "@/components/site/RenderMdx";
import { Figure, blogMdxComponents } from "@/components/blog/mdx";
import EngagementSection from "@/components/EngagementSection";

const site = content.site();

interface PageProps {
  params: Promise<{ slug: string }>;
}

export const dynamicParams = false;

export async function generateStaticParams() {
  return content.posts().map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const post = content.post(slug);
  if (!post) return { title: pageTitle(site, site.site.notFoundTitle) };
  return { title: pageTitle(site, post.title, site.sections.writing.label), description: post.summary };
}

// a post: the text in the wide left column at reading width, and what the
// old page stacked above it (date, tags, the neighbours) on the right.
export default async function PostPage({ params }: PageProps) {
  const { slug } = await params;
  const post = content.post(slug);
  if (!post) notFound();

  // by date, whatever is pinned: newer is the next one published after this
  const byDate = [...content.posts()].sort((a, b) => b.date.localeCompare(a.date) || a.slug.localeCompare(b.slug));
  const at = byDate.findIndex((p) => p.slug === post.slug);
  const newer = at > 0 ? byDate[at - 1] : null;
  const older = at < byDate.length - 1 ? byDate[at + 1] : null;

  return (
    <Frame
      section="writing"
      trail={[{ label: site.sections.writing.label, href: content.urls.section("writing") }]}
      title={post.title}
      aside={
        <>
          <p className="font-semibold">{formatDay(post.date)}</p>
          {post.tags.length > 0 && <p className="text-sm">{post.tags.join(" · ")}</p>}
        </>
      }
    >
      <section className="py-8">
        <div className="flex flex-col md:flex-row gap-8 md:gap-12">
          <article className="w-full md:w-3/5" style={{ maxWidth: "720px" }}>
            {post.summary && (
              <p className="font-sans text-off-white text-lg italic leading-[1.5]" style={{ marginBottom: "2rem" }}>
                {post.summary}
              </p>
            )}
            {post.cover && <Figure src={post.cover} alt={post.title} />}
            <RenderMdx source={post.body} components={blogMdxComponents} />
            <EngagementSection target={`blog:${post.slug}`} />
          </article>

          {(newer || older) && (
            <aside className="w-full md:w-2/5 flex flex-col gap-6 items-start md:items-end md:text-right">
              <div className="md:sticky flex flex-col gap-6 items-start md:items-end" style={{ top: "2rem" }}>
                {[
                  { label: site.sectionPages.newer, p: newer },
                  { label: site.sectionPages.older, p: older },
                ].map(({ label, p }) =>
                  p ? (
                    <div key={label}>
                      <p className="font-sans text-gray text-sm" style={{ marginBottom: "0.25rem" }}>
                        {label}
                      </p>
                      <Link href={content.urls.post(p.slug)} className="font-sans text-off-white text-lg link-highlight inline-block">
                        {p.title}
                      </Link>
                    </div>
                  ) : null,
                )}
              </div>
            </aside>
          )}
        </div>
      </section>
    </Frame>
  );
}
