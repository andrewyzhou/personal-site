import type { Metadata } from "next";
import { Chip, Cluster, Container, Divider, Heading, Link, PageHeader, Stack, Text } from "@/design-system";
import { dsMdxComponents } from "@/design-system/mdx";
import ItemContent from "@/components/mdx/ItemContent";
import { getSite, pageTitle } from "@/content/site";
import { getItems, type ItemCategory } from "@/lib/items";
import { getCoursework, getSectionDescriptions } from "@/lib/content";
import { courseHasDetail } from "@/lib/coursework";

const ITEM_TABS: ItemCategory[] = ["work", "research", "teaching", "projects"];

function hub() {
  return getSite().hubs.find((h) => h.id === "work")!;
}

export function generateMetadata(): Metadata {
  return { title: pageTitle(getSite(), hub().label), description: hub().intro };
}

type Tab = ItemCategory | "coursework";

export default async function WorkHub({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const site = getSite();
  const { tab: asked } = await searchParams;
  const tab: Tab = asked === "coursework" || ITEM_TABS.includes(asked as ItemCategory) ? (asked as Tab) : "work";
  const blurbs = getSectionDescriptions();

  return (
    <Container className="ds-page">
      <PageHeader title={hub().label} titleSize="3xl" meta={[hub().intro]} />
      <Stack gap="8">
        <Cluster gap="2">
          {[...ITEM_TABS, "coursework" as const].map((t) => (
            <Chip key={t} href={t === "work" ? "/work" : `/work?tab=${t}`} selected={t === tab}>
              {site.experience.tabs[t]}
            </Chip>
          ))}
        </Cluster>
        {blurbs[tab] ? <Text tone="muted">{blurbs[tab]}</Text> : null}

        {tab === "coursework" ? (
          <Stack gap="10">
            {getCoursework().map((sem) => (
              <Stack key={sem.name} gap="4">
                <Heading level={2} size="xl">
                  {sem.name}
                </Heading>
                <Stack gap="5">
                  {sem.courses.map((c) => (
                    <Stack key={c.code} gap="2">
                      <Cluster gap="3" align="baseline">
                        <Text tone="fg" weight="semibold">
                          {c.code}
                        </Text>
                        <Text tone="muted">{c.title}</Text>
                      </Cluster>
                      {courseHasDetail(c) ? (
                        <Stack gap="2">
                          {c.review ? <Text tone="default">{c.review}</Text> : null}
                          {c.experience ? <Text tone="muted">{c.experience}</Text> : null}
                          {c.links?.length || c.cheatsheets?.length ? (
                            <Cluster gap="4">
                              {[...(c.cheatsheets ?? []), ...(c.links ?? [])].map((l) => (
                                <Link key={l.url} href={l.url} variant="standalone" tone="muted">
                                  {l.label}
                                </Link>
                              ))}
                            </Cluster>
                          ) : null}
                        </Stack>
                      ) : null}
                    </Stack>
                  ))}
                </Stack>
              </Stack>
            ))}
            <Text size="sm" tone="subtle">
              {site.experience.courseworkFootnote}
            </Text>
          </Stack>
        ) : (
          <Stack gap="10">
            {getItems(tab).map((item, i) => (
              <Stack key={item.slug} gap="3">
                {i > 0 ? <Divider /> : null}
                <Cluster gap="4" justify="between" align="baseline">
                  <Heading level={2} size="xl">
                    {item.title}
                  </Heading>
                  <Text size="sm" tone="subtle">
                    {item.period ?? item.year}
                  </Text>
                </Cluster>
                <Text tone="muted">
                  {item.companyUrl ? (
                    <Link href={item.companyUrl} variant="inline">
                      {item.company}
                    </Link>
                  ) : (
                    item.company
                  )}
                  {item.location ? ` · ${item.location}` : ""}
                </Text>
                <div className="ds-prose">
                  <ItemContent category={tab} slug={item.slug} components={dsMdxComponents("base")} />
                </div>
              </Stack>
            ))}
          </Stack>
        )}
      </Stack>
    </Container>
  );
}
