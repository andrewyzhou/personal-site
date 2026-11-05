import { loadYaml } from "@/lib/yaml";
import type { SiteContent } from "./site-types";

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
] as const;

function get(obj: unknown, dotted: string): unknown {
  return dotted.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), obj);
}

export function validateSite(raw: unknown): string[] {
  const errors: string[] = [];
  for (const key of REQUIRED_STRINGS) {
    if (typeof get(raw, key) !== "string") errors.push(`${key} must be a string`);
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
