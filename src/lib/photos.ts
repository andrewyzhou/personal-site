import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import { imageSize } from "image-size";
import { log } from "./log";

export interface Photo {
  src: string; // public url: /photos/<slug>/file.jpg or https://cdn.andrewzhou.org/…
  width: number;
  height: number;
  alt: string;
}

// ---------------------------------------------------------------------------
// classic flat photoset (v1 — unchanged format, files in public/photos/<slug>/)

export interface PhotosetFrontmatter {
  title: string;
  date: string; // ISO yyyy-mm-dd
  caption: string;
  cover: string; // filename inside public/photos/<slug>/
  photos: string[]; // ordered filenames
}

export interface Photoset {
  kind: "flat";
  slug: string;
  title: string;
  date: string;
  caption: string;
  cover: Photo;
  photos: Photo[];
  photoCount: number;
}

// ---------------------------------------------------------------------------
// photo essay (v2 — `format: blocks`): ordered blocks of image | gallery | text.
// image captions render below the frame; optional exif/gps feed the sidebar.

export interface PhotoExif {
  camera?: string;
  lens?: string;
  aperture?: string; // "f/5.6"
  shutter?: string; // "1/250s"
  iso?: number;
  focalLength?: string; // "23mm"
}

export interface EssayImage extends Photo {
  caption?: string;
  text?: string; // optional paragraph under the caption
  exif?: PhotoExif;
  gps?: { lat: number; lon: number }; // rounded before publish (public repo)
  takenAt?: string;
}

export type EssayBlock =
  | { kind: "text"; body: string }
  | { kind: "image"; image: EssayImage }
  | { kind: "gallery"; caption?: string; images: EssayImage[] };

export interface PhotoEssay {
  kind: "essay";
  slug: string;
  title: string;
  date: string;
  caption: string;
  cover: Photo;
  blocks: EssayBlock[];
  photoCount: number;
}

export type PhotosEntry = Photoset | PhotoEssay;

// ---------------------------------------------------------------------------

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

// remote images must live on our own hosts — prevents accidental hotlinking and
// keeps next.config remotePatterns narrow
function isAllowedRemote(src: string): boolean {
  try {
    const host = new URL(src).hostname;
    const own = process.env.R2_PUBLIC_BASE_URL ? new URL(process.env.R2_PUBLIC_BASE_URL).hostname : null;
    return host === own || host.endsWith(".public.blob.vercel-storage.com") || host === "cdn.andrewzhou.org";
  } catch {
    return false;
  }
}

interface RawEssayImage {
  src?: string;
  width?: number;
  height?: number;
  alt?: string;
  caption?: string;
  text?: string;
  exif?: PhotoExif;
  gps?: { lat?: number; lon?: number };
  takenAt?: string;
}

function resolveEssayImage(slug: string, raw: RawEssayImage): EssayImage | null {
  if (!raw?.src || typeof raw.src !== "string") {
    log.warn("photos", `skipping image block without src in ${slug}`);
    return null;
  }
  let base: Photo;
  if (raw.src.startsWith("https://")) {
    if (!isAllowedRemote(raw.src)) {
      log.warn("photos", `disallowed image host in ${slug}: ${raw.src}`);
      return null;
    }
    if (!raw.width || !raw.height) {
      log.warn("photos", `remote src missing dimensions in ${slug}: ${raw.src}`);
      return null;
    }
    base = { src: raw.src, width: raw.width, height: raw.height, alt: raw.alt ?? slug };
  } else {
    // bare filename or /photos/<slug>/ path → local file, measured on disk
    const file = raw.src.replace(new RegExp(`^/photos/${slug}/`), "");
    try {
      base = { ...readPhoto(slug, file), alt: raw.alt ?? `${slug} ${file}` };
    } catch (error) {
      log.warn("photos", `unreadable local image in ${slug}: ${raw.src}`, error);
      return null;
    }
  }
  const gps =
    raw.gps && typeof raw.gps.lat === "number" && typeof raw.gps.lon === "number"
      ? { lat: raw.gps.lat, lon: raw.gps.lon }
      : undefined;
  return {
    ...base,
    caption: raw.caption,
    text: raw.text,
    exif: raw.exif,
    gps,
    takenAt: raw.takenAt,
  };
}

interface RawEssay {
  format?: string;
  title?: string;
  date?: unknown;
  caption?: string;
  cover?: string | RawEssayImage;
  blocks?: unknown[];
  photos?: unknown;
}

function buildEssay(slug: string, raw: RawEssay): PhotoEssay | null {
  const blocks: EssayBlock[] = [];
  for (const b of raw.blocks ?? []) {
    const block = b as Record<string, unknown>;
    if (block.kind === "text" && typeof block.body === "string" && block.body.trim()) {
      blocks.push({ kind: "text", body: block.body });
    } else if (block.kind === "image") {
      const image = resolveEssayImage(slug, block as RawEssayImage);
      if (image) blocks.push({ kind: "image", image });
    } else if (block.kind === "gallery" && Array.isArray(block.images)) {
      const images = (block.images as RawEssayImage[])
        .map((i) => resolveEssayImage(slug, i))
        .filter((i): i is EssayImage => i !== null);
      if (images.length > 0) {
        blocks.push({ kind: "gallery", caption: block.caption as string | undefined, images });
      } else {
        log.warn("photos", `dropping empty gallery in ${slug}`);
      }
    } else {
      log.warn("photos", `skipping invalid block in ${slug}`);
    }
  }
  if (blocks.length === 0) {
    log.warn("photos", `essay ${slug} has no valid blocks — skipping entry`);
    return null;
  }

  // cover: explicit (string filename or remote object), else first image block
  let cover: Photo | null = null;
  if (typeof raw.cover === "string" && raw.cover) {
    try {
      cover = readPhoto(slug, raw.cover);
    } catch {
      cover = null;
    }
  } else if (raw.cover && typeof raw.cover === "object") {
    cover = resolveEssayImage(slug, raw.cover as RawEssayImage);
  }
  if (!cover) {
    const firstImage = blocks.find((b): b is Extract<EssayBlock, { kind: "image" }> => b.kind === "image");
    const firstGallery = blocks.find((b): b is Extract<EssayBlock, { kind: "gallery" }> => b.kind === "gallery");
    cover = firstImage?.image ?? firstGallery?.images[0] ?? null;
  }
  if (!cover) return null;

  const photoCount = blocks.reduce(
    (n, b) => n + (b.kind === "image" ? 1 : b.kind === "gallery" ? b.images.length : 0),
    0
  );

  return {
    kind: "essay",
    slug,
    title: raw.title ?? slug,
    date: toISODate(raw.date),
    caption: raw.caption ?? "",
    cover,
    blocks,
    photoCount,
  };
}

function buildPhotoset(slug: string, raw: PhotosetFrontmatter): Photoset {
  const photos = raw.photos.map((f) => readPhoto(slug, f));
  const cover = readPhoto(slug, raw.cover);
  return {
    kind: "flat",
    slug,
    title: raw.title,
    date: toISODate(raw.date),
    caption: raw.caption,
    cover,
    photos,
    photoCount: photos.length,
  };
}

function buildEntry(slug: string, data: RawEssay | PhotosetFrontmatter): PhotosEntry | null {
  if ((data as RawEssay).format === "blocks" || Array.isArray((data as RawEssay).blocks)) {
    return buildEssay(slug, data as RawEssay);
  }
  return buildPhotoset(slug, data as PhotosetFrontmatter);
}

export function getAllPhotosets(): PhotosEntry[] {
  if (!fs.existsSync(CONTENT_DIR)) return [];

  const dirents = fs
    .readdirSync(CONTENT_DIR, { withFileTypes: true })
    .filter((d) => d.isFile() && (d.name.endsWith(".yaml") || d.name.endsWith(".yml")));

  const sets: PhotosEntry[] = [];
  for (const d of dirents) {
    const slug = d.name.replace(/\.ya?ml$/, "");
    if (!isValidSlug(slug)) {
      console.warn(
        `[photos] skipping ${d.name}: filename must match /^[a-z0-9][a-z0-9-_]*$/ (lowercase ascii, no spaces/dots)`
      );
      continue;
    }
    // per-file isolation: one corrupt yaml or missing image never kills the build
    try {
      const raw = fs.readFileSync(path.join(CONTENT_DIR, d.name), "utf8");
      const data = yaml.load(raw) as RawEssay | PhotosetFrontmatter;
      if (!data) continue;
      const entry = buildEntry(slug, data);
      if (entry) sets.push(entry);
    } catch (error) {
      log.warn("photos", `skipping unreadable entry ${d.name}`, error);
    }
  }

  // newest first
  return sets.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
}

export function getPhotosetBySlug(slug: string): PhotosEntry | null {
  if (!isValidSlug(slug)) return null;
  const yamlFile = path.join(CONTENT_DIR, `${slug}.yaml`);
  const ymlFile = path.join(CONTENT_DIR, `${slug}.yml`);
  const file = fs.existsSync(yamlFile) ? yamlFile : fs.existsSync(ymlFile) ? ymlFile : null;
  if (!file) return null;
  if (path.dirname(file) !== CONTENT_DIR) return null;
  try {
    const raw = fs.readFileSync(file, "utf8");
    const data = yaml.load(raw) as RawEssay | PhotosetFrontmatter;
    if (!data) return null;
    return buildEntry(slug, data);
  } catch (error) {
    log.warn("photos", `unreadable entry ${slug}`, error);
    return null;
  }
}

export function getAdjacentPhotosets(slug: string): {
  prev: PhotosEntry | null;
  next: PhotosEntry | null;
} {
  const sets = getAllPhotosets();
  const idx = sets.findIndex((s) => s.slug === slug);
  if (idx === -1) return { prev: null, next: null };
  return {
    prev: idx > 0 ? sets[idx - 1] : null,
    next: idx < sets.length - 1 ? sets[idx + 1] : null,
  };
}
