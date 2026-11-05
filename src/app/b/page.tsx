import { Cluster, Container, Heading, Icon, Link, List, ListRow, Section, Stack, Text } from "@/design-system";
import { dsMdxComponents } from "@/design-system/mdx";
import Bio from "@/components/mdx/Bio";
import Currently from "@/components/Currently";
import ErrorBoundary from "@/components/ErrorBoundary";
import { getSite } from "@/content/site";
import { loadTrainingFeed } from "@/content/training";

export const revalidate = 300;

// home, the hub of hubs: who, what now, where to go, what's new, how to reach me
export default async function HubHome() {
  const site = getSite();
  const latest = (await loadTrainingFeed()).slice(0, 3);
  return (
    <Container width="prose" className="ds-page">
      <Stack gap="12">
        <Stack gap="4">
          <Heading level={1} size="display">
            {site.hero.greeting} {site.hero.name}
          </Heading>
          <Stack gap="1">
            {site.hero.affiliation.map((line) => (
              <Text key={line} size="lg" tone="muted">
                {line}
              </Text>
            ))}
          </Stack>
          <Cluster gap="4">
            {site.social.map((s) =>
              s.icon ? (
                <a key={s.name} href={s.url} target="_blank" rel="noopener noreferrer" className="ds-link" data-variant="nav" title={s.name} aria-label={s.name}>
                  <Icon src={s.icon} size="1.25rem" />
                </a>
              ) : (
                <Link key={s.name} href={s.url} variant="nav">
                  {s.name}
                </Link>
              ),
            )}
          </Cluster>
        </Stack>

        <Section title={site.home.about}>
          <div className="ds-prose">
            <Bio components={dsMdxComponents("lg")} />
          </div>
        </Section>

        <Section title={site.currently.heading}>
          <ErrorBoundary fallback={<Text tone="muted">{site.home.errors.currently}</Text>}>
            <Currently showHeading={false} />
          </ErrorBoundary>
        </Section>

        <Section title={site.hubPages.home.explore}>
          <List>
            {site.hubs.map((h) => (
              <ListRow key={h.id} href={h.href} title={h.label} meta={h.intro} trailing="→" />
            ))}
          </List>
        </Section>

        {latest.length > 0 && (
          <Section
            title={site.hubPages.home.latest}
            actions={
              <Link href="/training" variant="standalone" tone="muted">
                {`${site.hubPages.home.seeAll} →`}
              </Link>
            }
          >
            <List>
              {latest.map((a) => (
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
          </Section>
        )}

        <Section title={site.contact.heading}>
          <Text tone="muted">{site.contact.body}</Text>
          <Text tone="fg">{site.contact.email}</Text>
        </Section>
      </Stack>
    </Container>
  );
}
