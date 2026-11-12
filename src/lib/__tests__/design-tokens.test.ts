import fs from "fs";
import { describe, expect, it } from "vitest";
import { tokensCss } from "@/design-system/generate";
import { colors, grayHex, type Accent, type Theme } from "@/design-system/tokens";
import { isCurrent } from "@/design-system/components/ShellNav";
import { BRANDS, DEFAULT_BRAND } from "@/design-system/brands";

// oklch css string → [r,g,b] in 0..1 (alpha ignored; only opaque tokens are checked)
function oklchToRgb(css: string): [number, number, number] {
  const m = css.match(/oklch\(([\d.]+)%\s+([\d.]+)\s+([\d.]+)/);
  if (!m) throw new Error(`not oklch: ${css}`);
  const L = Number(m[1]) / 100;
  const C = Number(m[2]);
  const h = (Number(m[3]) * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l_ = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const lin = [
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  ];
  return lin.map((v) => Math.min(1, Math.max(0, v))) as [number, number, number];
}

function luminance(css: string): number {
  const [r, g, b] = oklchToRgb(css); // already linear light
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const THEMES: Theme[] = ["light", "dark"];
const ACCENTS: Accent[] = ["neutral", "blue", "amber", "green"];

describe("design tokens", () => {
  it("tokens.css is generated from tokens.ts (run npm run tokens)", () => {
    const onDisk = fs.readFileSync("src/design-system/tokens.css", "utf8").replace(/\r\n/g, "\n");
    expect(onDisk).toBe(tokensCss());
  });

  it("every color token has a value in both themes for every accent", () => {
    const keys = Object.keys(colors("light")).sort();
    for (const t of THEMES) for (const a of ACCENTS) expect(Object.keys(colors(t, a)).sort()).toEqual(keys);
  });

  // text that carries meaning meets wcag aa (4.5:1) on every surface it sits on
  it.each(THEMES.flatMap((t) => ACCENTS.map((a) => [t, a] as const)))("text contrast holds in %s / %s", (theme, accent) => {
    const c = colors(theme, accent);
    for (const surface of ["bg", "bg-subtle", "bg-raised"]) {
      for (const text of ["fg", "fg-default", "fg-muted", "fg-subtle", "accent-fg"]) {
        expect(contrast(c[text], c[surface]), `${text} on ${surface}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("the route stands out from the basemap in both themes", () => {
    for (const t of THEMES)
      for (const a of ["blue", "amber", "green"] as Accent[]) {
        const c = colors(t, a);
        expect(contrast(c.accent, c["map-bg"]), `${t}/${a}`).toBeGreaterThanOrEqual(2.2);
      }
  });

  it("converts gray lightness to hex like the css does", () => {
    expect(grayHex(100)).toBe("#ffffff");
    expect(grayHex(0)).toBe("#000000");
    expect(grayHex(17.3)).toMatch(/^#([0-9a-f]{2})\1\1$/);
  });
});

describe("brands", () => {
  const css = tokensCss();
  const layout = fs.readFileSync("src/app/layout.tsx", "utf8");
  const loadedFonts = [...layout.matchAll(/variable: "(--font-[a-z-]+)"/g)].map((m) => m[1]);

  it.each(Object.values(BRANDS))("brand $id is complete and buildable", (b) => {
    expect(BRANDS[b.id]).toBe(b);
    expect(["neutral", "blue", "amber", "green"]).toContain(b.accent);
    expect(css).toContain(`.ds[data-brand="${b.id}"]`);
    // a brand may only use faces the root layout actually loads, or the
    // device's own ui font (nothing to download)
    for (const stack of [b.type.display, b.type.body]) {
      if (stack.startsWith("ui-sans-serif, system-ui")) continue;
      const v = stack.match(/var\((--font-[a-z-]+)\)/)?.[1];
      expect(v && loadedFonts.includes(v), `${b.id}: ${stack}`).toBe(true);
    }
    expect(b.motion).toBeGreaterThan(0);
    expect(b.type.displayScale).toBeGreaterThan(0.5);
  });

  it("the default brand exists", () => {
    expect(BRANDS[DEFAULT_BRAND]).toBeDefined();
  });
});

describe("shell nav", () => {
  it("marks a section current on its own page and below it", () => {
    expect(isCurrent("/activities", "/activities")).toBe(true);
    expect(isCurrent("/activities/496", "/activities")).toBe(true);
    expect(isCurrent("/activitiesx", "/activities")).toBe(false);
    expect(isCurrent("/blog", "/")).toBe(false);
    expect(isCurrent("/", "/")).toBe(true);
    expect(isCurrent("/a/activities", "/a/activities?theme=dark")).toBe(true);
  });
});
