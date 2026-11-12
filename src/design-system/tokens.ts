// design tokens: the single source for every color, size, space, radius,
// shadow, duration and layer the design system uses. tokens.css is generated
// from this file (npm run tokens); js consumers (maps, charts) import it.
//
// colors are oklch. every color token has a light and a dark value, authored
// together. values are written as [lightness %, chroma, hue].

export type Theme = "light" | "dark";
export type Accent = "neutral" | "blue" | "amber" | "green";

type Lch = readonly [l: number, c: number, h: number];
type Pair = { light: Lch | string; dark: Lch | string };

const lch = (l: number, c = 0, h = 0): Lch => [l, c, h] as const;

// ---------------------------------------------------------------- color

// grays carry a tiny tint per accent so the whole palette sits together;
// "neutral" is pure gray like the current site
export const GRAY_TINT: Record<Accent, { c: number; h: number }> = {
  neutral: { c: 0, h: 0 },
  blue: { c: 0.004, h: 255 },
  amber: { c: 0.004, h: 75 },
  green: { c: 0.003, h: 160 },
};

const g = (l: number): Lch => lch(l);

// semantic colors. grays here are tint-free; the generator applies GRAY_TINT.
export const COLOR: Record<string, Pair> = {
  // surfaces
  bg: { light: g(98.5), dark: g(17.3) },
  "bg-subtle": { light: g(96.5), dark: g(19.5) },
  "bg-raised": { light: g(100), dark: g(22) },
  "bg-inset": { light: g(95.5), dark: g(14.8) },
  "bg-hover": { light: "oklch(17.3% 0 0 / 0.05)", dark: "oklch(94.9% 0 0 / 0.06)" },
  "bg-active": { light: "oklch(17.3% 0 0 / 0.09)", dark: "oklch(94.9% 0 0 / 0.11)" },
  // the soft box behind inline links and selected chips, and card panels.
  // defaults follow the accent.
  highlight: { light: "var(--ds-accent-subtle)", dark: "var(--ds-accent-subtle)" },
  "highlight-hover": { light: "color-mix(in oklch, var(--ds-accent) 26%, transparent)", dark: "color-mix(in oklch, var(--ds-accent) 26%, transparent)" },
  "highlight-active": { light: "color-mix(in oklch, var(--ds-accent) 32%, transparent)", dark: "color-mix(in oklch, var(--ds-accent) 32%, transparent)" },
  panel: { light: "oklch(17.3% 0 0 / 0.05)", dark: "oklch(94.9% 0 0 / 0.06)" },
  // foreground
  fg: { light: g(17.3), dark: g(94.9) },
  "fg-default": { light: g(28), dark: g(84.5) },
  "fg-muted": { light: g(44), dark: g(72) },
  "fg-subtle": { light: g(52), dark: g(62) },
  "fg-disabled": { light: g(72), dark: g(42) },
  // lines
  border: { light: g(89), dark: g(28) },
  "border-strong": { light: g(80), dark: g(36) },
  divider: { light: g(92), dark: g(24.5) },
  // data (meaningful color only)
  pr: { light: lch(62, 0.15, 75), dark: lch(78, 0.15, 80) },
  "hr-z1": { light: lch(70, 0.03, 250), dark: lch(62, 0.03, 250) },
  "hr-z2": { light: lch(66, 0.1, 220), dark: lch(68, 0.1, 220) },
  "hr-z3": { light: lch(68, 0.15, 140), dark: lch(72, 0.15, 140) },
  "hr-z4": { light: lch(72, 0.16, 75), dark: lch(78, 0.15, 80) },
  "hr-z5": { light: lch(60, 0.2, 28), dark: lch(66, 0.19, 28) },
  danger: { light: lch(55, 0.19, 27), dark: lch(68, 0.17, 25) },
  success: { light: lch(55, 0.13, 150), dark: lch(72, 0.14, 150) },
  // map chrome (the basemap itself stays gray; the route is the accent)
  "map-bg": { light: g(96), dark: g(19) },
  "map-water": { light: g(90), dark: g(24) },
  "map-road": { light: g(100), dark: g(30) },
  "map-label": { light: g(45), dark: g(70) },
  "map-control-bg": { light: "oklch(100% 0 0 / 0.86)", dark: "oklch(22% 0 0 / 0.86)" },
  "map-control-fg": { light: g(28), dark: g(84.5) },
  "route-casing": { light: "oklch(100% 0 0 / 0.9)", dark: "oklch(0% 0 0 / 0.55)" },
  "marker-ring": { light: g(100), dark: g(17.3) },
};

// the one accent: route, focus, selection, links in prose
export const ACCENT: Record<Accent, Record<"accent" | "accent-fg" | "accent-subtle" | "on-accent", Pair>> = {
  neutral: {
    accent: { light: g(17.3), dark: g(94.9) },
    "accent-fg": { light: g(17.3), dark: g(94.9) },
    "accent-subtle": { light: "oklch(17.3% 0 0 / 0.08)", dark: "oklch(94.9% 0 0 / 0.1)" },
    "on-accent": { light: g(98.5), dark: g(17.3) },
  },
  blue: {
    accent: { light: lch(55, 0.16, 255), dark: lch(70, 0.14, 250) },
    "accent-fg": { light: lch(48, 0.16, 258), dark: lch(78, 0.11, 250) },
    "accent-subtle": { light: "oklch(55% 0.16 255 / 0.1)", dark: "oklch(70% 0.14 250 / 0.16)" },
    "on-accent": { light: g(100), dark: g(14) },
  },
  amber: {
    accent: { light: lch(66, 0.17, 55), dark: lch(76, 0.15, 65) },
    "accent-fg": { light: lch(52, 0.15, 50), dark: lch(80, 0.13, 70) },
    "accent-subtle": { light: "oklch(66% 0.17 55 / 0.12)", dark: "oklch(76% 0.15 65 / 0.16)" },
    "on-accent": { light: g(14), dark: g(14) },
  },
  green: {
    accent: { light: lch(57, 0.14, 155), dark: lch(74, 0.15, 155) },
    "accent-fg": { light: lch(48, 0.12, 155), dark: lch(80, 0.13, 155) },
    "accent-subtle": { light: "oklch(57% 0.14 155 / 0.11)", dark: "oklch(74% 0.15 155 / 0.15)" },
    "on-accent": { light: g(100), dark: g(14) },
  },
};

// ---------------------------------------------------------------- type

export const FONT = {
  sans: 'var(--font-funnel), "Funnel Sans", ui-sans-serif, system-ui, sans-serif',
  mono: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
};

// [size px, line-height px, letter-spacing em]
export const TYPE = {
  xs: [12, 16, 0],
  sm: [13, 20, 0],
  base: [15, 24, 0],
  lg: [17, 26, 0],
  xl: [20, 28, -0.01],
  "2xl": [28, 34, -0.015],
  "3xl": [40, 44, -0.02],
  display: [64, 64, -0.025],
} as const;

export const WEIGHT = { regular: 400, medium: 500, semibold: 600 } as const;

// ---------------------------------------------------------------- space, size

export const SPACE = {
  "0": 0,
  "0.5": 2,
  "1": 4,
  "2": 8,
  "3": 12,
  "4": 16,
  "5": 20,
  "6": 24,
  "8": 32,
  "10": 40,
  "12": 48,
  "16": 64,
  "24": 96,
} as const;
export type Space = keyof typeof SPACE;

export const WIDTH = { prose: 680, content: 1120, wide: 1348, rail: 240 } as const;
export const BREAKPOINT = { sm: 640, md: 768, lg: 1024, xl: 1280 } as const;
export const RADIUS = { none: 0, sm: 4, md: 8, lg: 12, full: 9999 } as const;
export const HIT = 44; // minimum touch target

export const SHADOW: Record<"popover", Pair> = {
  popover: { light: "0 4px 16px oklch(0% 0 0 / 0.1), 0 1px 3px oklch(0% 0 0 / 0.06)", dark: "none" },
};

export const MOTION = {
  fast: 120,
  base: 180,
  slow: 280,
  standard: "cubic-bezier(0.2, 0, 0, 1)",
  exit: "cubic-bezier(0.4, 0, 1, 1)",
} as const;

export const Z = { base: 0, sticky: 10, shell: 20, popover: 30, toast: 40, overlay: 50 } as const;

// ---------------------------------------------------------------- resolve

function tinted(v: Lch | string, accent: Accent): string {
  if (typeof v === "string") return v;
  const [l, c, h] = v;
  if (c === 0) {
    const t = GRAY_TINT[accent];
    return t.c === 0 ? `oklch(${l}% 0 0)` : `oklch(${l}% ${t.c} ${t.h})`;
  }
  return `oklch(${l}% ${c} ${h})`;
}

// every color token as a css value for one theme + accent
export function colors(theme: Theme, accent: Accent = "neutral"): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, p] of Object.entries(COLOR)) out[k] = tinted(p[theme], accent);
  for (const [k, p] of Object.entries(ACCENT[accent])) out[k] = tinted(p[theme], accent);
  return out;
}

// achromatic oklch lightness (%) → srgb hex, for libraries that can't take css
// colors (maplibre paint properties accept css strings, canvas may not)
export function grayHex(lightness: number): string {
  const y = Math.max(0, Math.min(1, lightness / 100)) ** 3;
  const c = y <= 0.0031308 ? 12.92 * y : 1.055 * y ** (1 / 2.4) - 0.055;
  const v = Math.round(Math.max(0, Math.min(1, c)) * 255);
  const h = v.toString(16).padStart(2, "0");
  return `#${h}${h}${h}`;
}
