import { requireAdmin } from "@/lib/admin-auth";
import { ok, fail, mapError } from "@/lib/admin/api-envelope";
import { putFile, GitHubExistsError } from "@/lib/admin/github-content";
import { syncSubmissions, readStoredSubmissions } from "@/lib/leetcode-sync";
import { log } from "@/lib/log";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const LANGUAGE_EXT: Record<string, string> = {
  python: "py", java: "java", cpp: "cpp", c: "c",
  javascript: "js", typescript: "ts", go: "go", rust: "rs", sql: "sql",
};

// message must satisfy parseCommitMessage in src/lib/leetcode.ts
const COMMIT_MESSAGE_RE = /^(\d+)\.\s+(.+?)\s+\((Easy|Medium|Hard)\)/i;

function kebab(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// matches the repo's existing layout: 0001-two-sum.py at root
export function defaultPath(number: number, title: string, language: string): string {
  const ext = LANGUAGE_EXT[language] ?? "txt";
  return `${String(number).padStart(4, "0")}-${kebab(title)}.${ext}`;
}

interface Body {
  number?: number;
  title?: string;
  difficulty?: string;
  language?: string;
  code?: string;
  path?: string;
}

export async function POST(request: Request) {
  const denied = await requireAdmin(request);
  if (denied) return denied;

  let body: Body;
  try {
    body = await request.json();
  } catch {
    return fail("validation", "invalid json body", 400);
  }

  const number = Number(body.number);
  const title = (body.title ?? "").trim();
  const difficulty = body.difficulty ?? "";
  const code = body.code ?? "";
  const language = body.language ?? "python";

  if (!Number.isInteger(number) || number < 1) return fail("validation", "problem number must be a positive integer", 400);
  if (!title) return fail("validation", "title is required", 400);
  if (!["Easy", "Medium", "Hard"].includes(difficulty)) return fail("validation", "difficulty must be Easy, Medium, or Hard", 400);
  if (!code.trim()) return fail("validation", "solution code is required", 400);

  let path = (body.path ?? defaultPath(number, title, language)).trim();
  if (path.startsWith("/") || path.includes("..")) return fail("validation", "invalid path", 400);

  const message = `${number}. ${title} (${difficulty})`;
  // belt-and-suspenders: a hostile title must not produce an unparseable commit
  if (!COMMIT_MESSAGE_RE.test(message)) {
    return fail("validation", "title produces an unparseable commit message — simplify it", 400);
  }

  try {
    let result;
    try {
      result = await putFile("leetcode", { path, content: code, message });
    } catch (error) {
      if (error instanceof GitHubExistsError) {
        // path taken: retry once with a -2 suffix before the extension
        const retried = path.replace(/(\.[a-z0-9]+)$/i, "-2$1");
        try {
          result = await putFile("leetcode", { path: retried, content: code, message });
          path = retried;
        } catch (retryError) {
          if (retryError instanceof GitHubExistsError) {
            return fail("exists", "a file already exists at this path", 409, { path });
          }
          throw retryError;
        }
      } else {
        throw error;
      }
    }

    // best-effort refresh of the public store; the GET route self-heals anyway
    let synced = false;
    try {
      const stored = await readStoredSubmissions();
      const updated = await syncSubmissions(stored);
      synced = updated !== stored;
    } catch (error) {
      log.warn("admin:leetcode", "post-commit sync failed", error);
    }

    log.info("admin:leetcode", `committed ${path} (${result.commitSha.slice(0, 7)})`);
    return ok({ commitSha: result.commitSha, commitUrl: result.commitUrl, path, synced }, 201);
  } catch (error) {
    log.error("admin:leetcode", "commit failed", error);
    return mapError(error);
  }
}
