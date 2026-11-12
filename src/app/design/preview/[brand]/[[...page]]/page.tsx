import { notFound } from "next/navigation";
import type { Metadata } from "next";
import "@/design-system/ds.css";
import {
  AppShell,
  Badge,
  Chip,
  Cluster,
  EmptyState,
  Grid,
  Heading,
  Icon,
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
  getBrand,
  type ShellModel,
} from "@/design-system";
import { getSite } from "@/content/site";
import { getItems, type ItemCategory } from "@/lib/items";
import { getCoursework } from "@/lib/content";
import { canViewDesignLab } from "../../../_docs/access";
import { SpecimenMap } from "../../../_docs/SpecimenMap";
import {
  ARTICLE,
  FOOTER,
  HIKE,
  HOME,
  LABELS,
  LIFT,
  SPORT_ICON,
  TRAINING,
  TRAINING_SUMMARY,
  WRITING,
} from "../../../_docs/specimens";

export const metadata: Metadata = { title: "design preview", robots: { index: false } };

type Props = {
  params: Promise<{ brand: string; page?: string[] }>;
  searchParams: Promise<{ theme?: string; tab?: string; kind?: string; sport?: string }>;
};

function SportIcon({ sport }: { sport: string }) {
  return <Icon src={`/icons/activities/${SPORT_ICON[sport] ?? "activity"}.svg`} />;
}

export default async function BrandPreview({ params, searchParams }: Props) {
  if (!(await canViewDesignLab())) notFound();
  const { brand: brandId, page = [] } = await params;
  const sp = await searchParams;
  const brand = getBrand(brandId);
  if (!brand) notFound();
  const site = getSite();
  const theme = sp.theme === "light" || sp.theme === "dark" ? sp.theme : undefined;
  const q = theme ? `?theme=${theme}` : "";
  const base = `/design/preview/${brand.id}`;
  const url = (path: string, extra?: Record<string, string>) => {
    const p = new URLSearchParams({ ...(theme ? { theme } : {}), ...(extra ?? {}) }).toString();
    return `${base}${path}${p ? `?${p}` : ""}`;
  };
  const hub = (id: string) => site.hubs.find((h) => h.id === id)!;

  const model: ShellModel = {
    mark: { label: site.site.name, href: base + q, logo: "/images/az-logo.svg" },
    nav: site.hubs.map((h) => ({ label: h.label, href: `${base}/${h.id}${q}` })),
    footer: FOOTER,
    labels: LABELS,
  };

  const key = page.join("/");
  const big = brand.type.pageTitle;
  let body: React.ReactNode;

  if (key === "") {
    body = (
      <Page width={brand.shell === "pill" ? "prose" : "content"}>
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
              <Text key={p.link} size="lg">
                {p.text}
                <Link href="#" variant="inline">
                  {p.link}
                </Link>
                {p.after}
              </Text>
            ))}
          </Stack>
          <Section title="currently">
            <Text tone="muted">{HOME.currently}</Text>
          </Section>
          <Section title="explore">
            <List>
              {site.hubs.map((h) => (
                <ListRow key={h.id} href={`${base}/${h.id}${q}`} title={h.label} meta={h.intro} trailing="→" />
              ))}
            </List>
          </Section>
          <Section title="latest" actions={<Link href={`${base}/training${q}`} variant="standalone" tone="muted">training →</Link>}>
            <List>
              {TRAINING.slice(0, 3).map((a) => (
                <ListRow key={a.id} leading={<SportIcon sport={a.sport} />} title={a.name} meta={a.date} trailing={a.stat} />
              ))}
            </List>
          </Section>
          <Section title="contact">
            <Text tone="muted">{HOME.contact}</Text>
            <Text tone="fg">{HOME.email}</Text>
          </Section>
        </Stack>
      </Page>
    );
  } else if (key === "work") {
    const tabs = hub("work").sections.filter((s) => s !== "coursework") as ItemCategory[];
    const tab = sp.tab === "coursework" ? "coursework" : ((tabs.includes(sp.tab as ItemCategory) ? sp.tab : "work") as ItemCategory);
    const rows =
      tab === "coursework"
        ? getCoursework().flatMap((sem) => sem.courses.map((c) => ({ key: sem.name + c.code, title: c.code, meta: c.title, trailing: sem.name })))
        : getItems(tab).map((i) => ({ key: i.slug, title: i.title, meta: [i.company, i.location].filter(Boolean).join(" · "), trailing: i.period ?? i.year }));
    body = (
      <Page>
        <PageHeader title={hub("work").label} titleSize={big} meta={[hub("work").intro]} />
        <Stack gap="6">
          <Cluster gap="2">
            {[...tabs, "coursework"].map((t) => (
              <Chip key={t} href={url("/work", { tab: t })} selected={t === tab}>
                {site.experience.tabs[t as keyof typeof site.experience.tabs] ?? t}
              </Chip>
            ))}
          </Cluster>
          <List>
            {rows.map((r) => (
              <ListRow key={r.key} href="#" title={r.title} meta={r.meta} trailing={r.trailing} />
            ))}
          </List>
        </Stack>
      </Page>
    );
  } else if (key === "writing") {
    const kind = sp.kind === "post" || sp.kind === "note" ? sp.kind : "all";
    const rows = WRITING.filter((w) => kind === "all" || w.kind === kind);
    body = (
      <Page>
        <PageHeader title={hub("writing").label} titleSize={big} meta={[hub("writing").intro]} />
        <Stack gap="6">
          <Cluster gap="2">
            {(["all", "post", "note"] as const).map((k) => (
              <Chip key={k} href={url("/writing", k === "all" ? {} : { kind: k })} selected={k === kind}>
                {k === "all" ? "all" : k === "post" ? "posts" : "notes"}
              </Chip>
            ))}
          </Cluster>
          <List>
            {rows.map((w) => (
              <ListRow
                key={w.slug}
                href={w.kind === "post" ? url(`/writing/${w.slug}`) : "#"}
                title={w.title}
                meta={w.summary}
                trailing={<Badge tone={w.kind === "post" ? "accent" : "neutral"}>{w.kind}</Badge>}
              />
            ))}
          </List>
        </Stack>
      </Page>
    );
  } else if (key === "writing/hello-world") {
    body = (
      <Page width="prose">
        <PageHeader
          crumbs={[{ label: hub("writing").label, href: url("/writing") }, { label: ARTICLE.title }]}
          title={ARTICLE.title}
          titleSize={big}
          meta={[ARTICLE.date, ...ARTICLE.tags]}
        />
        <Stack gap="5">
          {ARTICLE.body.map((p) => (
            <Text key={p} size="lg">
              {p}
            </Text>
          ))}
          <Text size="lg">
            the source for this site is on{" "}
            <Link href="https://github.com/andrewyzhou" variant="inline">
              github
            </Link>
            .
          </Text>
        </Stack>
      </Page>
    );
  } else if (key === "photos") {
    body = (
      <Page>
        <PageHeader title={hub("photos").label} titleSize={big} meta={[hub("photos").intro]} />
        <EmptyState title={site.pages.photos.empty} body="sets will show up here as they're published." />
      </Page>
    );
  } else if (key === "training") {
    const sport = sp.sport ?? "all";
    const rows = TRAINING.filter((a) => sport === "all" || a.sport === sport);
    body = (
      <Page>
        <PageHeader title={hub("training").label} titleSize={big} meta={[hub("training").intro]} />
        <Stack gap="10">
          <StatGrid stats={TRAINING_SUMMARY} columns={4} size="md" />
          <Stack gap="4">
            <Cluster gap="2">
              {["all", "run", "ride", "hike", "walk", "lift"].map((s) => (
                <Chip key={s} href={url("/training", s === "all" ? {} : { sport: s })} selected={s === sport}>
                  {s === "all" ? "all" : s === "lift" ? "lifts" : `${s}s`}
                </Chip>
              ))}
            </Cluster>
            {rows.length ? (
              <List>
                {rows.map((a) => (
                  <ListRow
                    key={a.id}
                    href={a.id === 464 || a.id === 496 ? url(`/training/${a.id}`) : undefined}
                    leading={<SportIcon sport={a.sport} />}
                    title={a.name}
                    meta={`${a.date} · ${a.sport}`}
                    trailing={a.stat}
                  />
                ))}
              </List>
            ) : (
              <EmptyState title="nothing here yet" body="no sessions of this kind." />
            )}
          </Stack>
        </Stack>
      </Page>
    );
  } else if (key === "training/464") {
    body = (
      <Page>
        <PageHeader
          crumbs={[{ label: hub("training").label, href: url("/training") }, { label: HIKE.name }]}
          title={HIKE.name}
          titleSize={big}
          meta={[HIKE.date, HIKE.time, HIKE.sport]}
        />
        <Stack gap="8">
          <StatGrid stats={HIKE.stats} size={brand.shell === "pill" ? "hero" : "lg"} columns={4} />
          <MapFrame caption="in the fog · 14 min">
            <SpecimenMap />
          </MapFrame>
          <Grid min="18rem" gap="8">
            <Section title="notes">
              <Text>{HIKE.description}</Text>
            </Section>
            <Section title="details">
              <StatGrid size="sm" columns={2} stats={HIKE.details} />
            </Section>
          </Grid>
        </Stack>
      </Page>
    );
  } else if (key === "training/496") {
    body = (
      <Page>
        <PageHeader
          crumbs={[{ label: hub("training").label, href: url("/training") }, { label: LIFT.name }]}
          title={LIFT.name}
          titleSize={big}
          meta={[LIFT.date, LIFT.time, "weight training"]}
        />
        <Stack gap="8">
          <StatGrid columns={4} stats={LIFT.stats} size={brand.shell === "pill" ? "hero" : "lg"} />
          <Section title={LIFT.program} actions={<Text size="sm" tone="subtle">{LIFT.summary}</Text>}>
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
  } else {
    body = (
      <Page width="prose">
        <PageHeader title={site.site.notFoundTitle} titleSize={big} />
        <Stack gap="4">
          <Text tone="muted">this page doesn&apos;t exist, or it moved.</Text>
          <Cluster gap="5">
            {site.hubs.map((h) => (
              <Link key={h.id} href={`${base}/${h.id}${q}`} variant="standalone">
                {h.label}
              </Link>
            ))}
          </Cluster>
        </Stack>
      </Page>
    );
  }

  return (
    <AppShell model={model} brand={brand} theme={theme}>
      {body}
    </AppShell>
  );
}
