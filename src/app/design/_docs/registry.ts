// every page of the design docs, in sidebar order

export interface DocPage {
  slug: string;
  title: string;
  summary: string;
}

export interface DocSection {
  id: "foundations" | "components" | "patterns" | "brands";
  title: string;
  pages: DocPage[];
}

export const SECTIONS: DocSection[] = [
  {
    id: "foundations",
    title: "foundations",
    pages: [
      { slug: "principles", title: "principles", summary: "the ten rules every design decision is checked against." },
      { slug: "color", title: "color", summary: "grays, one accent, and color only where it means something. every token in light and dark." },
      { slug: "typography", title: "typography", summary: "faces, the type scale, weights, and how hierarchy is built from type instead of boxes." },
      { slug: "spacing", title: "spacing", summary: "one 4px scale for every gap, padding and margin, and which step to use where." },
      { slug: "layout", title: "layout", summary: "page widths, breakpoints, the grid, and the anatomy of every page." },
      { slug: "shape", title: "shape & elevation", summary: "corner radius by brand, borders, and the three levels of elevation." },
      { slug: "motion", title: "motion", summary: "durations, easing, what moves and what never does." },
      { slug: "iconography", title: "iconography", summary: "one icon set, drawn in the current text color." },
      { slug: "voice", title: "voice & writing", summary: "lowercase, plain, specific. how labels, empty states and errors are written." },
    ],
  },
  {
    id: "components",
    title: "components",
    pages: [
      { slug: "button", title: "button", summary: "controls that do something. primary, secondary, ghost, danger." },
      { slug: "link", title: "link", summary: "text that goes somewhere: inline, navigation, standalone." },
      { slug: "chip", title: "chip", summary: "selection only: filters, tabs, tags." },
      { slug: "breadcrumbs", title: "breadcrumbs", summary: "where you are, and one tap back up." },
      { slug: "stat", title: "stat", summary: "big number, small label." },
      { slug: "list-row", title: "list row", summary: "one entry in an index, with a hover wash instead of a card." },
      { slug: "table", title: "table", summary: "aligned numbers: splits, sets, laps." },
      { slug: "badge", title: "badge & legend", summary: "small status marks and color keys." },
      { slug: "empty-state", title: "empty state", summary: "what a section says when there's nothing in it." },
      { slug: "forms", title: "forms", summary: "field, input, textarea, select, checkbox." },
      { slug: "card", title: "card", summary: "a bordered surface for one record, form or group of settings." },
      { slug: "icon", title: "icon", summary: "monochrome svg in the current text color." },
      { slug: "map-frame", title: "map frame", summary: "the chrome around a map: frame, controls, credit, caption." },
      { slug: "page-header", title: "page header", summary: "breadcrumbs, title, meta line, actions." },
      { slug: "app-shell", title: "app shell", summary: "the persistent frame: mark, hubs, theme, footer." },
    ],
  },
  {
    id: "patterns",
    title: "patterns",
    pages: [
      { slug: "site-map", title: "site map", summary: "four hubs, what lives in each, and where every old url goes." },
      { slug: "home", title: "home", summary: "the hub of hubs: who, what now, what's new, how to reach me." },
      { slug: "hub-index", title: "hub index", summary: "a hub's front page: intro, filters, a list." },
      { slug: "activity", title: "activity", summary: "one recorded session: numbers first, then the map, then detail." },
      { slug: "lift-session", title: "lift session", summary: "a weight training session: totals, then every set." },
      { slug: "article", title: "article", summary: "a post or a note: one readable column." },
      { slug: "empty-and-error", title: "empty & error", summary: "empty sections, missing pages, failed loads." },
      { slug: "admin", title: "admin", summary: "the editing tool: sidebar frame, page anatomy, the editor, and its rules." },
    ],
  },
  {
    id: "brands",
    title: "brands",
    pages: [
      { slug: "overview", title: "how brands work", summary: "a brand is one data file. what it controls and what it never touches." },
      { slug: "compare", title: "compare", summary: "every brand side by side on the same page." },
    ],
  },
];

export function findPage(section: string, slug: string): { section: DocSection; page: DocPage } | null {
  const s = SECTIONS.find((x) => x.id === section);
  const p = s?.pages.find((x) => x.slug === slug);
  return s && p ? { section: s, page: p } : null;
}
