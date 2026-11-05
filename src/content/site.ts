import { loadYaml } from "@/lib/yaml";
import { BEST_EFFORT_KEYS, type SiteContent } from "./site-types";

export * from "./site-types";

// every leaf the site renders. kept as a list so a missing or misspelled key
// in content/site.yaml fails the build instead of rendering "undefined".
const REQUIRED_STRINGS = [
  "site.name",
  "site.title",
  "site.description",
  "site.footer",
  "site.titleSeparator",
  "site.notFoundTitle",
  "nav.home",
  "nav.blog",
  "nav.library",
  "nav.photos",
  "nav.previous",
  "nav.next",
  "hero.greeting",
  "hero.name",
  "hero.headshot.src",
  "hero.headshot.alt",
  "theme.switchTo",
  "theme.current",
  "home.about",
  "home.activity",
  "home.errors.currently",
  "home.errors.calendar",
  "home.errors.github",
  "experience.tabs.bio",
  "experience.tabs.work",
  "experience.tabs.research",
  "experience.tabs.teaching",
  "experience.tabs.projects",
  "experience.tabs.library",
  "experience.tabs.blog",
  "experience.tabs.photos",
  "experience.tabs.coursework",
  "experience.open.library",
  "experience.open.blog",
  "experience.open.photos",
  "experience.seeAll.library",
  "experience.seeAll.blog",
  "experience.seeAll.photos",
  "experience.photoCount.one",
  "experience.photoCount.other",
  "experience.noWriteup",
  "experience.sort.semester",
  "experience.sort.az",
  "experience.courseworkFootnote",
  "contact.heading",
  "contact.body",
  "contact.email",
  "currently.heading",
  "currently.fetched",
  "currently.apiCalls",
  "github.heading",
  "github.failed",
  "github.deployed",
  "pages.blog.title",
  "pages.blog.metaDescription",
  "pages.blog.intro",
  "pages.blog.allTags",
  "pages.blog.noMatch",
  "pages.library.title",
  "pages.library.metaDescription",
  "pages.library.intro",
  "pages.library.allTags",
  "pages.library.noMatch",
  "pages.library.originalSource",
  "pages.library.inProgress",
  "pages.library.started",
  "pages.library.completed",
  "pages.photos.title",
  "pages.photos.metaDescription",
  "pages.photos.intro",
  "pages.photos.empty",
  "pages.activity.metrics.headline.movingTime",
  "pages.activity.metrics.headline.elapsedTime",
  "pages.activity.metrics.headline.gradeAdjustedPace",
  "pages.activity.metrics.headline.effort",
  "pages.activity.metrics.splits.title",
  "pages.activity.metrics.splits.unitToggle",
  "pages.activity.metrics.splits.units.mi",
  "pages.activity.metrics.splits.units.km",
  "pages.activity.metrics.splits.pace",
  "pages.activity.metrics.splits.speed",
  "pages.activity.metrics.splits.relative",
  "pages.activity.metrics.splits.adjPace",
  "pages.activity.metrics.splits.adjPaceTitle",
  "pages.activity.metrics.splits.elev",
  "pages.activity.metrics.splits.hr",
  "pages.activity.metrics.splits.partial",
  "pages.activity.metrics.splits.partialTitle",
  "pages.activity.metrics.splits.stopped",
  "pages.activity.metrics.bestEfforts.title",
  "pages.activity.metrics.bestEfforts.distance",
  "pages.activity.metrics.bestEfforts.time",
  "pages.activity.metrics.bestEfforts.pace",
  "pages.activity.metrics.curves.power",
  "pages.activity.metrics.curves.powerNoun",
  "pages.activity.metrics.curves.speed",
  "pages.activity.metrics.curves.speedNoun",
  "pages.activity.metrics.curves.aria",
  "pages.activity.metrics.climbs.title",
  "pages.activity.metrics.climbs.climb",
  "pages.activity.metrics.climbs.distance",
  "pages.activity.metrics.climbs.gain",
  "pages.activity.metrics.climbs.grade",
  "pages.activity.metrics.climbs.category",
  "pages.activity.metrics.climbs.hc",
  "pages.activity.metrics.zones.title",
  "pages.activity.metrics.zones.heartRate",
  "pages.activity.metrics.zones.pace",
  "pages.activity.metrics.zones.zone",
  "pages.records.title",
  "pages.records.section",
  "pages.records.link",
  "pages.records.intro",
  "pages.records.empty",
  "pages.records.bestEfforts",
  "pages.records.bestSpeed",
  "pages.records.bestPower",
  "pages.records.fitness",
  "pages.records.gear",
  "pages.records.columns.distance",
  "pages.records.columns.best",
  "pages.records.columns.pace",
  "pages.records.columns.activity",
  "pages.records.columns.nextBest",
  "pages.records.columns.for",
  "pages.records.columns.gear",
  "pages.records.columns.activities",
  "pages.records.columns.lastUsed",
  "pages.records.unnamedActivity",
  "pages.records.gearAlert",
  "pages.records.fitnessAria",
  "pages.records.fitnessCaption",
  "pages.records.fitnessNote",
] as const;

function get(obj: unknown, dotted: string): unknown {
  return dotted.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), obj);
}

export function validateSite(raw: unknown): string[] {
  const errors: string[] = [];
  for (const key of REQUIRED_STRINGS) {
    if (typeof get(raw, key) !== "string") errors.push(`${key} must be a string`);
  }
  // best effort labels are a map keyed by effort key: every key needs a label
  for (const k of BEST_EFFORT_KEYS) {
    const labels = get(raw, "pages.activity.metrics.bestEfforts.labels");
    const v = labels && typeof labels === "object" ? (labels as Record<string, unknown>)[k] : undefined;
    if (typeof v !== "string") errors.push(`pages.activity.metrics.bestEfforts.labels.${k} must be a string`);
  }
  const aff = get(raw, "hero.affiliation");
  if (!Array.isArray(aff) || !aff.every((s) => typeof s === "string")) errors.push("hero.affiliation must be a list of strings");
  const hubs = get(raw, "hubs");
  if (!Array.isArray(hubs) || hubs.length === 0) errors.push("hubs must be a non-empty list");
  else
    hubs.forEach((h, i) => {
      for (const k of ["id", "label", "href", "intro"]) if (!h || typeof h[k] !== "string") errors.push(`hubs[${i}].${k} must be a string`);
      if (!h || !Array.isArray(h.sections)) errors.push(`hubs[${i}].sections must be a list`);
    });
  const social = get(raw, "social");
  if (!Array.isArray(social)) errors.push("social must be a list");
  else
    social.forEach((s, i) => {
      if (!s || typeof s.name !== "string" || typeof s.url !== "string") errors.push(`social[${i}] needs name and url`);
      if (s && s.icon !== undefined && typeof s.icon !== "string") errors.push(`social[${i}].icon must be a string`);
    });
  return errors;
}

let cached: SiteContent | null = null;

// content/site.yaml, validated. read once per server process.
export function getSite(): SiteContent {
  if (cached && process.env.NODE_ENV === "production") return cached;
  const raw = loadYaml<unknown>("site.yaml");
  const errors = validateSite(raw);
  if (errors.length) throw new Error(`content/site.yaml is invalid:\n- ${errors.join("\n- ")}`);
  cached = raw as SiteContent;
  return cached;
}
