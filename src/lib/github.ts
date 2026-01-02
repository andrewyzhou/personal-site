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

export async function getContributions(username: string): Promise<GitHubContributions> {
  const query = `
    query($username: String!) {
      user(login: $username) {
        contributionsCollection {
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
      variables: { username },
    }),
    next: { revalidate: 3600 }, // cache for 1 hour
  });

  if (!response.ok) {
    throw new Error("failed to fetch github contributions");
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
    }
  );

  if (!response.ok) {
    throw new Error("failed to fetch latest commit");
  }

  const commits = await response.json();
  const commit = commits[0];

  return {
    sha: commit.sha.substring(0, 7),
    date: commit.commit.author.date,
    message: commit.commit.message,
  };
}
