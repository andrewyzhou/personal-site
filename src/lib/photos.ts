import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import { imageSize } from "image-size";

export interface Photo {
  src: string; // public url, e.g. /photos/spring-2026/cover.jpg
  width: number;
  height: number;
  alt: string;
}

export interface PhotosetFrontmatter {
  title: string;
  date: string; // ISO yyyy-mm-dd
  caption: string;
  cover: string; // filename inside public/photos/<slug>/
  photos: string[]; // ordered filenames inside public/photos/<slug>/
}

export interface Photoset {
  slug: string;
  title: string;
  date: string;
  caption: string;
  cover: Photo;
  photos: Photo[];
}

const CONTENT_DIR = path.join(process.cwd(), "content/photos");
const PUBLIC_DIR = path.join(process.cwd(), "public/photos");

// same convention as library/blog: subfolders of content/photos/ are not
// traversed. drafts live in content/photos/wip/ and are published by moving
// the yaml file up one level.
function isValidSlug(slug: string): boolean {
  return /^[a-z0-9][a-z0-9-_]*$/.test(slug);
}

function toISODate(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "string") return value;
  return "";
}

function readPhoto(slug: string, file: string): Photo {
  const abs = path.join(PUBLIC_DIR, slug, file);
  const dim = imageSize(fs.readFileSync(abs));
  return {
    src: `/photos/${slug}/${file}`,
    width: dim.width ?? 0,
    height: dim.height ?? 0,
    alt: `${slug} ${file}`,
  };
}

function buildPhotoset(slug: string, raw: PhotosetFrontmatter): Photoset {
  const photos = raw.photos.map((f) => readPhoto(slug, f));
  const cover = readPhoto(slug, raw.cover);
  return {
    slug,
    title: raw.title,
    date: toISODate(raw.date),
    caption: raw.caption,
    cover,
    photos,
  };
}

export function getAllPhotosets(): Photoset[] {
  if (!fs.existsSync(CONTENT_DIR)) return [];

  const dirents = fs
    .readdirSync(CONTENT_DIR, { withFileTypes: true })
    .filter((d) => d.isFile() && (d.name.endsWith(".yaml") || d.name.endsWith(".yml")));

  const sets: Photoset[] = [];
  for (const d of dirents) {
    const slug = d.name.replace(/\.ya?ml$/, "");
    if (!isValidSlug(slug)) {
      console.warn(
        `[photos] skipping ${d.name}: filename must match /^[a-z0-9][a-z0-9-_]*$/ (lowercase ascii, no spaces/dots)`
      );
      continue;
    }
    const raw = fs.readFileSync(path.join(CONTENT_DIR, d.name), "utf8");
    const data = yaml.load(raw) as PhotosetFrontmatter;
    if (!data) continue;
    sets.push(buildPhotoset(slug, data));
  }

  // newest first
  return sets.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
}

export function getPhotosetBySlug(slug: string): Photoset | null {
  if (!isValidSlug(slug)) return null;
  const yamlFile = path.join(CONTENT_DIR, `${slug}.yaml`);
  const ymlFile = path.join(CONTENT_DIR, `${slug}.yml`);
  const file = fs.existsSync(yamlFile) ? yamlFile : fs.existsSync(ymlFile) ? ymlFile : null;
  if (!file) return null;
  if (path.dirname(file) !== CONTENT_DIR) return null;
  const raw = fs.readFileSync(file, "utf8");
  const data = yaml.load(raw) as PhotosetFrontmatter;
  if (!data) return null;
  return buildPhotoset(slug, data);
}

export function getAdjacentPhotosets(slug: string): {
  prev: Photoset | null;
  next: Photoset | null;
} {
  const sets = getAllPhotosets();
  const idx = sets.findIndex((s) => s.slug === slug);
  if (idx === -1) return { prev: null, next: null };
  return {
    prev: idx > 0 ? sets[idx - 1] : null,
    next: idx < sets.length - 1 ? sets[idx + 1] : null,
  };
}
