// single source of truth for every content type the cms can touch. formats
// must match the existing loaders exactly (src/lib/blog.ts, library.ts,
// photos.ts, items.ts, content.ts).

import { parseMdx, parseYamlFile, serializeMdx, serializeYamlFile } from "./frontmatter";

export type ContentTypeId =
  | "blog" | "library" | "photos"
  | "work" | "research" | "teaching" | "projects"
  | "bio" | "sections" | "coursework" | "hero-quotes";

export interface ContentTypeDef {
  id: ContentTypeId;
  label: string;
  kind: "mdx" | "yaml";
  singleton: boolean;
  dir: string; // collection dir, or exact file path for singletons
  hasWip: boolean;
  commitNoun: string;
  keyOrder: string[];
  validate(frontmatter: Record<string, unknown>, body: string): string[];
  serialize(frontmatter: Record<string, unknown>, body: string): string;
  parse(raw: string): { frontmatter: Record<string, unknown>; body: string };
}

export const SLUG_RE = /^[a-z0-9][a-z0-9-_]*$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const LIBRARY_TYPES = ["book", "video", "podcast", "course", "article"];
const SECTION_KEYS = ["work", "research", "teaching", "projects", "library", "blog", "photos", "coursework"];

const str = (v: unknown): v is string => typeof v === "string" && v.length > 0;
const optStr = (v: unknown) => v === undefined || typeof v === "string";
const optDate = (v: unknown) => v === undefined || (typeof v === "string" && DATE_RE.test(v));
const isRec = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function mdxType(def: Omit<ContentTypeDef, "kind" | "serialize" | "parse">): ContentTypeDef {
  return {
    ...def,
    kind: "mdx",
    serialize: (fm, body) => serializeMdx(fm, body, def.keyOrder),
    parse: parseMdx,
  };
}

function yamlType(def: Omit<ContentTypeDef, "kind" | "serialize" | "parse">): ContentTypeDef {
  return {
    ...def,
    kind: "yaml",
    serialize: (fm) => serializeYamlFile(def.singleton && "value" in fm ? fm.value : fm, def.keyOrder),
    parse: parseYamlFile,
  };
}

function experienceType(id: ContentTypeId): ContentTypeDef {
  return mdxType({
    id,
    label: `${id} item`,
    singleton: false,
    dir: `content/${id}`,
    hasWip: false,
    commitNoun: `${id} item`,
    keyOrder: ["order", "title", "company", "companyUrl", "location", "period", "year"],
    validate: (fm) => {
      const errors: string[] = [];
      if (typeof fm.order !== "number") errors.push("order must be a number");
      if (!str(fm.title)) errors.push("title is required");
      if (!str(fm.company)) errors.push("company is required");
      if (!str(fm.year)) errors.push("year is required (as text, e.g. \"2026\")");
      if (!optStr(fm.companyUrl) || !optStr(fm.location) || !optStr(fm.period)) errors.push("optional fields must be text");
      return errors;
    },
  });
}

export const CONTENT_TYPES: Record<ContentTypeId, ContentTypeDef> = {
  blog: mdxType({
    id: "blog",
    label: "blog post",
    singleton: false,
    dir: "content/blog",
    hasWip: true,
    commitNoun: "blog post",
    keyOrder: ["title", "date", "summary", "tags", "cover", "pinned"],
    validate: (fm) => {
      const errors: string[] = [];
      if (!str(fm.title)) errors.push("title is required");
      if (!str(fm.date) || !DATE_RE.test(fm.date as string)) errors.push("date must be yyyy-mm-dd");
      if (!str(fm.summary)) errors.push("summary is required");
      if (!Array.isArray(fm.tags)) errors.push("tags must be a list (may be empty)");
      if (!optStr(fm.cover)) errors.push("cover must be a path or url");
      return errors;
    },
  }),

  library: mdxType({
    id: "library",
    label: "library entry",
    singleton: false,
    dir: "content/library",
    hasWip: true,
    commitNoun: "library entry",
    keyOrder: ["title", "creator", "type", "sourceUrl", "cover", "dateStarted", "dateCompleted", "rating", "tags", "summary"],
    validate: (fm) => {
      const errors: string[] = [];
      if (!str(fm.title)) errors.push("title is required");
      if (!str(fm.creator)) errors.push("creator is required");
      if (!optStr(fm.cover)) errors.push("cover must be a path or url");
      if (!LIBRARY_TYPES.includes(fm.type as string)) errors.push(`type must be one of ${LIBRARY_TYPES.join(", ")}`);
      if (!optDate(fm.dateStarted) || !optDate(fm.dateCompleted)) errors.push("dates must be yyyy-mm-dd");
      if (fm.rating !== undefined && (typeof fm.rating !== "number" || fm.rating < 0 || fm.rating > 5))
        errors.push("rating must be 0–5");
      if (!Array.isArray(fm.tags)) errors.push("tags must be a list (may be empty)");
      if (!str(fm.summary)) errors.push("summary is required");
      return errors;
    },
  }),

  photos: yamlType({
    id: "photos",
    label: "photo essay",
    singleton: false,
    dir: "content/photos",
    hasWip: true,
    commitNoun: "photo essay",
    keyOrder: ["format", "title", "date", "caption", "cover", "photos", "blocks"],
    validate: (fm) => {
      const errors: string[] = [];
      if (!str(fm.title)) errors.push("title is required");
      if (!str(fm.date) || !DATE_RE.test(fm.date as string)) errors.push("date must be yyyy-mm-dd");
      if (fm.format === "blocks") {
        if (!Array.isArray(fm.blocks) || fm.blocks.length === 0) errors.push("blocks list is required for the block format");
      } else {
        if (!str(fm.caption)) errors.push("caption is required");
        if (!str(fm.cover)) errors.push("cover filename is required");
        if (!Array.isArray(fm.photos) || fm.photos.length === 0) errors.push("photos list is required");
      }
      return errors;
    },
  }),

  work: experienceType("work"),
  research: experienceType("research"),
  teaching: experienceType("teaching"),
  projects: experienceType("projects"),

  bio: mdxType({
    id: "bio",
    label: "bio",
    singleton: true,
    dir: "content/bio.mdx",
    hasWip: false,
    commitNoun: "bio",
    keyOrder: [],
    validate: (_fm, body) => (body.trim().length > 0 ? [] : ["bio cannot be empty"]),
  }),

  sections: yamlType({
    id: "sections",
    label: "section blurbs",
    singleton: true,
    dir: "content/sections.yaml",
    hasWip: false,
    commitNoun: "sections",
    keyOrder: SECTION_KEYS,
    validate: (fm) => {
      const data = ("value" in fm ? fm.value : fm) as Record<string, unknown>;
      if (!isRec(data)) return ["sections must be a key → text map"];
      const bad = SECTION_KEYS.filter((k) => data[k] !== undefined && data[k] !== null && typeof data[k] !== "string");
      return bad.length > 0 ? [`values must be text: ${bad.join(", ")}`] : [];
    },
  }),

  coursework: yamlType({
    id: "coursework",
    label: "coursework",
    singleton: true,
    dir: "content/coursework.yaml",
    hasWip: false,
    commitNoun: "coursework",
    keyOrder: [],
    validate: (fm) => {
      const data = "value" in fm ? fm.value : fm;
      if (!Array.isArray(data)) return ["coursework must be a list of semesters"];
      const errors: string[] = [];
      data.forEach((s, i) => {
        if (!isRec(s) || !str(s.name)) errors.push(`semester ${i + 1} needs a name`);
        if (!isRec(s) || !Array.isArray(s.courses)) errors.push(`semester ${i + 1} needs a courses list`);
        else (s.courses as unknown[]).forEach((c, j) => {
          if (!isRec(c) || !str(c.code) || !str(c.title)) errors.push(`semester ${i + 1} course ${j + 1} needs code + title`);
        });
      });
      return errors;
    },
  }),

  "hero-quotes": yamlType({
    id: "hero-quotes",
    label: "hero quotes",
    singleton: true,
    dir: "content/hero-quotes.yaml",
    hasWip: false,
    commitNoun: "hero quotes",
    keyOrder: [],
    validate: (fm) => {
      const data = "value" in fm ? fm.value : fm;
      if (!Array.isArray(data)) return ["hero quotes must be a list"];
      const bad = (data as unknown[]).filter((q) => !isRec(q) || !str(q.text) || !str(q.attribution));
      return bad.length > 0 ? ["every quote needs text + attribution"] : [];
    },
  }),
};

export function getContentType(id: string): ContentTypeDef | null {
  return (CONTENT_TYPES as Record<string, ContentTypeDef>)[id] ?? null;
}

export const COLLECTION_TYPES = Object.values(CONTENT_TYPES).filter((t) => !t.singleton);
export const SINGLETON_TYPES = Object.values(CONTENT_TYPES).filter((t) => t.singleton);
