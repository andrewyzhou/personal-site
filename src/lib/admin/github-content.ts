// github contents client for the cms. raw fetch (matching src/lib/github.ts
// style — no octokit), typed errors, sha-guarded writes, atomic single-commit
// moves via the git data api. all writes go through the fine-grained
// GITHUB_CONTENT_TOKEN scoped to exactly the two repos.

import { log } from "@/lib/log";

const API = "https://api.github.com";
const OWNER = "andrewyzhou";
const BRANCH = "main";
const TIMEOUT_MS = 10000;

export type ContentRepo = "personal-site" | "leetcode";

export class GitHubConflictError extends Error {}
export class GitHubNotFoundError extends Error {}
export class GitHubExistsError extends Error {}
export class GitHubRateLimitError extends Error {}
export class GitHubUnavailableError extends Error {}

function token(): string {
  const t = process.env.GITHUB_CONTENT_TOKEN;
  if (!t) throw new GitHubUnavailableError("GITHUB_CONTENT_TOKEN is not set");
  return t;
}

async function gh(path: string, init?: RequestInit): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(`${API}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token()}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(init?.headers ?? {}),
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    log.error("github:content", `network failure on ${path}`, error);
    throw new GitHubUnavailableError("github unreachable");
  }

  if (res.ok) return res;

  const body = await res.text();
  if (res.status === 401) {
    log.error("github:content", "auth failed — token expired?");
    throw new GitHubUnavailableError("github auth failed — token expired?");
  }
  if (res.status === 404) throw new GitHubNotFoundError(`not found: ${path}`);
  if (res.status === 409) throw new GitHubConflictError(`conflict: ${path}`);
  if (res.status === 422 && body.includes("sha")) {
    // contents api reports both stale-sha updates and create-on-existing as 422
    throw new GitHubExistsError(`exists or sha mismatch: ${path}`);
  }
  if (res.status === 403 || res.status === 429) {
    log.warn("github:content", `rate limited on ${path}`);
    throw new GitHubRateLimitError("github rate limited");
  }
  log.error("github:content", `${res.status} on ${path}: ${body.slice(0, 200)}`);
  throw new GitHubUnavailableError(`github error ${res.status}`);
}

export interface RepoFile {
  path: string;
  sha: string;
  content: string; // decoded utf-8
}

export async function getFile(repo: ContentRepo, path: string): Promise<RepoFile> {
  const res = await gh(`/repos/${OWNER}/${repo}/contents/${encodePath(path)}?ref=${BRANCH}`);
  const data = await res.json();
  if (Array.isArray(data)) throw new GitHubNotFoundError(`${path} is a directory`);
  return {
    path: data.path,
    sha: data.sha,
    content: Buffer.from(data.content ?? "", "base64").toString("utf8"),
  };
}

export async function getBlob(repo: ContentRepo, blobSha: string): Promise<string> {
  const res = await gh(`/repos/${OWNER}/${repo}/git/blobs/${blobSha}`);
  const data = await res.json();
  return Buffer.from(data.content ?? "", "base64").toString("utf8");
}

export interface TreeEntry {
  path: string;
  sha: string;
  type: "blob" | "tree";
  size?: number;
}

export async function getTree(repo: ContentRepo): Promise<TreeEntry[]> {
  const res = await gh(`/repos/${OWNER}/${repo}/git/trees/${BRANCH}?recursive=1`);
  const data = await res.json();
  return (data.tree ?? []) as TreeEntry[];
}

export interface WriteResult {
  blobSha: string;
  commitSha: string;
  commitUrl: string;
}

export async function putFile(
  repo: ContentRepo,
  opts: { path: string; content: string; message: string; sha?: string }
): Promise<WriteResult> {
  const res = await gh(`/repos/${OWNER}/${repo}/contents/${encodePath(opts.path)}`, {
    method: "PUT",
    body: JSON.stringify({
      message: opts.message,
      content: Buffer.from(opts.content, "utf8").toString("base64"),
      branch: BRANCH,
      ...(opts.sha ? { sha: opts.sha } : {}),
    }),
  });
  const data = await res.json();
  return {
    blobSha: data.content.sha,
    commitSha: data.commit.sha,
    commitUrl: data.commit.html_url,
  };
}

export async function deleteFile(
  repo: ContentRepo,
  opts: { path: string; message: string; sha: string }
): Promise<{ commitSha: string; commitUrl: string }> {
  const res = await gh(`/repos/${OWNER}/${repo}/contents/${encodePath(opts.path)}`, {
    method: "DELETE",
    body: JSON.stringify({ message: opts.message, sha: opts.sha, branch: BRANCH }),
  });
  const data = await res.json();
  return { commitSha: data.commit.sha, commitUrl: data.commit.html_url };
}

// atomic move (publish/unpublish): one commit via the git data api. retries the
// ref update once on a non-fast-forward race, then surfaces a conflict.
export async function moveFile(
  repo: ContentRepo,
  opts: { fromPath: string; toPath: string; blobSha: string; message: string }
): Promise<{ commitSha: string; commitUrl: string }> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const refRes = await gh(`/repos/${OWNER}/${repo}/git/ref/heads/${BRANCH}`);
    const headSha = (await refRes.json()).object.sha as string;
    const commitRes = await gh(`/repos/${OWNER}/${repo}/git/commits/${headSha}`);
    const baseTree = (await commitRes.json()).tree.sha as string;

    const treeRes = await gh(`/repos/${OWNER}/${repo}/git/trees`, {
      method: "POST",
      body: JSON.stringify({
        base_tree: baseTree,
        tree: [
          { path: opts.toPath, mode: "100644", type: "blob", sha: opts.blobSha },
          { path: opts.fromPath, mode: "100644", type: "blob", sha: null },
        ],
      }),
    });
    const newTree = (await treeRes.json()).sha as string;

    const newCommitRes = await gh(`/repos/${OWNER}/${repo}/git/commits`, {
      method: "POST",
      body: JSON.stringify({ message: opts.message, tree: newTree, parents: [headSha] }),
    });
    const newCommit = await newCommitRes.json();

    try {
      await gh(`/repos/${OWNER}/${repo}/git/refs/heads/${BRANCH}`, {
        method: "PATCH",
        body: JSON.stringify({ sha: newCommit.sha, force: false }),
      });
      return { commitSha: newCommit.sha, commitUrl: newCommit.html_url };
    } catch (error) {
      if (attempt === 0 && error instanceof GitHubUnavailableError) {
        continue; // ref moved under us — retry the whole sequence once
      }
      throw new GitHubConflictError("branch moved during the operation");
    }
  }
  throw new GitHubConflictError("branch moved during the operation");
}

export interface DeployState {
  state: "unknown" | "pending" | "in_progress" | "success" | "failure" | "error";
  targetUrl: string | null;
}

export async function getDeploymentState(sha: string): Promise<DeployState> {
  try {
    const depRes = await gh(`/repos/${OWNER}/personal-site/deployments?sha=${sha}&per_page=1`);
    const deployments = await depRes.json();
    if (!Array.isArray(deployments) || deployments.length === 0) {
      return { state: "unknown", targetUrl: null };
    }
    const statusRes = await gh(
      `/repos/${OWNER}/personal-site/deployments/${deployments[0].id}/statuses?per_page=1`
    );
    const statuses = await statusRes.json();
    if (!Array.isArray(statuses) || statuses.length === 0) {
      return { state: "pending", targetUrl: null };
    }
    const s = statuses[0];
    const state = ["pending", "in_progress", "success", "failure", "error"].includes(s.state)
      ? s.state
      : "unknown";
    return { state, targetUrl: s.environment_url || s.target_url || null };
  } catch {
    return { state: "unknown", targetUrl: null };
  }
}

function encodePath(p: string): string {
  return p.split("/").map(encodeURIComponent).join("/");
}
