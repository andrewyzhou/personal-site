export interface ContributionDay {
  date: string;
  count: number;
  level: 0 | 1 | 2 | 3 | 4;
}

export interface ContributionWeek {
  days: ContributionDay[];
}

export interface GitHubContributions {
  weeks: ContributionWeek[];
  totalContributions: number;
}

// the last year of contributions, or one calendar year when `year` is given
export async function getContributions(username: string, year?: number): Promise<GitHubContributions> {
  const query = `
    query($username: String!, $from: DateTime, $to: DateTime) {
      user(login: $username) {
        contributionsCollection(from: $from, to: $to) {
          contributionCalendar {
            totalContributions
            weeks {
              contributionDays {
                date
                contributionCount
                contributionLevel
              }
            }
          }
        }
      }
    }
  `;

  const response = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query,
      variables: year ? { username, from: `${year}-01-01T00:00:00Z`, to: `${year}-12-31T23:59:59Z` } : { username },
    }),
    next: { revalidate: 300 }, // cache for 5 minutes
    signal: AbortSignal.timeout(10000),
  });

  if (!response.ok) {
    throw new Error(`failed to fetch github contributions: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  const calendar = data.data.user.contributionsCollection.contributionCalendar;

  const levelMap: Record<string, 0 | 1 | 2 | 3 | 4> = {
    NONE: 0,
    FIRST_QUARTILE: 1,
    SECOND_QUARTILE: 2,
    THIRD_QUARTILE: 3,
    FOURTH_QUARTILE: 4,
  };

  return {
    totalContributions: calendar.totalContributions,
    weeks: calendar.weeks.map((week: { contributionDays: Array<{ date: string; contributionCount: number; contributionLevel: string }> }) => ({
      days: week.contributionDays.map((day) => ({
        date: day.date,
        count: day.contributionCount,
        level: levelMap[day.contributionLevel] as 0 | 1 | 2 | 3 | 4,
      })),
    })),
  };
}

export interface CommitInfo {
  sha: string;
  date: string;
  message: string;
}

export async function getLatestCommit(
  owner: string,
  repo: string
): Promise<CommitInfo> {
  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/commits?per_page=1`,
    {
      headers: process.env.GITHUB_TOKEN
        ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` }
        : {},
      next: { revalidate: 300 }, // cache for 5 minutes
      signal: AbortSignal.timeout(10000),
    }
  );

  if (!response.ok) {
    throw new Error(`failed to fetch latest commit: ${response.status} ${response.statusText}`);
  }

  const commits = await response.json();
  const commit = commits[0];

  return {
    sha: commit.sha.substring(0, 7),
    date: commit.commit.author.date,
    message: commit.commit.message,
  };
}
