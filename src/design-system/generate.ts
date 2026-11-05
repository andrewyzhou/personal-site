import { colors, FONT, MOTION, RADIUS, SHADOW, SPACE, TYPE, WEIGHT, WIDTH, Z, HIT, type Accent, type Theme } from "./tokens";
import { BRANDS, type Brand } from "./brands";
import { CONTROL, RADII } from "./brands/types";

// tokens.ts → tokens.css. every variable is prefixed --ds- so it can't collide
// with v1's --theme-* variables, and everything is scoped under .ds so nothing
// applies outside design-system markup.

const ACCENTS: Accent[] = ["neutral", "blue", "amber", "green"];

function block(selector: string, vars: Record<string, string | number>): string {
  const body = Object.entries(vars)
    .map(([k, v]) => `  --ds-${k}: ${v};`)
    .join("\n");
  return `${selector} {\n${body}\n}`;
}

function colorVars(theme: Theme, accent: Accent): Record<string, string> {
  const out: Record<string, string> = { ...colors(theme, accent) };
  out["shadow-popover"] = SHADOW.popover[theme] as string;
  return out;
}

function staticVars(): Record<string, string | number> {
  const v: Record<string, string | number> = {
    "font-sans": FONT.sans,
    "font-display": FONT.sans,
    "font-mono": FONT.mono,
    "heading-weight": WEIGHT.semibold,
    "control-h": "2.25rem",
    "control-h-sm": "1.75rem",
    "row-pad": "0.75rem",
    hit: `${HIT}px`,
    "ease-standard": MOTION.standard,
    "ease-exit": MOTION.exit,
    "dur-fast": `${MOTION.fast}ms`,
    "dur-base": `${MOTION.base}ms`,
    "dur-slow": `${MOTION.slow}ms`,
  };
  for (const [k, [size, lh, ls]] of Object.entries(TYPE)) {
    v[`text-${k}`] = `${size / 16}rem`;
    v[`leading-${k}`] = `${lh / 16}rem`;
    v[`tracking-${k}`] = `${ls}em`;
  }
  for (const [k, w] of Object.entries(WEIGHT)) v[`weight-${k}`] = w;
  for (const [k, px] of Object.entries(SPACE)) v[`space-${k.replace(".", "_")}`] = `${px / 16}rem`;
  for (const [k, px] of Object.entries(WIDTH)) v[`width-${k}`] = `${px}px`;
  for (const [k, px] of Object.entries(RADIUS)) v[`radius-${k}`] = `${px}px`;
  for (const [k, n] of Object.entries(Z)) v[`z-${k}`] = n;
  return v;
}

// one block per brand: type, shape, density and motion as variables. the
// accent and component styles ride on data attributes set by <BrandRoot>.
function brandVars(b: Brand): Record<string, string | number> {
  const r = RADII[b.shape];
  const c = CONTROL[b.density];
  const v: Record<string, string | number> = {
    "font-sans": b.type.body,
    "font-display": b.type.display,
    "heading-weight": b.type.headingWeight,
    "radius-sm": `${r.sm}px`,
    "radius-md": `${r.md}px`,
    "radius-lg": `${r.lg}px`,
    "control-h": `${c.height / 16}rem`,
    "control-h-sm": `${c.small / 16}rem`,
    "row-pad": `${c.row / 16}rem`,
    "dur-fast": `${Math.round(MOTION.fast * b.motion)}ms`,
    "dur-base": `${Math.round(MOTION.base * b.motion)}ms`,
    "dur-slow": `${Math.round(MOTION.slow * b.motion)}ms`,
  };
  for (const k of ["2xl", "3xl", "display"] as const) {
    const [size, lh] = TYPE[k];
    v[`text-${k}`] = `${round((size * b.type.displayScale) / 16)}rem`;
    v[`leading-${k}`] = `${round((lh * b.type.displayScale) / 16)}rem`;
  }
  return v;
}

const round = (n: number) => Math.round(n * 10000) / 10000;

export function tokensCss(): string {
  const parts: string[] = [
    "/* generated from src/design-system/tokens.ts by `npm run tokens`. do not edit. */",
    block(".ds", { ...staticVars(), ...colorVars("light", "neutral") }),
  ];
  // accents (light)
  for (const a of ACCENTS.slice(1)) parts.push(block(`.ds[data-accent="${a}"]`, colorVars("light", a)));
  // dark: follows the site's theme class, or an explicit data-theme
  parts.push(block(`.theme-dark .ds, .ds[data-theme="dark"]`, colorVars("dark", "neutral")));
  for (const a of ACCENTS.slice(1))
    parts.push(block(`.theme-dark .ds[data-accent="${a}"], .ds[data-theme="dark"][data-accent="${a}"]`, colorVars("dark", a)));
  // an explicit light container inside a dark page stays light
  parts.push(block(`.theme-dark .ds[data-theme="light"]`, colorVars("light", "neutral")));
  for (const a of ACCENTS.slice(1))
    parts.push(block(`.theme-dark .ds[data-theme="light"][data-accent="${a}"]`, colorVars("light", a)));
  for (const b of Object.values(BRANDS)) parts.push(block(`.ds[data-brand="${b.id}"]`, brandVars(b)));
  parts.push(
    `@media (prefers-reduced-motion: reduce) {\n  .ds {\n    --ds-dur-fast: 0ms;\n    --ds-dur-base: 0ms;\n    --ds-dur-slow: 0ms;\n  }\n}`,
  );
  return parts.join("\n\n") + "\n";
}
