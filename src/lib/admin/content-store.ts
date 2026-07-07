// content operations for the cms: list/read/create/update/move/delete against
// the github repo, with redis as a best-effort cache. git is the system of
// record; no operation deletes-before-write; updates and deletes are sha-guarded.

import { Redis } from "@upstash/redis";
import {
  deleteFile,
  getBlob,
  getFile,
  getTree,
  moveFile,
  putFile,
  GitHubNotFoundError,
  type WriteResult,
} from "./github-content";
import { getContentType, SLUG_RE, type ContentTypeDef } from "./content-registry";
import { log } from "@/lib/log";

const REPO = "personal-site" as const;

const redis = new Redis({
  url: process.env.KV_REST_API_URL || "",
  token: process.env.KV_REST_API_TOKEN || "",
});

export interface ContentListItem {
  slug: string;
  status: "published" | "wip";
  path: string;
  sha: string;
  frontmatter: Record<string, unknown>;
}

const LIST_TTL_S = 60;
const FM_TTL_S = 30 * 24 * 3600;

async function cacheGet<T>(key: string): Promise<T | null> {
  try {
    return await redis.get<T>(key);
  } catch {
    return null;
  }
}

async function cacheSet(key: string, value: unknown, ttlS: number): Promise<void> {
  try {
    await redis.set(key, value, { ex: ttlS });
  } catch {
    // cache only — never fail the operation
  }
}

export async function dropListCache(typeId: string): Promise<void> {
  try {
    await redis.del(`cms:list:${typeId}`);
  } catch {
    // best-effort
  }
}

const extFor = (t: ContentTypeDef) => (t.kind === "mdx" ? "mdx" : "yaml");

export function pathFor(t: ContentTypeDef, slug: string, wip: boolean): string {
  if (t.singleton) return t.dir;
  return `${t.dir}${wip ? "/wip" : ""}/${slug}.${extFor(t)}`;
}

export async function listEntries(
  t: ContentTypeDef
): Promise<{ items: ContentListItem[]; stale: boolean }> {
  const cacheKey = `cms:list:${t.id}`;

  let tree;
  try {
    tree = await getTree(REPO);
  } catch (error) {
    const cached = await cacheGet<ContentListItem[]>(cacheKey);
    if (cached) {
      log.warn("admin:content", `github list failed for ${t.id}, serving cached`, error);
      return { items: cached, stale: true };
    }
    throw error;
  }

  const dirPrefix = `${t.dir}/`;
  const wipPrefix = `${t.dir}/wip/`;
  const suffix = t.kind === "mdx" ? ".mdx" : ".yaml";
  const altSuffix = t.kind === "yaml" ? ".yml" : null;

  const entries = tree.filter((e) => {
    if (e.type !== "blob" || !e.path.startsWith(dirPrefix)) return false;
    const isWip = e.path.startsWith(wipPrefix);
    const rest = e.path.slice(isWip ? wipPrefix.length : dirPrefix.length);
    if (rest.includes("/")) return false; // deeper nesting excluded
    if (rest.toLowerCase() === "readme.md") return false;
    return rest.endsWith(suffix) || (altSuffix !== null && rest.endsWith(altSuffix));
  });

  const items: ContentListItem[] = [];
  for (const e of entries) {
    const isWip = e.path.startsWith(wipPrefix);
    const filename = e.path.slice(isWip ? wipPrefix.length : dirPrefix.length);
    const slug = filename.replace(/\.(mdx|ya?ml)$/, "");

    let frontmatter = await cacheGet<Record<string, unknown>>(`cms:fm:${e.sha}`);
    if (!frontmatter) {
      try {
        const raw = await getBlob(REPO, e.sha);
        frontmatter = t.parse(raw).frontmatter;
        await cacheSet(`cms:fm:${e.sha}`, frontmatter, FM_TTL_S);
      } catch (error) {
        log.warn("admin:content", `frontmatter hydration failed for ${e.path}`, error);
        frontmatter = {};
      }
    }

    items.push({ slug, status: isWip ? "wip" : "published", path: e.path, sha: e.sha, frontmatter });
  }

  await cacheSet(cacheKey, items, LIST_TTL_S);
  return { items, stale: false };
}

export interface ContentEntry {
  slug: string;
  status: "published" | "wip";
  path: string;
  sha: string;
  frontmatter: Record<string, unknown>;
  body: string;
  raw: string;
}

export async function readEntry(t: ContentTypeDef, slug: string): Promise<ContentEntry> {
  if (t.singleton) {
    const file = await getFile(REPO, t.dir);
    const { frontmatter, body } = t.parse(file.content);
    return { slug: t.id, status: "published", path: file.path, sha: file.sha, frontmatter, body, raw: file.content };
  }

  // published first, then wip
  for (const wip of [false, true]) {
    if (wip && !t.hasWip) break;
    try {
      const path = pathFor(t, slug, wip);
      const file = await getFile(REPO, path);
      const { frontmatter, body } = t.parse(file.content);
      return { slug, status: wip ? "wip" : "published", path: file.path, sha: file.sha, frontmatter, body, raw: file.content };
    } catch (error) {
      if (!(error instanceof GitHubNotFoundError)) throw error;
    }
  }
  // yaml collections may use .yml
  if (t.kind === "yaml") {
    for (const wip of [false, true]) {
      if (wip && !t.hasWip) break;
      try {
        const path = pathFor(t, slug, wip).replace(/\.yaml$/, ".yml");
        const file = await getFile(REPO, path);
        const { frontmatter, body } = t.parse(file.content);
        return { slug, status: wip ? "wip" : "published", path: file.path, sha: file.sha, frontmatter, body, raw: file.content };
      } catch (error) {
        if (!(error instanceof GitHubNotFoundError)) throw error;
      }
    }
  }
  throw new GitHubNotFoundError(`${t.id}/${slug}`);
}

export function validateSlug(t: ContentTypeDef, slug: string): string | null {
  if (t.singleton) return null;
  return SLUG_RE.test(slug) ? null : "slug must be lowercase ascii: a-z, 0-9, dashes, underscores";
}

export async function createEntry(
  t: ContentTypeDef,
  slug: string,
  frontmatter: Record<string, unknown>,
  body: string,
  wip: boolean
): Promise<WriteResult & { path: string }> {
  const path = pathFor(t, slug, wip && t.hasWip);
  const content = t.serialize(frontmatter, body);
  const result = await putFile(REPO, {
    path,
    content,
    message: `content: add ${t.commitNoun} ${slug}`,
  });
  await dropListCache(t.id);
  log.info("admin:content", `created ${path} (${result.commitSha.slice(0, 7)})`);
  return { ...result, path };
}

export async function updateEntry(
  t: ContentTypeDef,
  entryPath: string,
  slugLabel: string,
  frontmatter: Record<string, unknown>,
  body: string,
  baseSha: string
): Promise<WriteResult> {
  const content = t.serialize(frontmatter, body);
  const result = await putFile(REPO, {
    path: entryPath,
    content,
    message: `content: edit ${t.commitNoun}${t.singleton ? "" : ` ${slugLabel}`}`,
    sha: baseSha,
  });
  await dropListCache(t.id);
  log.info("admin:content", `updated ${entryPath} (${result.commitSha.slice(0, 7)})`);
  return result;
}

export async function moveEntry(
  t: ContentTypeDef,
  slug: string,
  direction: "publish" | "unpublish",
  blobSha: string
): Promise<{ path: string; commitSha: string; commitUrl: string }> {
  const fromPath = pathFor(t, slug, direction === "publish");
  const toPath = pathFor(t, slug, direction === "unpublish");
  const result = await moveFile(REPO, {
    fromPath,
    toPath,
    blobSha,
    message: `content: ${direction} ${t.commitNoun} ${slug}`,
  });
  await dropListCache(t.id);
  log.info("admin:content", `${direction}ed ${slug} (${result.commitSha.slice(0, 7)})`);
  return { path: toPath, ...result };
}

export async function deleteEntry(
  t: ContentTypeDef,
  entryPath: string,
  slug: string,
  sha: string
): Promise<{ commitSha: string; commitUrl: string }> {
  const result = await deleteFile(REPO, {
    path: entryPath,
    message: `content: delete ${t.commitNoun} ${slug}`,
    sha,
  });
  await dropListCache(t.id);
  log.info("admin:content", `deleted ${entryPath} (${result.commitSha.slice(0, 7)})`);
  return result;
}

export { getContentType };
