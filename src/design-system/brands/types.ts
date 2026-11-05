import type { Accent } from "../tokens";

// a brand is everything that makes the site look like itself, as data: color,
// type, shape, density, motion, the shell, and how components are drawn.
// brands share one set of markup and one content source, so switching brand
// changes only css variables and a few data attributes on the root.
export interface Brand {
  id: string;
  name: string;
  tagline: string;
  description: string;

  // color: one accent family (tokens.ts ACCENT) and the gray tint that goes with it
  accent: Accent;

  type: {
    // css font-family stacks. only faces loaded in the root layout (next/font)
    // are available: --font-funnel (Funnel Sans), --font-garamond (EB Garamond)
    display: string;
    body: string;
    // weight for headings and big numbers
    headingWeight: 500 | 600 | 700;
    // multiplies the 2xl / 3xl / display steps (body sizes never scale)
    displayScale: number;
    // the size a page title uses
    pageTitle: "2xl" | "3xl";
  };

  // corner radius family
  shape: "sharp" | "soft" | "round";

  // control heights and list row padding
  density: "compact" | "comfortable";

  // motion speed multiplier (1 = the token durations)
  motion: number;

  // the persistent frame: floating pill, sticky top bar, or left rail
  shell: "pill" | "topbar" | "rail";

  components: {
    // chips: hairline outline, or a soft filled wash
    chip: "outline" | "filled";
    // links inside running text: underline, or the soft highlight box from v1
    inlineLink: "underline" | "highlight";
    // stat rows: plain columns, or columns split by hairlines
    stats: "plain" | "divided";
  };
}

export const RADII: Record<Brand["shape"], { sm: number; md: number; lg: number }> = {
  sharp: { sm: 2, md: 4, lg: 6 },
  soft: { sm: 4, md: 8, lg: 12 },
  round: { sm: 6, md: 12, lg: 20 },
};

export const CONTROL: Record<Brand["density"], { height: number; small: number; row: number }> = {
  compact: { height: 32, small: 26, row: 8 },
  comfortable: { height: 38, small: 30, row: 12 },
};
