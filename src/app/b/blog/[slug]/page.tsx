import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Chip, Cluster, Container, Link, PageHeader, Stack, Text } from "@/design-system";
import { dsMdxComponents } from "@/design-system/mdx";
import BlogContent from "@/components/blog/BlogContent";
import { Figure, Gallery } from "@/components/blog/mdx";
import EngagementSection from "@/components/EngagementSection";
import { getSite, pageTitle } from "@/content/site";
import { formatDay } from "@/content/format";
import { getAdjacentPosts, getAllPosts, getPostBySlug } from "@/lib/blog";

type Props = { params: Promise<{ slug: string }> };

export function generateStaticParams() {
  return getAllPosts().map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const site = getSite();
  const post = getPostBySlug((await params).slug);
  if (!post) return { title: pageTitle(site, site.site.notFoundTitle) };
  return { title: pageTitle(site, post.title, site.pages.blog.title), description: post.summary };
}

export default async function HubPost({ params }: Props) {
  const site = getSite();
  const { slug } = await params;
  const post = getPostBySlug(slug);
  if (!post) notFound();
  const { prev, next } = getAdjacentPosts(slug);
  const writing = site.hubs.find((h) => h.id === "writing")!;

  return (
    <Container width="prose" className="ds-page">
      <PageHeader
        crumbs={[{ label: writing.label, href: writing.href }, { label: post.title }]}
        title={post.title}
        titleSize="3xl"
        meta={[formatDay(post.date)]}
      />
      <Stack gap="8">
        {post.tags.length > 0 && (
          <Cluster gap="2">
            {post.tags.map((t) => (
              <Chip key={t}>{t}</Chip>
            ))}
          </Cluster>
        )}
        {post.cover && <Figure src={post.cover} alt={post.title} />}
        <div className="ds-prose">
          <BlogContent slug={post.slug} components={dsMdxComponents("lg", { Figure, Gallery })} />
        </div>
        {(prev || next) && (
          <Cluster gap="6" justify="between">
            {prev ? (
              <Link href={`/blog/${prev.slug}`} variant="nav">
                <Text size="xs" tone="subtle">
                  {site.nav.previous}
                </Text>
                {`← ${prev.title}`}
              </Link>
            ) : (
              <span />
            )}
            {next ? (
              <Link href={`/blog/${next.slug}`} variant="nav">
                <Text size="xs" tone="subtle">
                  {site.nav.next}
                </Text>
                {`${next.title} →`}
              </Link>
            ) : null}
          </Cluster>
        )}
        <EngagementSection target={`blog:${post.slug}`} />
      </Stack>
    </Container>
  );
}
