import type { Metadata } from "next";
import { Chip, Cluster, Container, EmptyState, Icon, Link, List, ListRow, PageHeader, Stack, StatGrid, Text } from "@/design-system";
import { fill, getSite, pageTitle } from "@/content/site";
import { loadTrainingFeed, summarize, type SportGroup } from "@/content/training";

export const revalidate = 300;

// the feed is long; older sessions stay reachable from the calendar
const SHOWN = 60;

function hub() {
  return getSite().hubs.find((h) => h.id === "training")!;
}

export function generateMetadata(): Metadata {
  return { title: pageTitle(getSite(), hub().label), description: hub().intro };
}

type Filter = "all" | SportGroup;
const GROUPS: SportGroup[] = ["runs", "rides", "hikes", "walks", "lifts", "other"];

// recorded activities and lift sessions as one feed (activities + lifts hub)
export default async function TrainingHub({ searchParams }: { searchParams: Promise<{ sport?: string }> }) {
  const site = getSite();
  const copy = site.hubPages.training;
  const { sport } = await searchParams;
  const filter: Filter = GROUPS.includes(sport as SportGroup) ? (sport as SportGroup) : "all";

  const all = await loadTrainingFeed();
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
  const s = summarize(all, today);
  const present = new Set(all.map((i) => i.group));
  const rows = all.filter((i) => filter === "all" || i.group === filter);

  return (
    <Container className="ds-page">
      <PageHeader
        title={hub().label}
        titleSize="3xl"
        meta={[hub().intro]}
        actions={
          <Cluster gap="5">
            <Link href="/activities/records" variant="standalone" tone="muted">
              {copy.records}
            </Link>
            <Link href="/lifts" variant="standalone" tone="muted">
              {copy.liftsOverview}
            </Link>
          </Cluster>
        }
      />
      <Stack gap="10">
        <StatGrid
          size="md"
          columns={4}
          stats={[
            { label: copy.thisWeek, value: String(s.thisWeek), unit: copy.sessions },
            { label: fill(copy.distanceYear, { year: s.year }), value: s.yearDistanceMi, unit: "mi" },
            { label: copy.total, value: String(s.total), unit: copy.sessions },
          ]}
        />
        <Stack gap="4">
          <Cluster gap="2">
            {(["all", ...GROUPS.filter((g) => present.has(g))] as Filter[]).map((g) => (
              <Chip key={g} href={g === "all" ? "/training" : `/training?sport=${g}`} selected={g === filter}>
                {copy[g]}
              </Chip>
            ))}
          </Cluster>
          {rows.length ? (
            <List>
              {rows.slice(0, SHOWN).map((a) => (
                <ListRow
                  key={a.key}
                  href={a.href ?? undefined}
                  leading={<Icon src={`/icons/activities/${a.icon}.svg`} />}
                  title={a.name}
                  meta={`${a.dateLabel} · ${a.sport}`}
                  trailing={a.stat}
                />
              ))}
            </List>
          ) : (
            <EmptyState title={copy.empty} />
          )}
          {rows.length > SHOWN && (
            <Text size="sm" tone="subtle">
              {copy.more}
            </Text>
          )}
        </Stack>
      </Stack>
    </Container>
  );
}
