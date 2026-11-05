import { notFound } from "next/navigation";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import "@/design-system/ds.css";
import {
  Badge,
  Breadcrumbs,
  Button,
  Chip,
  Cluster,
  Container,
  Divider,
  EmptyState,
  Field,
  Heading,
  Icon,
  Input,
  Legend,
  Link,
  List,
  ListRow,
  MapFrame,
  PageHeader,
  Section,
  Stack,
  StatGrid,
  Table,
  Text,
  Textarea,
} from "@/design-system";
import { COLOR, RADIUS, SPACE, TYPE, type Accent } from "@/design-system/tokens";
import { canViewDesignLab } from "./access";
import { HIKE, LIFT, RECENT } from "./specimens";
import { SpecimenMap } from "./SpecimenMap";

export const metadata: Metadata = { title: "design system", robots: { index: false } };

const PRINCIPLES = [
  ["one shell, everywhere", "every page sits in the same frame: mark, sections, theme, footer. deep pages are never dead ends."],
  ["quiet by default", "grays and one accent. color appears only where it means something: the route, a pr, heart-rate zones, focus."],
  ["hierarchy from type, not boxes", "importance is size, weight and contrast. surfaces are for things that float."],
  ["three affordances", "links are text, buttons are buttons, chips select. navigation is never a chip."],
  ["one spacing scale", "every gap is a 4px step from the tokens. no magic numbers."],
  ["content first, chrome last", "the map, the title and the numbers lead; chrome is small, quiet and stable."],
  ["motion explains", "120–280ms state changes, one easing, nothing moves on its own, reduced motion respected."],
  ["light and dark as a pair", "every color has two authored values. no invert() hacks, no flash of the wrong theme."],
  ["mobile is first-class", "designed at 390px. 44px targets, no hover-only information, no scroll traps."],
  ["designs never own content", "designs render what the content layer gives them, all of it, and add nothing."],
];

const SWATCH_GROUPS: [string, string[]][] = [
  ["surface", ["bg", "bg-subtle", "bg-raised", "bg-inset", "bg-hover", "bg-active"]],
  ["foreground", ["fg", "fg-default", "fg-muted", "fg-subtle", "fg-disabled"]],
  ["line", ["border", "border-strong", "divider"]],
  ["accent", ["accent", "accent-fg", "accent-subtle"]],
  ["data", ["pr", "hr-z1", "hr-z2", "hr-z3", "hr-z4", "hr-z5", "danger", "success"]],
  ["map", ["map-bg", "map-water", "map-road", "map-label", "route-casing", "marker-ring"]],
];

function Swatches() {
  return (
    <Stack gap="5">
      {SWATCH_GROUPS.map(([group, keys]) => (
        <Stack key={group} gap="2">
          <Text size="xs" tone="subtle">
            {group}
          </Text>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(92px, 1fr))", gap: 8 }}>
            {keys.map((k) => (
              <div key={k} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <div style={{ height: 36, borderRadius: 8, background: `var(--ds-${k})`, border: "1px solid var(--ds-border)" }} />
                <Text size="xs" tone="muted">
                  {k}
                </Text>
              </div>
            ))}
          </div>
        </Stack>
      ))}
    </Stack>
  );
}

function Components() {
  return (
    <Stack gap="10">
      <Section title="buttons">
        <Cluster gap="2">
          <Button variant="primary">save</Button>
          <Button>cancel</Button>
          <Button variant="ghost">more</Button>
          <Button variant="danger">delete</Button>
          <Button size="sm">small</Button>
          <Button disabled>disabled</Button>
        </Cluster>
      </Section>
      <Section title="links">
        <Text>
          running text with an{" "}
          <Link href="/blog" variant="inline">
            inline link
          </Link>{" "}
          that reads as a link without a box.
        </Text>
        <Cluster gap="5">
          <Link href="/blog" variant="nav">
            nav link
          </Link>
          <Link href="/blog" variant="nav" current>
            current
          </Link>
          <Link href="/blog" variant="standalone">
            see all posts →
          </Link>
        </Cluster>
      </Section>
      <Section title="chips (selection only)">
        <Cluster gap="2">
          <Chip selected>all</Chip>
          <Chip>runs</Chip>
          <Chip>rides</Chip>
          <Chip>lifts</Chip>
        </Cluster>
      </Section>
      <Section title="breadcrumbs">
        <Breadcrumbs items={[{ label: "activities", href: "/design-system" }, { label: "aug 16", href: "/design-system" }, { label: HIKE.name }]} />
        <Text size="xs" tone="subtle">
          below 768px this collapses to a single 44px “‹ aug 16” target
        </Text>
      </Section>
      <Section title="stats">
        <StatGrid stats={HIKE.stats} size="hero" columns={4} />
        <StatGrid stats={HIKE.stats} size="lg" columns={4} />
        <StatGrid stats={HIKE.stats} size="sm" columns={4} />
      </Section>
      <Section title="list rows">
        <List>
          {RECENT.slice(0, 4).map((a, i) => (
            <ListRow
              key={a.id}
              href="/design-system"
              selected={i === 1}
              leading={<Icon src={`/icons/activities/${a.sport === "lift" ? "weight" : a.sport}.svg`} />}
              title={a.name}
              meta={`${a.date} · ${a.sport}`}
              trailing={a.stat}
            />
          ))}
        </List>
      </Section>
      <Section title="table, badge, legend">
        <Table
          rowKey={(r) => r.exercise}
          rows={LIFT.sets}
          columns={[
            { key: "x", header: "exercise", cell: (r) => (r.pr ? <Cluster gap="2" nowrap>{r.exercise}<Badge tone="pr">pr</Badge></Cluster> : r.exercise) },
            { key: "s", header: "sets", cell: (r) => r.sets },
            { key: "t", header: "best", align: "right", cell: (r) => r.top },
          ]}
        />
        <Cluster gap="2">
          <Badge>neutral</Badge>
          <Badge tone="pr">pr</Badge>
          <Badge tone="accent">new</Badge>
        </Cluster>
        <Legend items={[1, 2, 3, 4, 5].map((z) => ({ label: `zone ${z}`, color: `var(--ds-hr-z${z})` }))} />
      </Section>
      <Section title="map frame">
        <MapFrame caption="in the fog · 14 min" aspectMobile="4 / 3">
          <SpecimenMap />
        </MapFrame>
      </Section>
      <Section title="forms">
        <Stack gap="4">
          <Field id="sg-name" label="name" hint="optional">
            <Input id="sg-name" placeholder="your name" />
          </Field>
          <Field id="sg-comment" label="comment" error="say something first">
            <Textarea id="sg-comment" invalid placeholder="leave a comment…" />
          </Field>
          <Cluster gap="2">
            <Button variant="primary">post</Button>
          </Cluster>
        </Stack>
      </Section>
      <Section title="empty state">
        <EmptyState title="no posts yet" body="writing will show up here." />
      </Section>
    </Stack>
  );
}

function ThemePanel({ theme, accent, children }: { theme: "light" | "dark"; accent?: Accent; children: ReactNode }) {
  return (
    <div className="ds" data-theme={theme} data-accent={accent} style={{ padding: 24, borderRadius: 16, border: "1px solid var(--ds-border)", minWidth: 0 }}>
      <Stack gap="6">
        <Text size="xs" tone="subtle">
          {theme}
        </Text>
        {children}
      </Stack>
    </div>
  );
}

export default async function DesignSystemPage() {
  if (!(await canViewDesignLab())) notFound();
  const pair = (node: ReactNode, accent?: Accent) => (
    <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 420px), 1fr))" }}>
      <ThemePanel theme="light" accent={accent}>
        {node}
      </ThemePanel>
      <ThemePanel theme="dark" accent={accent}>
        {node}
      </ThemePanel>
    </div>
  );
  return (
    <div className="ds" style={{ minHeight: "100vh" }}>
      <Container width="wide" className="ds-page">
        <Stack gap="12">
          <PageHeader
            title="design system"
            titleSize="3xl"
            meta={[`${Object.keys(COLOR).length + 4} color tokens`, `${Object.keys(TYPE).length} type steps`, `${Object.keys(SPACE).length} space steps`]}
            actions={
              <Button href="/design-system/compare" variant="primary">
                compare directions
              </Button>
            }
          />

          <Section title="principles">
            <div style={{ display: "grid", gap: 20, gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))" }}>
              {PRINCIPLES.map(([t, b], i) => (
                <Stack key={t} gap="1">
                  <Text size="sm" tone="fg" weight="semibold">
                    {i + 1}. {t}
                  </Text>
                  <Text size="sm" tone="muted">
                    {b}
                  </Text>
                </Stack>
              ))}
            </div>
          </Section>

          <Section title="color">{pair(<Swatches />)}</Section>

          <Section title="accents (one per direction)">
            {(["blue", "amber", "green"] as Accent[]).map((a) => (
              <div key={a}>
                {pair(
                  <Cluster gap="3">
                    <Button variant="primary">{a}</Button>
                    <Chip selected>selected</Chip>
                    <Link href="/design-system" variant="inline">
                      inline link
                    </Link>
                    <div style={{ width: 160, height: 60 }}>
                      <MapFrame aspect="8 / 3">
                        <SpecimenMap />
                      </MapFrame>
                    </div>
                  </Cluster>,
                  a,
                )}
              </div>
            ))}
          </Section>

          <Section title="type">
            <Stack gap="3">
              {(Object.entries(TYPE) as [string, readonly [number, number, number]][]).reverse().map(([k, [size, lh]]) => (
                <Cluster key={k} gap="4" align="baseline" nowrap>
                  <span style={{ width: 96, flex: "none" }}>
                    <Text size="xs" tone="subtle">
                      {k} · {size}/{lh}
                    </Text>
                  </span>
                  {k === "display" || k === "3xl" || k === "2xl" || k === "xl" ? (
                    <Heading level={3} size={k as "xl"}>
                      29.34 mi up the hill
                    </Heading>
                  ) : (
                    <Text size={k as "base"}>my gps yearns for soda hall or smth</Text>
                  )}
                </Cluster>
              ))}
            </Stack>
          </Section>

          <Section title="space and radius">
            <Stack gap="2">
              {Object.entries(SPACE)
                .filter(([k]) => k !== "0")
                .map(([k, px]) => (
                  <Cluster key={k} gap="3" nowrap>
                    <span style={{ width: 64 }}>
                      <Text size="xs" tone="subtle">
                        {k} · {px}px
                      </Text>
                    </span>
                    <div style={{ height: 8, width: px, background: "var(--ds-accent)", borderRadius: 2 }} />
                  </Cluster>
                ))}
            </Stack>
            <Cluster gap="4">
              {Object.entries(RADIUS).map(([k, px]) => (
                <Stack key={k} gap="1">
                  <div style={{ width: 56, height: 40, border: "1px solid var(--ds-border-strong)", borderRadius: Math.min(px, 20) }} />
                  <Text size="xs" tone="subtle">
                    {k}
                  </Text>
                </Stack>
              ))}
            </Cluster>
          </Section>

          <Divider />

          <Section title="components">{pair(<Components />)}</Section>
        </Stack>
      </Container>
    </div>
  );
}
