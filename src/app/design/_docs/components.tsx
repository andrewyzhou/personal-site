import type { ReactNode } from "react";
import {
  Badge,
  Breadcrumbs,
  Button,
  Chip,
  Cluster,
  EmptyState,
  Field,
  Icon,
  Input,
  Legend,
  Link,
  List,
  ListRow,
  MapFrame,
  PageHeader,
  Stack,
  Stat,
  StatGrid,
  Table,
  Text,
  Textarea,
  type Brand,
} from "@/design-system";
import { Block, DoDont, Example, Props, Prose } from "./kit";
import { SpecimenMap } from "./SpecimenMap";
import { HIKE, LIFT, SPORT_ICON, TRAINING } from "./specimens";

type Page = (brand: Brand) => ReactNode;

const sport = (s: string) => <Icon src={`/icons/activities/${SPORT_ICON[s] ?? "activity"}.svg`} />;

export const COMPONENTS: Record<string, Page> = {
  button: (brand) => (
    <Stack gap="12">
      <Block title="variants">
        <Example
          brand={brand}
          code={`<Button variant="primary">post</Button>
<Button>cancel</Button>
<Button variant="ghost">more</Button>
<Button variant="danger">delete</Button>`}
        >
          <Button variant="primary">post</Button>
          <Button>cancel</Button>
          <Button variant="ghost">more</Button>
          <Button variant="danger">delete</Button>
        </Example>
      </Block>
      <Block title="sizes and states">
        <Example brand={brand}>
          <Button size="sm">small</Button>
          <Button>medium</Button>
          <Button disabled>disabled</Button>
          <Button variant="primary" href="#">
            as a link
          </Button>
        </Example>
      </Block>
      <Block title="props">
        <Props
          rows={[
            { name: "variant", type: '"primary" | "secondary" | "ghost" | "danger"', def: '"secondary"', note: "one primary per view at most" },
            { name: "size", type: '"sm" | "md"', def: '"md"', note: "height comes from the brand's density; 44px on touch" },
            { name: "href", type: "string", note: "renders a link styled as a button (external urls open in a new tab)" },
            { name: "icon", type: "ReactNode", note: "leading icon; icon without children makes a square button" },
          ]}
        />
      </Block>
      <Block title="usage">
        <DoDont
          doEx={<Button variant="primary">post comment</Button>}
          doText="a verb for what happens."
          dontEx={<Link href="#">post comment</Link>}
          dontText="a link for an action that changes something."
        />
      </Block>
    </Stack>
  ),

  link: (brand) => (
    <Stack gap="12">
      <Block title="variants" intro={`inline links follow the brand: this brand draws them as ${brand.components.inlineLink === "highlight" ? "a soft highlight, the first site's signature" : "an underline"}.`}>
        <Example brand={brand} stack code={`<Link href="/blog" variant="inline">inline</Link>
<Link href="/training" variant="nav" current>nav</Link>
<Link href="/writing" variant="standalone">standalone</Link>`}>
          <Text>
            i was an ml engineer intern at{" "}
            <Link href="#" variant="inline">
              annapurna labs
            </Link>{" "}
            on the neuron distributed training team.
          </Text>
          <Cluster gap="5">
            <Link href="#" variant="nav">
              work
            </Link>
            <Link href="#" variant="nav" current>
              training
            </Link>
            <Link href="#" variant="standalone">
              see all posts →
            </Link>
          </Cluster>
        </Example>
      </Block>
      <Block title="props">
        <Props
          rows={[
            { name: "variant", type: '"inline" | "nav" | "standalone"', def: '"standalone"', note: "inline inside sentences; nav in navigation; standalone on its own line" },
            { name: "current", type: "boolean", note: "marks the page you're on (aria-current)" },
            { name: "tone", type: '"muted"', note: "quieter standalone link" },
          ]}
        />
      </Block>
      <Block title="usage">
        <DoDont doText="navigation is text that brightens on hover." dontText="a resting gray box around navigation; it reads as selected, not as a way back." />
      </Block>
    </Stack>
  ),

  chip: (brand) => (
    <Stack gap="12">
      <Block title="filters" intro={`chips select. this brand draws them ${brand.components.chip}.`}>
        <Example brand={brand} code={`<Chip selected>all</Chip>
<Chip>runs</Chip>
<Chip href="/training?sport=ride">rides</Chip>`}>
          <Chip selected>all</Chip>
          <Chip>runs</Chip>
          <Chip>rides</Chip>
          <Chip>hikes</Chip>
          <Chip>lifts</Chip>
        </Example>
      </Block>
      <Block title="props">
        <Props
          rows={[
            { name: "selected", type: "boolean", note: "on (aria-pressed for buttons, aria-current for links); padding never changes" },
            { name: "href", type: "string", note: "a filter that's a url, so it can be shared" },
            { name: "size", type: '"md" | "lg"', def: '"md"', note: "lg for a hub's main tabs" },
          ]}
        />
      </Block>
      <Block title="usage">
        <DoDont doText="filters, tabs and tags." dontText="navigation or buttons. a chip that goes back or does something is the wrong component." />
      </Block>
    </Stack>
  ),

  breadcrumbs: (brand) => (
    <Stack gap="12">
      <Block title="trail" intro="parents are nav links; the current page is plain text. below 768px the trail collapses to one 44px “‹ parent” target. narrow this window to see it.">
        <Example brand={brand} code={`<Breadcrumbs items={[
  { label: "training", href: "/training" },
  { label: "epic hike at super underground spot" },
]} />`}>
          <Breadcrumbs items={[{ label: "training", href: "#" }, { label: HIKE.name }]} />
        </Example>
      </Block>
      <Block title="usage">
        <DoDont doText="hub, then the page. two levels is almost always enough." dontText="dates or filters as crumbs; they aren't places." />
      </Block>
    </Stack>
  ),

  stat: (brand) => (
    <Stack gap="12">
      <Block title="sizes" intro={`stat rows are ${brand.components.stats} in this brand.`}>
        <Example brand={brand} stack code={`<StatGrid stats={stats} size="hero" columns={4} />`}>
          <StatGrid stats={HIKE.stats} size="hero" columns={4} />
          <StatGrid stats={HIKE.stats} size="lg" columns={4} />
          <StatGrid stats={HIKE.stats} size="sm" columns={4} />
        </Example>
      </Block>
      <Block title="props">
        <Props
          rows={[
            { name: "value", type: "string", note: "already formatted by the content layer" },
            { name: "unit", type: "string", note: "drawn smaller and muted" },
            { name: "label", type: "string", note: "what the number is" },
            { name: "size", type: '"hero" | "lg" | "md" | "sm"', def: '"lg"', note: "hero for the page's key numbers" },
          ]}
        />
      </Block>
      <Block title="usage">
        <DoDont doEx={<Stat value="29.34" unit="mi" label="distance" />} doText="the number big, the label small." dontText="a box, an icon and a colored number for each stat." />
      </Block>
    </Stack>
  ),

  "list-row": (brand) => (
    <Stack gap="12">
      <Block title="rows">
        <Example brand={brand} stack code={`<ListRow href="/activities/496" leading={<Icon …/>}
  title="bike + lift with edward" meta="nov 2 · lift" trailing="3:05:22" />`}>
          <List>
            {TRAINING.slice(0, 4).map((a, i) => (
              <ListRow key={a.id} href="#" selected={i === 1} leading={sport(a.sport)} title={a.name} meta={`${a.date} · ${a.sport}`} trailing={a.stat} />
            ))}
          </List>
        </Example>
      </Block>
      <Block title="props">
        <Props
          rows={[
            { name: "title", type: "ReactNode", note: "one line, truncates" },
            { name: "meta", type: "ReactNode", note: "second line, subtle" },
            { name: "leading / trailing", type: "ReactNode", note: "icon before; a number or arrow after" },
            { name: "href | onClick", type: "string | () => void", note: "makes the row interactive with a hover wash" },
            { name: "selected", type: "boolean", note: "for list/detail layouts" },
          ]}
        />
      </Block>
    </Stack>
  ),

  table: (brand) => (
    <Stack gap="12">
      <Block title="aligned numbers" intro="tabular figures, hairlines between rows, right-aligned numbers.">
        <Example brand={brand} stack>
          <Table
            rowKey={(r) => r.exercise}
            rows={LIFT.sets}
            columns={[
              { key: "x", header: "exercise", cell: (r) => (r.pr ? <Cluster gap="2" nowrap>{r.exercise}<Badge tone="pr">pr</Badge></Cluster> : r.exercise) },
              { key: "s", header: "sets", cell: (r) => r.sets },
              { key: "t", header: "best", align: "right", cell: (r) => r.top },
            ]}
          />
        </Example>
      </Block>
    </Stack>
  ),

  badge: (brand) => (
    <Stack gap="12">
      <Block title="badges">
        <Example brand={brand}>
          <Badge>neutral</Badge>
          <Badge tone="pr">pr</Badge>
          <Badge tone="accent">post</Badge>
        </Example>
      </Block>
      <Block title="legend" intro="heart-rate zones use the data colors; the legend is the key.">
        <Example brand={brand}>
          <Legend items={[1, 2, 3, 4, 5].map((z) => ({ label: `zone ${z}`, color: `var(--ds-hr-z${z})` }))} />
        </Example>
      </Block>
    </Stack>
  ),

  "empty-state": (brand) => (
    <Stack gap="12">
      <Block title="empty section">
        <Example brand={brand} stack code={`<EmptyState title="no photos yet." body="sets will show up here as they're published." />`}>
          <EmptyState title="no photos yet." body="sets will show up here as they're published." />
        </Example>
      </Block>
    </Stack>
  ),

  forms: (brand) => (
    <Stack gap="12">
      <Block title="field">
        <Example brand={brand} stack code={`<Field id="name" label="name" hint="optional">
  <Input id="name" placeholder="your name" />
</Field>`}>
          <Field id={`f-name-${brand.id}`} label="name" hint="optional">
            <Input id={`f-name-${brand.id}`} placeholder="your name" />
          </Field>
          <Field id={`f-comment-${brand.id}`} label="comment" error="say something first">
            <Textarea id={`f-comment-${brand.id}`} invalid placeholder="leave a comment…" />
          </Field>
          <Cluster gap="2">
            <Button variant="primary">post</Button>
          </Cluster>
        </Example>
      </Block>
      <Block title="usage">
        <Prose>
          <ul>
            <li>every input has a visible label; placeholders are examples, never labels.</li>
            <li>errors say what to do, under the field, in danger red.</li>
            <li>on phones inputs are 16px so the browser doesn&apos;t zoom.</li>
          </ul>
        </Prose>
      </Block>
    </Stack>
  ),

  icon: (brand) => (
    <Stack gap="12">
      <Block title="icon">
        <Example brand={brand} code={`<Icon src="/icons/activities/running-shoe.svg" />`}>
          {["run", "ride", "hike", "weight"].map((n) => (
            <Icon key={n} src={`/icons/activities/${n}.svg`} size="1.5rem" />
          ))}
        </Example>
      </Block>
    </Stack>
  ),

  "map-frame": (brand) => (
    <Stack gap="12">
      <Block title="frame" intro="the map library mounts inside; the frame owns the border, corners, aspect (16:10, 4:5 on phones), the restyled controls and credit, and the caption. maps use cooperative gestures so page scrolls never zoom them.">
        <Example brand={brand} stack>
          <MapFrame caption="in the fog · 14 min">
            <SpecimenMap />
          </MapFrame>
        </Example>
      </Block>
      <Block title="markers and route">
        <Prose>
          <ul>
            <li>route: <code>--ds-accent</code> on a <code>--ds-route-casing</code> halo; the only color on the map.</li>
            <li>start: filled accent dot with a <code>--ds-marker-ring</code>. end: ring in <code>--ds-fg</code>.</li>
            <li>basemap: <code>--ds-map-*</code> grays per theme, no invert filter.</li>
          </ul>
        </Prose>
      </Block>
    </Stack>
  ),

  "page-header": (brand) => (
    <Stack gap="12">
      <Block title="header" intro={`title size comes from the brand (${brand.type.pageTitle}).`}>
        <Example brand={brand} stack code={`<PageHeader crumbs={…} title="…" meta={["sunday, august 16", "6:48 pm", "hike"]} />`}>
          <PageHeader crumbs={[{ label: "training", href: "#" }, { label: HIKE.name }]} title={HIKE.name} titleSize={brand.type.pageTitle} meta={[HIKE.date, HIKE.time, HIKE.sport]} />
        </Example>
      </Block>
    </Stack>
  ),

  "app-shell": (brand) => (
    <Stack gap="12">
      <Block
        title="the frame"
        intro={`one structure, three looks: pill (floating capsule), topbar (sticky bar), rail (left column on wide screens). this brand uses ${brand.shell}. on phones every variant becomes the mark, the theme toggle and a menu.`}
      >
        <Prose>
          <ul>
            <li>mark: logo and name, links home.</li>
            <li>hubs: work · writing · photos · training, from <code>content/site.yaml</code>. the current hub is underlined.</li>
            <li>theme toggle; footer once, at the bottom.</li>
          </ul>
        </Prose>
      </Block>
      <Block title="see it" intro="every pattern page shows the shell live at desktop and phone widths.">
        <Link href={`/design/${brand.id}/patterns/activity`} variant="standalone">
          open the activity pattern →
        </Link>
      </Block>
    </Stack>
  ),
};
