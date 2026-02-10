const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const REPO_OWNER = "andrewyzhou";
const REPO_NAME = "leetcode";

const COMMITS_ENDPOINT = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/commits`;

export type Difficulty = "easy" | "medium" | "hard";

export interface LeetCodeSubmission {
  sha: string;
  date: string; // YYYY-MM-DD
  problemNumber: number;
  problemTitle: string;
  difficulty: Difficulty;
  commitMessage: string;
  url: string;
}

export interface StoredSubmissions {
  submissions: LeetCodeSubmission[];
  lastFetchedAt: number | null;
}

// parse commit message in format: "42. Two Sum (Easy)"
function parseCommitMessage(message: string): {
  problemNumber: number;
  problemTitle: string;
  difficulty: Difficulty;
} | null {
  // match pattern: "123. Problem Title (Easy/Medium/Hard)"
  const match = message.match(/^(\d+)\.\s+(.+?)\s+\((Easy|Medium|Hard)\)/i);
  if (!match) return null;

  return {
    problemNumber: parseInt(match[1], 10),
    problemTitle: match[2].trim(),
    difficulty: match[3].toLowerCase() as Difficulty,
  };
}

// fetch all commits with pagination, optionally after a date
export async function getAllSubmissions(since?: string): Promise<LeetCodeSubmission[]> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github.v3+json",
    "User-Agent": "personal-site",
  };

  if (GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${GITHUB_TOKEN}`;
  }

  const allSubmissions: LeetCodeSubmission[] = [];
  let page = 1;
  const perPage = 100;

  try {
    while (true) {
      const params = new URLSearchParams({
        per_page: perPage.toString(),
        page: page.toString(),
      });
      if (since) {
        params.set("since", since);
      }

      const response = await fetch(`${COMMITS_ENDPOINT}?${params.toString()}`, {
        headers,
      });

      if (!response.ok) {
        if (response.status === 404) {
          console.error("LeetCode repo not found or not accessible");
          return [];
        }
        throw new Error(`GitHub API error: ${response.status}`);
      }

      const commits = await response.json();
      if (commits.length === 0) {
        break;
      }

      for (const commit of commits) {
        const message = commit.commit.message.split("\n")[0]; // first line only
        const parsed = parseCommitMessage(message);

        if (parsed) {
          // convert commit date to local YYYY-MM-DD
          const commitDate = new Date(commit.commit.author.date);
          const localDate = commitDate.toLocaleDateString("en-CA"); // YYYY-MM-DD format

          allSubmissions.push({
            sha: commit.sha,
            date: localDate,
            problemNumber: parsed.problemNumber,
            problemTitle: parsed.problemTitle,
            difficulty: parsed.difficulty,
            commitMessage: message,
            url: commit.html_url,
          });
        }
      }

      if (commits.length < perPage) {
        break;
      }
      page++;
    }

    return allSubmissions;
  } catch (error) {
    console.error("GitHub API error fetching leetcode submissions:", error);
    return [];
  }
}

// fetch the latest commit SHA (single API call)
export async function getLatestCommitSha(): Promise<string | null> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github.v3+json",
    "User-Agent": "personal-site",
  };

  if (GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${GITHUB_TOKEN}`;
  }

  try {
    const response = await fetch(`${COMMITS_ENDPOINT}?per_page=1`, { headers });
    if (!response.ok) return null;
    const commits = await response.json();
    return commits.length > 0 ? commits[0].sha : null;
  } catch {
    return null;
  }
}

// get difficulty color for display (uses CSS variable for theme support)
export function getDifficultyColor(): string {
  return "var(--theme-text-primary)";
}

// get difficulty letter
export function getDifficultyLetter(difficulty: Difficulty): string {
  switch (difficulty) {
    case "easy":
      return "E";
    case "medium":
      return "M";
    case "hard":
      return "H";
  }
}
