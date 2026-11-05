import { colors, FONT, MOTION, RADIUS, SHADOW, SPACE, TYPE, WEIGHT, WIDTH, Z, HIT, type Accent, type Theme } from "./tokens";

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
    "font-mono": FONT.mono,
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
  parts.push(
    `@media (prefers-reduced-motion: reduce) {\n  .ds {\n    --ds-dur-fast: 0ms;\n    --ds-dur-base: 0ms;\n    --ds-dur-slow: 0ms;\n  }\n}`,
  );
  return parts.join("\n\n") + "\n";
}
