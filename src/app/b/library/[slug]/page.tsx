import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Chip, Cluster, Container, Link, PageHeader, Stack, Text } from "@/design-system";
import { dsMdxComponents } from "@/design-system/mdx";
import MDXContent from "@/components/library/MDXContent";
import Rating from "@/components/library/Rating";
import { Figure } from "@/components/blog/mdx";
import { getSite, pageTitle } from "@/content/site";
import { formatDay } from "@/content/format";
import { getAdjacentEntries, getAllEntries, getEntryBySlug } from "@/lib/library";

type Props = { params: Promise<{ slug: string }> };

export function generateStaticParams() {
  return getAllEntries().map((e) => ({ slug: e.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const site = getSite();
  const entry = getEntryBySlug((await params).slug);
  if (!entry) return { title: pageTitle(site, site.site.notFoundTitle) };
  return { title: pageTitle(site, entry.title, site.pages.library.title), description: entry.summary };
}

export default async function HubNote({ params }: Props) {
  const site = getSite();
  const copy = site.pages.library;
  const { slug } = await params;
  const entry = getEntryBySlug(slug);
  if (!entry) notFound();
  const { prev, next } = getAdjacentEntries(slug);
  const writing = site.hubs.find((h) => h.id === "writing")!;

  const meta: string[] = [entry.creator, entry.type];
  if (entry.dateStarted) meta.push(`${copy.started} ${formatDay(entry.dateStarted)}`);
  if (entry.dateCompleted) meta.push(`${copy.completed} ${formatDay(entry.dateCompleted)}`);
  if (!entry.dateStarted && !entry.dateCompleted && entry.status === "in-progress") meta.push(copy.inProgress);

  return (
    <Container width="prose" className="ds-page">
      <PageHeader crumbs={[{ label: writing.label, href: writing.href }, { label: entry.title }]} title={entry.title} titleSize="3xl" meta={meta} />
      <Stack gap="8">
        <Cluster gap="4">
          <Rating value={entry.rating} />
          {entry.sourceUrl && (
            <Link href={entry.sourceUrl} variant="standalone" tone="muted">
              {`${copy.originalSource} ↗`}
            </Link>
          )}
        </Cluster>
        {entry.tags.length > 0 && (
          <Cluster gap="2">
            {entry.tags.map((t) => (
              <Chip key={t}>{t}</Chip>
            ))}
          </Cluster>
        )}
        {entry.cover && <Figure src={entry.cover} alt={entry.title} />}
        {entry.summary && (
          <Text size="lg" tone="fg">
            {entry.summary}
          </Text>
        )}
        <div className="ds-prose">
          <MDXContent slug={entry.slug} components={dsMdxComponents("lg")} />
        </div>
        {(prev || next) && (
          <Cluster gap="6" justify="between">
            {prev ? (
              <Link href={`/library/${prev.slug}`} variant="nav">
                {`← ${prev.title}`}
              </Link>
            ) : (
              <span />
            )}
            {next ? (
              <Link href={`/library/${next.slug}`} variant="nav">
                {`${next.title} →`}
              </Link>
            ) : null}
          </Cluster>
        )}
      </Stack>
    </Container>
  );
}
