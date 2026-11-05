import { notFound } from "next/navigation";
import type { Metadata } from "next";
import "@/design-system/ds.css";
import {
  AppShell,
  Badge,
  Cluster,
  Grid,
  Link,
  List,
  ListRow,
  MapFrame,
  Page,
  PageHeader,
  Section,
  Stack,
  StatGrid,
  Table,
  Text,
  Heading,
  Chip,
  Icon,
  type ShellModel,
} from "@/design-system";
import { canViewDesignLab } from "../../../access";
import { DIRECTIONS, HIKE, HOME, LIFT, RECENT, SITE, type DirectionId } from "../../../specimens";
import { SpecimenMap } from "../../../SpecimenMap";

export const metadata: Metadata = { title: "design preview", robots: { index: false } };

type Props = {
  params: Promise<{ direction: string; page?: string[] }>;
  searchParams: Promise<{ theme?: string }>;
};

const SPORT_ICON: Record<string, string> = { walk: "walk", lift: "weight", ride: "ride", hike: "hike" };

function SportIcon({ sport }: { sport: string }) {
  return <Icon src={`/icons/activities/${SPORT_ICON[sport] ?? "workout"}.svg`} />;
}

export default async function DirectionPreview({ params, searchParams }: Props) {
  if (!(await canViewDesignLab())) notFound();
  const { direction, page = [] } = await params;
  const { theme } = await searchParams;
  if (!(direction in DIRECTIONS)) notFound();
  const d = DIRECTIONS[direction as DirectionId];
  const base = `/design-system/preview/${direction}`;
  const q = theme ? `?theme=${theme}` : "";
  const model: ShellModel = {
    mark: { label: SITE.mark, href: base + q, logo: "/images/az-logo.svg" },
    nav: [
      { label: "activities", href: `${base}/activities${q}` },
      { label: "lifts", href: `${base}/lifts${q}` },
      { label: "photos", href: `${base}/photos${q}` },
      { label: "blog", href: `${base}/blog${q}` },
      { label: "library", href: `${base}/library${q}` },
    ],
    footer: SITE.footer,
    labels: SITE.labels,
  };
  const key = page.join("/");
  const editorial = d.variant === "pill";

  let body: React.ReactNode;
  if (key === "") body = <HomeSpecimen editorial={editorial} />;
  else if (key === "activities") body = <ActivitiesSpecimen base={base} q={q} />;
  else if (key === "activities/464") body = <ActivitySpecimen base={base} q={q} editorial={editorial} />;
  else if (key === "activities/496") body = <LiftSpecimen base={base} q={q} />;
  else body = <EmptySpecimen base={base} q={q} section={page[0]} />;

  return (
    <AppShell model={model} variant={d.variant} accent={d.accent} theme={theme === "light" || theme === "dark" ? theme : undefined}>
      {body}
    </AppShell>
  );
}

function HomeSpecimen({ editorial }: { editorial: boolean }) {
  return (
    <Page width={editorial ? "prose" : "content"}>
      <Stack gap="12">
        <Stack gap="3">
          <Heading level={1} size="display">
            {HOME.greeting}
          </Heading>
          <Text size="lg" tone="muted">
            {HOME.affiliation}
          </Text>
        </Stack>
        <Stack gap="4">
          {HOME.bio.map((p) => (
            <Text key={p} size="lg">
              {p.split("annapurna labs")[0]}
              {p.includes("annapurna labs") ? (
                <>
                  <Link href="https://aws.amazon.com/ai/machine-learning/neuron/" variant="inline">
                    annapurna labs
                  </Link>
                  {p.split("annapurna labs")[1]}
                </>
              ) : null}
            </Text>
          ))}
        </Stack>
        <Section title="sections">
          <List>
            {HOME.sections.map((s) => (
              <ListRow key={s.label} href={s.href} title={s.label} meta={s.meta} trailing="→" />
            ))}
          </List>
        </Section>
        <Section title="recent activity" actions={<Link href="#" variant="standalone" tone="muted">see all</Link>}>
          <List>
            {RECENT.slice(0, 3).map((a) => (
              <ListRow key={a.id} leading={<SportIcon sport={a.sport} />} title={a.name} meta={a.date} trailing={a.stat} />
            ))}
          </List>
        </Section>
      </Stack>
    </Page>
  );
}

function ActivitiesSpecimen({ base, q }: { base: string; q: string }) {
  return (
    <Page>
      <PageHeader title="activities" titleSize="3xl" meta={["287 activities", "97.3 mi in 2026"]} />
      <Stack gap="6">
        <Cluster gap="2">
          <Chip selected>all</Chip>
          <Chip>runs</Chip>
          <Chip>rides</Chip>
          <Chip>hikes</Chip>
          <Chip>lifts</Chip>
        </Cluster>
        <List>
          {RECENT.map((a) => (
            <ListRow
              key={a.id}
              href={a.id === 464 || a.id === 496 ? `${base}/activities/${a.id}${q}` : undefined}
              leading={<SportIcon sport={a.sport} />}
              title={a.name}
              meta={`${a.date} · ${a.sport}`}
              trailing={a.stat}
            />
          ))}
        </List>
      </Stack>
    </Page>
  );
}

function ActivitySpecimen({ base, q, editorial }: { base: string; q: string; editorial: boolean }) {
  return (
    <Page>
      <PageHeader
        crumbs={[{ label: "activities", href: `${base}/activities${q}` }, { label: HIKE.name }]}
        title={HIKE.name}
        titleSize={editorial ? "3xl" : "2xl"}
        meta={[HIKE.date, HIKE.time, HIKE.sport]}
      />
      <Stack gap="8">
        <StatGrid stats={HIKE.stats} size={editorial ? "hero" : "lg"} columns={4} />
        <MapFrame bleed={false} caption="in the fog · 14 min">
          <SpecimenMap />
        </MapFrame>
        <Grid min="18rem" gap="8">
          <Section title="notes">
            <Text>{HIKE.description}</Text>
          </Section>
          <Section title="details">
            <StatGrid
              size="sm"
              columns={2}
              stats={[
                { label: "elapsed", value: "2:41:05" },
                { label: "max elevation", value: "1,912", unit: "ft" },
                { label: "avg heart rate", value: "142", unit: "bpm" },
                { label: "calories", value: "1,610" },
              ]}
            />
          </Section>
        </Grid>
      </Stack>
    </Page>
  );
}

function LiftSpecimen({ base, q }: { base: string; q: string }) {
  return (
    <Page>
      <PageHeader
        crumbs={[{ label: "activities", href: `${base}/activities${q}` }, { label: "bike + lift with edward" }]}
        title="bike + lift with edward"
        meta={["monday, november 2", "2:01 pm", "weight training"]}
      />
      <Stack gap="8">
        <StatGrid
          columns={4}
          stats={[
            { label: "time", value: "3:05:22" },
            { label: "volume", value: "3,970", unit: "lb" },
            { label: "avg heart rate", value: "95", unit: "bpm" },
            { label: "max heart rate", value: "172", unit: "bpm" },
          ]}
        />
        <Section title={LIFT.name.toLowerCase()} actions={<Text size="sm" tone="subtle">{LIFT.summary}</Text>}>
          <Table
            rowKey={(r) => r.exercise}
            rows={LIFT.sets}
            columns={[
              {
                key: "x",
                header: "exercise",
                cell: (r) => (
                  <Cluster gap="2" nowrap>
                    <span style={{ color: "var(--ds-fg)" }}>{r.exercise}</span>
                    {r.pr ? <Badge tone="pr">pr</Badge> : null}
                  </Cluster>
                ),
              },
              { key: "s", header: "sets", cell: (r) => r.sets },
              { key: "l", header: "load", cell: (r) => r.load },
              { key: "t", header: "best", align: "right", cell: (r) => r.top },
            ]}
          />
        </Section>
      </Stack>
    </Page>
  );
}

function EmptySpecimen({ base, q, section }: { base: string; q: string; section?: string }) {
  return (
    <Page>
      <PageHeader title={section ?? "page"} titleSize="3xl" />
      <Stack gap="4">
        <Text tone="muted">this page isn&apos;t part of the specimen set.</Text>
        <Link href={`${base}/activities/464${q}`} variant="standalone">
          open the hike specimen
        </Link>
      </Stack>
    </Page>
  );
}
