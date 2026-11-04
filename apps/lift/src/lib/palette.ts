import { oklchGrayToHex as gray, overlay } from "./color";

// same grayscale tokens as the site (src/app/globals.css). the site has no
// color accent, so the accent is the primary text color with inverted text.

export interface Palette {
  bg: string;
  card: string;
  /** body text (--theme-text) */
  text: string;
  /** emphasis text (--theme-text-primary) */
  strong: string;
  muted: string;
  border: string;
  accent: string;
  accentText: string;
  danger: string;
  done: string;
  input: string;
  /** load shading, none -> most (the site's contrib-0..4) */
  steps: readonly string[];
}

function palette(t: {
  bg: number;
  text: number;
  primary: number;
  muted: number;
  divider: number;
  card: number;
  steps: readonly number[];
  danger: string;
}): Palette {
  const bg = gray(t.bg);
  const primary = gray(t.primary);
  // overlays are flattened onto bg so nested surfaces don't stack alpha
  return {
    bg,
    card: overlay(primary, bg, t.card),
    text: gray(t.text),
    strong: primary,
    muted: gray(t.muted),
    border: gray(t.divider),
    accent: primary,
    accentText: bg,
    danger: t.danger,
    // --theme-highlight-bg-active
    done: overlay(primary, bg, 0.18),
    // --theme-highlight-bg-hover, so inputs still read on a card
    input: overlay(primary, bg, 0.15),
    steps: t.steps.map(gray),
  };
}

export const dark: Palette = palette({
  bg: 17.3,
  text: 84.5,
  primary: 94.9,
  muted: 73.8,
  divider: 30.9,
  card: 0.1,
  steps: [21.8, 38.7, 51.0, 68.3, 94.9],
  // muted red: the only hue in the app, kept quiet. light enough for 4.5:1 on done rows
  danger: "#e08c84",
});

export const light: Palette = palette({
  bg: 94.9,
  text: 32.1,
  primary: 17.3,
  // a touch darker than the site's 45 so muted text still reads on done rows
  muted: 43.0,
  divider: 85.5,
  card: 0.08,
  steps: [90.7, 75.7, 60.0, 43.1, 17.3],
  // dark enough for 4.5:1 on the input/done tints, not just the page
  danger: "#8c362f",
});
