// shape of content/site.yaml. client-safe (no fs), so client components can
// import the types and receive the data through SiteProvider.

export interface SocialLinkContent {
  name: string;
  url: string;
  icon?: string;
}

export type ExperienceTab =
  | "bio"
  | "work"
  | "research"
  | "teaching"
  | "projects"
  | "library"
  | "blog"
  | "photos"
  | "coursework";

export interface HubContent {
  id: string;
  label: string;
  href: string;
  intro: string;
  sections: string[];
}

export interface SiteContent {
  hubs: HubContent[];
  site: {
    name: string;
    title: string;
    description: string;
    footer: string;
    titleSeparator: string;
    notFoundTitle: string;
  };
  nav: { home: string; blog: string; library: string; photos: string; previous: string; next: string };
  hero: {
    greeting: string;
    name: string;
    headshot: { src: string; alt: string };
    affiliation: string[];
  };
  social: SocialLinkContent[];
  theme: { switchTo: string; current: string };
  home: {
    about: string;
    activity: string;
    errors: { currently: string; calendar: string; github: string };
  };
  experience: {
    tabs: Record<ExperienceTab, string>;
    open: { library: string; blog: string; photos: string };
    seeAll: { library: string; blog: string; photos: string };
    photoCount: { one: string; other: string };
    noWriteup: string;
    sort: { semester: string; az: string };
    courseworkFootnote: string;
  };
  contact: { heading: string; body: string; email: string };
  currently: { heading: string; fetched: string; apiCalls: string };
  github: { heading: string; failed: string; deployed: string };
  pages: {
    blog: IndexPageContent & { allTags: string; noMatch: string };
    library: IndexPageContent & {
      allTags: string;
      noMatch: string;
      originalSource: string;
      inProgress: string;
      started: string;
      completed: string;
    };
    photos: IndexPageContent & { empty: string };
    activity: { metrics: ActivityMetricsContent };
    records: RecordsPageContent;
  };
}

// best effort keys (see BEST_EFFORT_DISTANCES in src/lib/metrics/compute.ts);
// site.yaml must label every one
export const BEST_EFFORT_KEYS = ["400m", "half-mile", "1k", "1mi", "2mi", "5k", "10k", "15k", "10mi", "20k", "half", "30k", "marathon"] as const;
export type BestEffortKey = (typeof BEST_EFFORT_KEYS)[number];

export interface ActivityMetricsContent {
  headline: { movingTime: string; elapsedTime: string; gradeAdjustedPace: string; effort: string };
  splits: {
    title: string;
    unitToggle: string; // aria-label of the mi / km toggle
    units: { mi: string; km: string };
    pace: string;
    speed: string;
    relative: string; // "relative {rate}"
    adjPace: string;
    adjPaceTitle: string;
    elev: string;
    hr: string;
    partial: string;
    partialTitle: string;
    stopped: string;
  };
  bestEfforts: { title: string; distance: string; time: string; pace: string; labels: Record<BestEffortKey, string> };
  curves: { power: string; powerNoun: string; speed: string; speedNoun: string; aria: string };
  climbs: { title: string; climb: string; distance: string; gain: string; grade: string; category: string; hc: string };
  zones: { title: string; heartRate: string; pace: string; zone: string };
}

export interface RecordsPageContent {
  title: string;
  section: string; // "activities", for the page title
  link: string; // link text from an activity page
  intro: string;
  empty: string;
  bestEfforts: string;
  bestSpeed: string;
  bestPower: string;
  fitness: string;
  gear: string;
  columns: {
    distance: string;
    best: string;
    pace: string;
    activity: string;
    nextBest: string;
    for: string;
    gear: string;
    activities: string;
    lastUsed: string;
  };
  unnamedActivity: string;
  gearAlert: string;
  fitnessAria: string;
  fitnessCaption: string;
  fitnessNote: string;
}

export interface IndexPageContent {
  title: string;
  metaDescription: string;
  intro: string;
}

// "{theme} mode" + { theme: "dark" } → "dark mode"
export function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

// like fill, but keeps each literal run and each value as its own piece, so
// react renders them as separate text nodes ("deployed on ", date, " for ...").
// that matches how the same sentence written inline in jsx is shaped.
export function fillParts(template: string, vars: Record<string, string | number>): string[] {
  const out: string[] = [];
  let last = 0;
  for (const m of template.matchAll(/\{(\w+)\}/g)) {
    if (!(m[1] in vars)) continue;
    if (m.index > last) out.push(template.slice(last, m.index));
    out.push(String(vars[m[1]]));
    last = m.index + m[0].length;
  }
  if (last < template.length) out.push(template.slice(last));
  return out;
}

// "photo"/"photos" by count
export function plural(n: number, forms: { one: string; other: string }): string {
  return n === 1 ? forms.one : forms.other;
}

// "blog" + "andrew zhou" → "blog · andrew zhou"
export function pageTitle(site: SiteContent, ...parts: string[]): string {
  return [...parts, site.site.name].join(site.site.titleSeparator);
}
