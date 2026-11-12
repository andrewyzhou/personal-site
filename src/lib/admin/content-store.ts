// content operations for the cms: list/read/create/update/move/delete.
// published entries live in the github repo (git is their system of record,
// redis a best-effort cache). drafts live in the database and are never in
// the repo: publishing writes the file, unpublishing takes it back out. no
// operation deletes before it has written; updates and deletes are sha-guarded.

import { Redis } from "@upstash/redis";
import {
  deleteFile,
  getBlob,
  getFile,
  getTree,
  putFile,
  GitHubNotFoundError,
  type WriteResult,
} from "./github-content";
import { GitHubExistsError } from "./github-content";
import { deleteDraft, draftPath, draftSha, getDraft, insertDraft, isDraftPath, listDrafts, updateDraft } from "./draft-store";
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

// the file of a published entry. drafts have no file (see draft-store).
export function pathFor(t: ContentTypeDef, slug: string): string {
  if (t.singleton) return t.dir;
  return `${t.dir}/${slug}.${extFor(t)}`;
}

async function draftItems(t: ContentTypeDef): Promise<ContentListItem[]> {
  if (!t.hasWip) return [];
  return (await listDrafts(t.id)).map((d) => ({ slug: d.slug, status: "wip" as const, path: draftPath(t.id, d.slug), sha: d.sha, frontmatter: d.frontmatter }));
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
      return { items: [...cached, ...(await draftItems(t))], stale: true };
    }
    throw error;
  }

  const dirPrefix = `${t.dir}/`;
  const suffix = t.kind === "mdx" ? ".mdx" : ".yaml";
  const altSuffix = t.kind === "yaml" ? ".yml" : null;

  const entries = tree.filter((e) => {
    if (e.type !== "blob" || !e.path.startsWith(dirPrefix)) return false;
    const rest = e.path.slice(dirPrefix.length);
    if (rest.includes("/")) return false; // direct children only
    if (rest.toLowerCase() === "readme.md") return false;
    return rest.endsWith(suffix) || (altSuffix !== null && rest.endsWith(altSuffix));
  });

  const items: ContentListItem[] = [];
  for (const e of entries) {
    const filename = e.path.slice(dirPrefix.length);
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

    items.push({ slug, status: "published", path: e.path, sha: e.sha, frontmatter });
  }

  await cacheSet(cacheKey, items, LIST_TTL_S);
  return { items: [...items, ...(await draftItems(t))], stale: false };
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

  // published first (yaml collections may use .yml), then the draft
  const path = pathFor(t, slug);
  for (const candidate of t.kind === "yaml" ? [path, path.replace(/\.yaml$/, ".yml")] : [path]) {
    try {
      const file = await getFile(REPO, candidate);
      const { frontmatter, body } = t.parse(file.content);
      return { slug, status: "published", path: file.path, sha: file.sha, frontmatter, body, raw: file.content };
    } catch (error) {
      if (!(error instanceof GitHubNotFoundError)) throw error;
    }
  }
  if (t.hasWip) {
    const draft = await getDraft(t.id, slug);
    if (draft) {
      return { slug, status: "wip", path: draftPath(t.id, slug), sha: draft.sha, frontmatter: draft.frontmatter, body: draft.body, raw: t.serialize(draft.frontmatter, draft.body) };
    }
  }
  throw new GitHubNotFoundError(`${t.id}/${slug}`);
}

export function validateSlug(t: ContentTypeDef, slug: string): string | null {
  if (t.singleton) return null;
  return SLUG_RE.test(slug) ? null : "slug must be lowercase ascii: a-z, 0-9, dashes, underscores";
}

// a write that never touched the repo has no commit
const NO_COMMIT = { commitSha: "", commitUrl: "" };

export async function createEntry(
  t: ContentTypeDef,
  slug: string,
  frontmatter: Record<string, unknown>,
  body: string,
  wip: boolean
): Promise<WriteResult & { path: string }> {
  const content = t.serialize(frontmatter, body);
  if (wip && t.hasWip) {
    const sha = draftSha(content);
    if (!(await insertDraft({ type: t.id, slug, frontmatter, body, sha }))) throw new GitHubExistsError(`draft ${t.id}/${slug}`);
    log.info("admin:content", `created draft ${t.id}/${slug}`);
    return { blobSha: sha, ...NO_COMMIT, path: draftPath(t.id, slug) };
  }
  const path = pathFor(t, slug);
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
  if (isDraftPath(entryPath)) {
    const sha = draftSha(content);
    // same refusal as a stale file: the caller offers reload or overwrite
    if (!(await updateDraft({ type: t.id, slug: slugLabel, frontmatter, body, sha }, baseSha))) throw new GitHubExistsError(`draft ${t.id}/${slugLabel} changed`);
    log.info("admin:content", `updated draft ${t.id}/${slugLabel}`);
    return { blobSha: sha, ...NO_COMMIT };
  }
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

// publish: the draft becomes a file in the repo, then its row is removed.
// unpublish: the file's content becomes a draft, then the file is deleted.
// each direction writes the destination first, so a failure half way leaves
// the entry in both places rather than in neither.
export async function moveEntry(
  t: ContentTypeDef,
  slug: string,
  direction: "publish" | "unpublish",
  sha: string
): Promise<{ path: string; sha: string; commitSha: string; commitUrl: string }> {
  const filePath = pathFor(t, slug);
  if (direction === "publish") {
    const draft = await getDraft(t.id, slug);
    if (!draft || draft.sha !== sha) throw new GitHubNotFoundError(`draft ${t.id}/${slug}`);
    const result = await putFile(REPO, {
      path: filePath,
      content: t.serialize(draft.frontmatter, draft.body),
      message: `content: add ${t.commitNoun} ${slug}`,
    });
    await deleteDraft(t.id, slug, sha);
    await dropListCache(t.id);
    log.info("admin:content", `published ${slug} (${result.commitSha.slice(0, 7)})`);
    return { path: filePath, sha: result.blobSha, commitSha: result.commitSha, commitUrl: result.commitUrl };
  }

  const entry = await readEntry(t, slug);
  if (entry.status !== "published" || entry.sha !== sha) throw new GitHubNotFoundError(`${t.id}/${slug}`);
  const stored = { type: t.id, slug, frontmatter: entry.frontmatter, body: entry.body, sha: draftSha(t.serialize(entry.frontmatter, entry.body)) };
  if (!(await insertDraft(stored))) throw new GitHubExistsError(`draft ${t.id}/${slug}`);
  const result = await deleteFile(REPO, {
    path: entry.path,
    message: `content: remove ${t.commitNoun} ${slug}`,
    sha,
  });
  await dropListCache(t.id);
  log.info("admin:content", `unpublished ${slug} (${result.commitSha.slice(0, 7)})`);
  return { path: draftPath(t.id, slug), sha: stored.sha, ...result };
}

export async function deleteEntry(
  t: ContentTypeDef,
  entryPath: string,
  slug: string,
  sha: string
): Promise<{ commitSha: string; commitUrl: string }> {
  if (isDraftPath(entryPath)) {
    if (!(await deleteDraft(t.id, slug, sha))) throw new GitHubNotFoundError(`draft ${t.id}/${slug}`);
    log.info("admin:content", `deleted draft ${t.id}/${slug}`);
    return NO_COMMIT;
  }
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
