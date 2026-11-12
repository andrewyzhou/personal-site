import type { Brand } from "./types";

export type { Brand } from "./types";

const FUNNEL = 'var(--font-funnel), "Funnel Sans", ui-sans-serif, system-ui, sans-serif';
const GARAMOND = 'var(--font-garamond), "EB Garamond", ui-serif, Georgia, serif';

// the chosen direction for v2 (owner, 2026-11-04)
export const B: Brand = {
  id: "b",
  name: "editorial",
  tagline: "big type, quiet frame",
  description:
    "a floating pill nav, large display titles and hero numbers, generous space. warm amber marks the route and records. keeps the soft highlight on inline links that the first site was known for.",
  accent: "amber",
  type: { display: FUNNEL, body: FUNNEL, headingWeight: 600, displayScale: 1.1, pageTitle: "3xl" },
  shape: "round",
  density: "comfortable",
  motion: 1,
  shell: "pill",
  components: { chip: "filled", inlineLink: "highlight", stats: "plain" },
};

export const A: Brand = {
  id: "a",
  name: "workspace",
  tagline: "a calm app with a sidebar",
  description: "a left rail with the sections, tight type and compact rows, a muted blue route. the most app-like of the three.",
  accent: "blue",
  type: { display: FUNNEL, body: FUNNEL, headingWeight: 600, displayScale: 0.9, pageTitle: "2xl" },
  shape: "soft",
  density: "compact",
  motion: 0.9,
  shell: "rail",
  components: { chip: "outline", inlineLink: "underline", stats: "divided" },
};

export const C: Brand = {
  id: "c",
  name: "classic",
  tagline: "today's site, organized",
  description: "a sticky top bar and breadcrumbs, neutral grays, a green route. the closest evolution of the first site.",
  accent: "green",
  type: { display: FUNNEL, body: FUNNEL, headingWeight: 700, displayScale: 1, pageTitle: "2xl" },
  shape: "soft",
  density: "comfortable",
  motion: 1,
  shell: "topbar",
  components: { chip: "outline", inlineLink: "underline", stats: "plain" },
};

// a brand that exists only to show the system can carry a different voice:
// a serif display face, sharp corners, no accent hue
export const D: Brand = {
  id: "d",
  name: "journal",
  tagline: "serif, sharp, monochrome",
  description: "an experiment: garamond display type, square corners, pure grays with ink as the accent. here to prove brands are just data.",
  accent: "neutral",
  type: { display: GARAMOND, body: FUNNEL, headingWeight: 500, displayScale: 1.15, pageTitle: "3xl" },
  shape: "sharp",
  density: "comfortable",
  motion: 0.8,
  shell: "topbar",
  components: { chip: "outline", inlineLink: "underline", stats: "divided" },
};

// admin: the editing tool, not a public theme. a standard dashboard look that
// never changes with the site's theme: system ui font, neutral grays, a blue
// accent for actions and focus, compact controls, underlined links (no
// highlight boxes), hairline-bordered surfaces and a left sidebar.
const SYSTEM_UI = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
export const ADMIN: Brand = {
  id: "admin",
  name: "admin",
  tagline: "the editing tool",
  description:
    "the admin dashboard and editors: a plain, dense tool ui that stays the same whatever the public theme is. system font, neutral grays, blue for actions and focus, compact controls, a left sidebar on wide screens and a menu bar on phones.",
  accent: "blue",
  type: { display: SYSTEM_UI, body: SYSTEM_UI, headingWeight: 600, displayScale: 0.9, pageTitle: "2xl", bodyText: { size: 14, leading: 1.5 } },
  shape: "soft",
  density: "compact",
  motion: 0.8,
  shell: "rail",
  components: { chip: "outline", inlineLink: "underline", stats: "divided" },
};

export const BRANDS: Record<string, Brand> = { b: B, a: A, c: C, d: D, admin: ADMIN };
export const DEFAULT_BRAND = "b";

export function getBrand(id: string | undefined): Brand | null {
  return (id && BRANDS[id]) || null;
}
