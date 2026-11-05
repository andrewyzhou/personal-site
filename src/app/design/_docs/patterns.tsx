import type { ReactNode } from "react";
import { Stack, Table, Text, type Brand } from "@/design-system";
import { CONTROL, RADII } from "@/design-system/brands/types";
import { BRANDS } from "@/design-system/brands";
import { getSite } from "@/content/site";
import { Block, Prose } from "./kit";
import { BrandCompare, PatternPreview } from "./Compare";

type Page = (brand: Brand) => ReactNode;

const anatomy = (rows: [string, string][]) => (
  <div className="docs-anatomy">
    {rows.map(([k, v]) => (
      <div key={k} className="docs-anatomy">
        <span>
          <b>{k}</b> {v}
        </span>
      </div>
    ))}
  </div>
);

export const PATTERNS: Record<string, Page> = {
  "site-map": (brand) => {
    const site = getSite();
    return (
      <Stack gap="12">
        <Block title="four hubs" intro="the nav holds four hubs. home is the mark. every page lives under exactly one hub, which its breadcrumb names.">
          <div className="docs-table-wrap">
            <Table
              rowKey={(h) => h.id}
              rows={site.hubs}
              columns={[
                { key: "h", header: "hub", cell: (h) => <Text size="sm" tone="fg" weight="medium">{h.label}</Text> },
                { key: "u", header: "url", cell: (h) => <code className="docs-inline-code">{h.href}</code> },
                { key: "s", header: "gathers", cell: (h) => h.sections.join(" · ") },
                { key: "i", header: "intro", cell: (h) => h.intro },
              ]}
            />
          </div>
          <Text size="xs" tone="subtle">
            from content/site.yaml → hubs. rename a hub or reorder the nav there; every brand follows.
          </Text>
        </Block>
        <Block title="where everything lives">
          <div className="docs-table-wrap">
            <Table
              rowKey={(r) => r[0]}
              rows={[
                ["/", "home", "hero, bio, currently, the hubs, latest training, contact"],
                ["/work", "work", "tabs: work · research · teaching · projects · coursework (today: home tabs)"],
                ["/writing", "writing", "posts and notes in one list, filter chips"],
                ["/blog/[slug]", "writing", "kept as-is; breadcrumb “writing”"],
                ["/library/[slug]", "writing", "kept as-is; breadcrumb “writing”"],
                ["/photos, /photos/[slug]", "photos", "unchanged urls"],
                ["/training", "training", "one feed of activities and lifts, filters by sport, summary numbers, calendar, records, weekly volume"],
                ["/activities/[id]", "training", "kept; breadcrumb “training”. linked lifts show inline"],
                ["/lifts/[publicId]", "training", "kept; lift-only sessions"],
                ["/lifts", "training", "becomes the lifts filter of /training (redirect)"],
              ]}
              columns={[
                { key: "u", header: "url", cell: (r) => <code className="docs-inline-code">{r[0]}</code> },
                { key: "h", header: "hub", cell: (r) => r[1] },
                { key: "n", header: "notes", cell: (r) => r[2] },
              ]}
            />
          </div>
        </Block>
        <Block title="why training is one hub" intro="activities and lifts are two data sources for one thing: sessions. a lift logged during a recorded ride already shows on that ride's page; lift-only sessions get their own page. one feed with a lifts filter matches how they're lived, and the nav stays at four items, which the pill can hold on a phone." />
        <Block title="live">
          <PatternPreview brand={brand.id} path="" />
        </Block>
      </Stack>
    );
  },

  home: (brand) => (
    <Stack gap="12">
      <Block title="anatomy" intro="home is the hub of hubs: who this is, what's happening now, where to go, how to reach me.">
        {anatomy([
          ["greeting", "display size, once on the site"],
          ["bio", "two short paragraphs; inline links in the brand's link style"],
          ["currently", "the live sentence (reading, listening, last workout)"],
          ["explore", "the four hubs as rows with their intros"],
          ["latest", "three newest training sessions"],
          ["contact", "how to reach me"],
        ])}
      </Block>
      <Block title="live">
        <PatternPreview brand={brand.id} path="" />
      </Block>
    </Stack>
  ),

  "hub-index": (brand) => (
    <Stack gap="12">
      <Block title="anatomy" intro="every hub's front page has the same shape.">
        {anatomy([
          ["page header", "hub title, intro as meta"],
          ["summary", "optional numbers (training: sessions this week, distance this year)"],
          ["filters", "chips that are links, so a filtered view can be shared"],
          ["list", "list rows, newest first; empty state when a filter has nothing"],
        ])}
      </Block>
      <Block title="training">
        <PatternPreview brand={brand.id} path="/training" />
      </Block>
      <Block title="work">
        <PatternPreview brand={brand.id} path="/work" />
      </Block>
      <Block title="writing">
        <PatternPreview brand={brand.id} path="/writing" />
      </Block>
    </Stack>
  ),

  activity: (brand) => (
    <Stack gap="12">
      <Block title="anatomy" intro="numbers first, then the map, then everything else.">
        {anatomy([
          ["breadcrumb", "training › this session"],
          ["title + meta", "name, date · time · sport"],
          ["key stats", "four numbers, hero size"],
          ["map", "full content width; 4:5 on phones; fog caption below"],
          ["detail", "notes and secondary stats side by side; later splits, charts, replay"],
        ])}
      </Block>
      <Block title="live">
        <PatternPreview brand={brand.id} path="/training/464" />
      </Block>
    </Stack>
  ),

  "lift-session": (brand) => (
    <Stack gap="12">
      <Block title="anatomy">
        {anatomy([
          ["breadcrumb + title", "same as an activity"],
          ["totals", "time, volume, heart rate"],
          ["program section", "every exercise: sets, load, best; records marked with a pr badge"],
        ])}
      </Block>
      <Block title="live">
        <PatternPreview brand={brand.id} path="/training/496" />
      </Block>
    </Stack>
  ),

  article: (brand) => (
    <Stack gap="12">
      <Block title="anatomy" intro="one readable column (prose width), large body text.">
        {anatomy([
          ["breadcrumb", "writing › title"],
          ["title + meta", "date · tags"],
          ["body", "lg text, inline links in the brand's style"],
        ])}
      </Block>
      <Block title="live">
        <PatternPreview brand={brand.id} path="/writing/hello-world" />
      </Block>
    </Stack>
  ),

  "empty-and-error": (brand) => (
    <Stack gap="12">
      <Block title="empty hub">
        <PatternPreview brand={brand.id} path="/photos" />
      </Block>
      <Block title="not found" intro="the shell stays, so a wrong url is never a dead end.">
        <PatternPreview brand={brand.id} path="/nope" />
      </Block>
    </Stack>
  ),
};

export const BRAND_PAGES: Record<string, Page> = {
  overview: (brand) => (
    <Stack gap="12">
      <Block title="a brand is one file" intro="everything that makes the site look like itself, as data in src/design-system/brands. content, markup and pages are shared by every brand.">
        <pre className="docs-code">
          <code>{`export const ${brand.id.toUpperCase()}: Brand = ${JSON.stringify(
            { id: brand.id, name: brand.name, accent: brand.accent, type: { ...brand.type, display: "…", body: "…" }, shape: brand.shape, density: brand.density, motion: brand.motion, shell: brand.shell, components: brand.components },
            null,
            2,
          )};`}</code>
        </pre>
      </Block>
      <Block title="what a brand controls">
        <div className="docs-table-wrap">
          <Table
            rowKey={(r) => r[0]}
            rows={[
              ["accent", "one accent family and the gray tint that goes with it", brand.accent],
              ["type", "display and body faces, heading weight, display scale, page title size", `${brand.type.headingWeight} · ×${brand.type.displayScale} · ${brand.type.pageTitle}`],
              ["shape", "the radius family", `${brand.shape} (${RADII[brand.shape].sm}/${RADII[brand.shape].md}/${RADII[brand.shape].lg})`],
              ["density", "control heights, row padding", `${brand.density} (${CONTROL[brand.density].height}px)`],
              ["motion", "a multiplier on every duration", `×${brand.motion}`],
              ["shell", "pill, topbar or rail", brand.shell],
              ["chips", "outline or filled", brand.components.chip],
              ["inline links", "underline or highlight", brand.components.inlineLink],
              ["stat rows", "plain or divided", brand.components.stats],
            ]}
            columns={[
              { key: "k", header: "setting", cell: (r) => <Text size="sm" tone="fg" weight="medium">{r[0]}</Text> },
              { key: "w", header: "controls", cell: (r) => r[1] },
              { key: "v", header: `this brand (${brand.id})`, cell: (r) => <code className="docs-inline-code">{r[2]}</code> },
            ]}
          />
        </div>
      </Block>
      <Block title="what a brand never touches">
        <Prose>
          <ul>
            <li>content: every word and number comes from the content layer.</li>
            <li>the spacing scale and the type steps for body text.</li>
            <li>meaning colors (records, heart-rate zones, danger) beyond their tint.</li>
            <li>accessibility: contrast, 44px touch targets, focus rings, reduced motion.</li>
          </ul>
        </Prose>
      </Block>
      <Block title="making a new brand">
        <Prose>
          <ul>
            <li>copy a brand file in <code>src/design-system/brands/index.ts</code>, change the settings, register it in <code>BRANDS</code>.</li>
            <li>run <code>npm run tokens</code>. the unit tests check contrast for every brand&apos;s accent in both themes.</li>
            <li>open <code>/design/&lt;id&gt;</code>: these docs restyle themselves in the new brand, every pattern included.</li>
            <li>a new font face needs one line in the root layout (next/font) first.</li>
            <li>when it&apos;s right, set it as the site&apos;s brand. switching is one attribute on the page; content never moves.</li>
          </ul>
        </Prose>
      </Block>
    </Stack>
  ),

  compare: () => (
    <Stack gap="8">
      <Prose>
        <p style={{ margin: 0 }}>the same page in every brand. each frame is the real page at its real width, scaled down.</p>
      </Prose>
      <BrandCompare brands={Object.values(BRANDS).map((b) => ({ id: b.id, name: b.name }))} />
    </Stack>
  ),
};
