import type { ReactNode } from "react";
import { BrandRoot, Cluster, Heading, Icon, Stack, StatGrid, Text, type Brand } from "@/design-system";
import { BREAKPOINT, COLOR, MOTION, SPACE, TYPE, WIDTH, colors } from "@/design-system/tokens";
import { CONTROL, RADII } from "@/design-system/brands/types";
import { Block, DoDont, Example, Prose, TokenTable } from "./kit";
import { HIKE } from "./specimens";

type Page = (brand: Brand) => ReactNode;

const PRINCIPLES: [string, string, string, string][] = [
  ["one shell, everywhere", "every page sits in the same frame: mark, hubs, theme, footer. deep pages are never dead ends.", "an activity page with the same pill nav as home and a breadcrumb back to training.", "a lone “← home” as the only way off a page."],
  ["quiet by default", "grays and one accent. color appears only where it means something: the route, a record, heart-rate zones, focus, a destructive action.", "the route is the only saturated thing on a map.", "tinted headings, colored icons, the accent as decoration."],
  ["hierarchy from type, not boxes", "importance is size, weight and contrast. surfaces are for things that float or group controls.", "a 40px number over a 12px label, separated by space.", "a card around every stat."],
  ["three affordances", "links are text, buttons are buttons, chips select. navigation is never a chip.", "breadcrumb parents as plain text links.", "a gray box around a back link."],
  ["one spacing scale", "every gap, padding and margin is a 4px step from the tokens; layout primitives own spacing.", "gap=\"6\" on the stack.", "marginTop: 0.35rem on one element."],
  ["content first, chrome last", "the thing you came for leads. chrome is small, quiet and stable.", "title and numbers, then a full-width map.", "a 720px column leaving half the screen empty."],
  ["motion explains", "120–280ms state changes with one easing. nothing moves on its own except data. reduced motion is respected.", "a hover wash that fades in.", "text that reflows while it types itself."],
  ["light and dark as a pair", "every color has two authored values. no invert() hacks, no flash of the wrong theme.", "map colors from tokens per theme.", "filter: invert(.92) on a map."],
  ["mobile is first-class", "designed at 390px first. 44px targets, no hover-only information, no scroll traps.", "the breadcrumb collapses to one 44px “‹ training”.", "a 20px-tall back link; a map that eats page scrolls."],
  ["designs never own content", "a design renders everything the content layer gives it, and adds nothing.", "<Stat label={s.label} value={s.display} />", "\"avg hr\" or toFixed(1) inside a component."],
];

const COLOR_GROUPS: [string, string, string[]][] = [
  ["surface", "backgrounds, from the page down to a pressed row.", ["bg", "bg-subtle", "bg-raised", "bg-inset", "bg-hover", "bg-active"]],
  ["foreground", "text, from titles to disabled. fg-subtle is the faintest text that still meets 4.5:1.", ["fg", "fg-default", "fg-muted", "fg-subtle", "fg-disabled"]],
  ["line", "hairlines. borders frame controls; dividers separate content.", ["border", "border-strong", "divider"]],
  ["accent", "the one hue. routes, focus, selection, primary buttons.", ["accent", "accent-fg", "accent-subtle", "on-accent"]],
  ["meaning", "color that carries data: records, heart-rate zones, success and danger.", ["pr", "hr-z1", "hr-z2", "hr-z3", "hr-z4", "hr-z5", "success", "danger"]],
  ["map", "the basemap stays gray so the route is the only color on it.", ["map-bg", "map-water", "map-road", "map-label", "route-casing", "marker-ring"]],
];

function Swatches({ brand, keys }: { brand: Brand; keys: string[] }) {
  return (
    <div className="docs-example-panes">
      {(["light", "dark"] as const).map((t) => {
        const c = colors(t, brand.accent);
        return (
          <BrandRoot key={t} brand={brand} theme={t} className="docs-pane">
            <span className="docs-pane-label">{t}</span>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(7rem, 1fr))", gap: "var(--ds-space-3)" }}>
              {keys.map((k) => (
                <div key={k} className="ds-stack" data-gap="1">
                  <div className="docs-swatch" style={{ background: `var(--ds-${k})` }} />
                  <Text size="xs" tone="fg" weight="medium">
                    {k}
                  </Text>
                  <Text size="xs" tone="subtle">
                    {(c[k] ?? "").replace(/^oklch\(|\)$/g, "")}
                  </Text>
                </div>
              ))}
            </div>
          </BrandRoot>
        );
      })}
    </div>
  );
}

export const FOUNDATIONS: Record<string, Page> = {
  principles: () => (
    <Stack gap="8">
      {PRINCIPLES.map(([t, b, d, x], i) => (
        <Block key={t} title={`${i + 1}. ${t}`} intro={b}>
          <DoDont doText={d} dontText={x} />
        </Block>
      ))}
    </Stack>
  ),

  color: (brand) => (
    <Stack gap="12">
      <Prose>
        <p style={{ margin: 0 }}>
          colors are oklch values in <code>src/design-system/tokens.ts</code>, used as <code>var(--ds-name)</code>. each has a light and a dark value, written together. this brand uses the <b>{brand.accent}</b> accent; its grays carry a faint tint of it.
        </p>
      </Prose>
      {COLOR_GROUPS.map(([name, note, keys]) => (
        <Block key={name} title={name} intro={note}>
          <Swatches brand={brand} keys={keys} />
        </Block>
      ))}
      <Block title="contrast" intro="every text color is checked against every surface in both themes by a unit test (wcag aa, 4.5:1). the route is checked against the basemap (3:1 for graphics).">
        <DoDont
          doText="use fg-subtle for labels and meta; it still passes aa."
          dontText="invent a lighter gray for a quieter label; the test will fail, and so will readers."
        />
      </Block>
    </Stack>
  ),

  typography: (brand) => (
    <Stack gap="12">
      <Block title="faces" intro="one family for reading and one for display. faces must be loaded in the root layout before a brand can use them.">
        <TokenTable
          rows={[
            { token: "--ds-font-display", value: <span style={{ fontFamily: brand.type.display }}>{brand.type.display.split(",")[1]?.trim() ?? "display"}</span>, use: "headings, page titles, big numbers" },
            { token: "--ds-font-sans", value: <span style={{ fontFamily: brand.type.body }}>{brand.type.body.split(",")[1]?.trim() ?? "body"}</span>, use: "everything else" },
            { token: "--ds-font-mono", value: <code className="docs-inline-code">ui-monospace</code>, use: "code" },
            { token: "--ds-heading-weight", value: brand.type.headingWeight, use: "headings and stat values" },
          ]}
        />
      </Block>
      <Block title="scale" intro={`eight steps. body sizes are fixed; this brand multiplies the three display steps by ${brand.type.displayScale}.`}>
        <Stack gap="5">
          {(Object.entries(TYPE) as [string, readonly [number, number, number]][]).reverse().map(([k, [size, lh]]) => {
            const display = k === "2xl" || k === "3xl" || k === "display";
            const px = display ? Math.round(size * brand.type.displayScale) : size;
            return (
              <div key={k} style={{ display: "grid", gridTemplateColumns: "6.5rem minmax(0, 1fr)", gap: "var(--ds-space-4)", alignItems: "baseline" }}>
                <Text size="xs" tone="subtle">
                  {k} · {px}/{display ? Math.round(lh * brand.type.displayScale) : lh}
                </Text>
                {display || k === "xl" ? (
                  <Heading level={3} size={k as "xl"}>
                    29.34 mi up the hill
                  </Heading>
                ) : (
                  <Text size={k as "base"}>my gps yearns for soda hall or smth</Text>
                )}
              </div>
            );
          })}
        </Stack>
      </Block>
      <Block title="where each step goes">
        <TokenTable
          rows={[
            { token: "display", value: "home greeting", use: "once per site" },
            { token: brand.type.pageTitle, value: "page titles", use: "one per page (brand setting)" },
            { token: "xl / lg", value: "section titles", use: "inside a page" },
            { token: "base / lg", value: "running text", use: "lg for articles, base elsewhere" },
            { token: "sm", value: "meta, table cells, breadcrumbs", use: "secondary information" },
            { token: "xs", value: "labels, captions, map credit", use: "the quietest text" },
          ]}
        />
      </Block>
      <Block title="hierarchy">
        <DoDont
          doEx={<StatGrid stats={HIKE.stats.slice(0, 2)} size="lg" columns={2} />}
          doText="a big number and a small label say which matters without any box."
          dontText="bold, color and a border on the same element; pick one way to stand out."
        />
      </Block>
    </Stack>
  ),

  spacing: () => (
    <Stack gap="12">
      <Block title="the scale" intro="every gap, padding and margin is one of these. components take a gap prop with the step name.">
        <Stack gap="2">
          {Object.entries(SPACE)
            .filter(([k]) => k !== "0")
            .map(([k, px]) => (
              <div key={k} style={{ display: "grid", gridTemplateColumns: "6.5rem minmax(0, 1fr)", gap: "var(--ds-space-4)", alignItems: "center" }}>
                <Text size="xs" tone="subtle">
                  {k} · {px}px
                </Text>
                <div style={{ height: 10, width: px * 2, maxWidth: "100%", background: "var(--ds-accent)", borderRadius: 2 }} />
              </div>
            ))}
        </Stack>
      </Block>
      <Block title="which step where">
        <TokenTable
          rows={[
            { token: "1 · 4px", value: "label under a number", use: "things that are one unit" },
            { token: "2 · 8px", value: "chips in a row, icon and text", use: "siblings of the same kind" },
            { token: "3–4 · 12–16px", value: "a heading and its content", use: "related groups" },
            { token: "6–8 · 24–32px", value: "blocks inside a page", use: "separate ideas" },
            { token: "12–16 · 48–64px", value: "sections of a page", use: "different topics" },
            { token: "24 · 96px", value: "page bottom on desktop", use: "breathing room before the footer" },
          ]}
        />
      </Block>
      <Block title="rules">
        <DoDont
          doText="let the parent own spacing: <Stack gap=&quot;6&quot;> around the children."
          dontText="give a child its own margin to push away from a sibling; it collapses or doubles."
        />
      </Block>
    </Stack>
  ),

  layout: () => (
    <Stack gap="12">
      <Block title="widths">
        <TokenTable
          rows={[
            { token: "prose", value: `${WIDTH.prose}px`, use: "articles, notes, the home column; about 65 characters" },
            { token: "content", value: `${WIDTH.content}px`, use: "hubs, activity and lift pages" },
            { token: "wide", value: `${WIDTH.wide}px`, use: "galleries and dashboards" },
            { token: "rail", value: `${WIDTH.rail}px`, use: "a sidebar shell or the docs nav" },
          ]}
        />
      </Block>
      <Block title="breakpoints" intro="designed at 390px, then widened. side gutters are 16px on phones and 32px from md up.">
        <TokenTable rows={Object.entries(BREAKPOINT).map(([k, v]) => ({ token: k, value: `${v}px`, use: k === "md" ? "nav goes inline; breadcrumbs expand" : k === "lg" ? "rail shells and the docs sidebar appear" : k === "sm" ? "4-up stat rows" : "wide grids" }))} />
      </Block>
      <Block title="page anatomy" intro="every page is the same four layers. only the body changes.">
        <div className="docs-anatomy">
          <b>shell</b> mark · hubs · theme (persistent)
          <div className="docs-anatomy">
            <b>page header</b> breadcrumbs · title · meta · actions
          </div>
          <div className="docs-anatomy">
            <b>body</b> sections, each a heading and its content, spaced by the scale
            <div className="docs-anatomy">
              <b>section</b> title + actions, then content
            </div>
          </div>
          <b>footer</b>
        </div>
      </Block>
      <Block title="grids">
        <Prose>
          <ul>
            <li>auto-fill grids (<code>&lt;Grid min=&quot;18rem&quot;&gt;</code>) instead of fixed column counts, so rows reflow on any width.</li>
            <li>stat rows are 2-up on phones and 4-up from sm.</li>
            <li>never a fixed width wider than the screen; only tables and code scroll sideways, inside their own box.</li>
          </ul>
        </Prose>
      </Block>
    </Stack>
  ),

  shape: (brand) => (
    <Stack gap="12">
      <Block title="radius" intro={`brands pick a family. this brand is ${brand.shape}.`}>
        <Cluster gap="6">
          {(["sharp", "soft", "round"] as const).map((s) => (
            <Stack key={s} gap="2">
              <Cluster gap="2">
                {(["sm", "md", "lg"] as const).map((k) => (
                  <div key={k} style={{ width: 56, height: 40, border: `1px solid var(--ds-${s === brand.shape ? "accent" : "border-strong"})`, borderRadius: RADII[s][k] }} />
                ))}
              </Cluster>
              <Text size="xs" tone={s === brand.shape ? "fg" : "subtle"}>
                {s} · {RADII[s].sm}/{RADII[s].md}/{RADII[s].lg}
              </Text>
            </Stack>
          ))}
        </Cluster>
      </Block>
      <Block title="elevation" intro="three levels. most things are flat.">
        <Example brand={brand}>
          <div style={{ padding: 16, borderRadius: "var(--ds-radius-lg)" }}>
            <Text size="sm">0 · flat</Text>
          </div>
          <div style={{ padding: 16, borderRadius: "var(--ds-radius-lg)", border: "1px solid var(--ds-border)" }}>
            <Text size="sm">1 · hairline</Text>
          </div>
          <div style={{ padding: 16, borderRadius: "var(--ds-radius-lg)", background: "var(--ds-bg-raised)", border: "1px solid var(--ds-border)", boxShadow: "var(--ds-shadow-popover)" }}>
            <Text size="sm">2 · floating</Text>
          </div>
        </Example>
        <Prose>
          <ul>
            <li>flat: page content. hierarchy comes from type.</li>
            <li>hairline: inputs, map frames, tables.</li>
            <li>floating: menus, the pill nav. in dark mode, a border replaces the shadow.</li>
          </ul>
        </Prose>
      </Block>
      <Block title="density" intro={`control heights for this brand: ${CONTROL[brand.density].height}px (small ${CONTROL[brand.density].small}px). on touch screens every control grows to 44px.`} />
    </Stack>
  ),

  motion: (brand) => (
    <Stack gap="12">
      <Block title="durations" intro={`this brand runs motion at ${brand.motion}×.`}>
        <TokenTable
          rows={[
            { token: "--ds-dur-fast", value: `${Math.round(MOTION.fast * brand.motion)}ms`, use: "hover, press" },
            { token: "--ds-dur-base", value: `${Math.round(MOTION.base * brand.motion)}ms`, use: "open, close, switch" },
            { token: "--ds-dur-slow", value: `${Math.round(MOTION.slow * brand.motion)}ms`, use: "route draw, page enter" },
            { token: "--ds-ease-standard", value: MOTION.standard, use: "everything entering or changing" },
            { token: "--ds-ease-exit", value: MOTION.exit, use: "things leaving" },
          ]}
        />
      </Block>
      <Block title="rules">
        <DoDont
          doText="animate a state change the reader caused: a hover, an open menu, a toggled theme."
          dontText="move content on its own: auto-advancing carousels, typing text, bouncing icons. under reduced motion every duration is 0."
        />
      </Block>
    </Stack>
  ),

  iconography: (brand) => (
    <Stack gap="12">
      <Block title="the set" intro="monochrome svgs in /public/icons, drawn with <Icon>, which fills them with the current text color. no invert() hacks.">
        <Example brand={brand}>
          {["run", "ride", "hike", "walk", "swim", "weight", "climb", "soccer", "tennis", "yoga", "workout"].map((n) => (
            <Stack key={n} gap="1">
              <Icon src={`/icons/activities/${n}.svg`} size="1.5rem" />
              <Text size="xs" tone="subtle">
                {n}
              </Text>
            </Stack>
          ))}
        </Example>
      </Block>
      <Block title="rules">
        <DoDont doText="icons sit beside a label, in the label's color." dontText="color an icon to make it stand out; color is for meaning." />
      </Block>
    </Stack>
  ),

  voice: () => (
    <Stack gap="12">
      <Block title="how the site talks">
        <Prose>
          <ul>
            <li>lowercase, everywhere, including titles and buttons.</li>
            <li>first person and plain: “i&apos;m currently reading”, not “currently reading:”.</li>
            <li>specific over clever: “no posts yet”, not “nothing to see here!”.</li>
            <li>a control says what it does: “post”, “switch to dark mode”.</li>
            <li>numbers carry units, formatted once by the content layer (29.34 mi, 2:27:23).</li>
          </ul>
        </Prose>
      </Block>
      <Block title="empty states and errors">
        <DoDont doText="say what's missing and what will appear: “no photos yet. sets show up here as they're published.”" dontText="blame or apologize: “oops! something went wrong :(”." />
      </Block>
      <Block title="where copy lives">
        <Prose>
          <p style={{ margin: 0 }}>
            every word is content: <code>content/site.yaml</code> for site copy, entries for everything else. designs never contain copy. see <code>content/README.md</code>.
          </p>
        </Prose>
      </Block>
    </Stack>
  ),
};

// used by the color page to list every token once
export const ALL_COLOR_KEYS = Object.keys(COLOR);
