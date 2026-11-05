import type { Metadata } from "next";
import { Badge, Chip, Cluster, Container, EmptyState, List, ListRow, PageHeader, Stack } from "@/design-system";
import { getSite, pageTitle } from "@/content/site";
import { formatDay } from "@/content/format";
import { getAllPosts } from "@/lib/blog";
import { getAllEntries } from "@/lib/library";

function hub() {
  return getSite().hubs.find((h) => h.id === "writing")!;
}

export function generateMetadata(): Metadata {
  return { title: pageTitle(getSite(), hub().label), description: hub().intro };
}

type Kind = "all" | "post" | "note";

// posts and library notes as one list, newest first
export default async function WritingHub({ searchParams }: { searchParams: Promise<{ kind?: string }> }) {
  const site = getSite();
  const copy = site.hubPages.writing;
  const { kind: asked } = await searchParams;
  const kind: Kind = asked === "post" || asked === "note" ? asked : "all";

  const rows = [
    ...getAllPosts().map((p) => ({ kind: "post" as const, key: `p:${p.slug}`, href: `/blog/${p.slug}`, title: p.title, meta: p.summary, sort: p.date, when: formatDay(p.date) })),
    ...getAllEntries().map((e) => {
      const date = e.dateCompleted ?? e.dateStarted ?? "";
      return { kind: "note" as const, key: `n:${e.slug}`, href: `/library/${e.slug}`, title: e.title, meta: `${e.creator} · ${e.summary}`, sort: date, when: date ? formatDay(date) : site.pages.library.inProgress };
    }),
  ]
    .filter((r) => kind === "all" || r.kind === kind)
    .sort((a, b) => (a.sort < b.sort ? 1 : a.sort > b.sort ? -1 : 0));

  const chips: [Kind, string][] = [
    ["all", copy.all],
    ["post", copy.posts],
    ["note", copy.notes],
  ];

  return (
    <Container className="ds-page">
      <PageHeader title={hub().label} titleSize="3xl" meta={[hub().intro]} />
      <Stack gap="6">
        <Cluster gap="2">
          {chips.map(([k, label]) => (
            <Chip key={k} href={k === "all" ? "/writing" : `/writing?kind=${k}`} selected={k === kind}>
              {label}
            </Chip>
          ))}
        </Cluster>
        {rows.length ? (
          <List>
            {rows.map((r) => (
              <ListRow
                key={r.key}
                href={r.href}
                title={r.title}
                meta={r.meta}
                trailing={
                  <Cluster gap="2" nowrap>
                    {r.when}
                    <Badge tone={r.kind === "post" ? "accent" : "neutral"}>{r.kind === "post" ? copy.post : copy.note}</Badge>
                  </Cluster>
                }
              />
            ))}
          </List>
        ) : (
          <EmptyState title={copy.empty} />
        )}
      </Stack>
    </Container>
  );
}
