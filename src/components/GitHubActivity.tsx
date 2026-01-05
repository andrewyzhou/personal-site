"use client";

import { useEffect, useState, useMemo } from "react";

const MOBILE_WEEKS = 24; 

interface ContributionDay {
  date: string;
  count: number;
  level: 0 | 1 | 2 | 3 | 4;
}

interface ContributionWeek {
  days: ContributionDay[];
}

interface CommitInfo {
  sha: string;
  date: string;
}

interface GitHubData {
  weeks: ContributionWeek[];
  totalContributions: number;
  latestCommit: CommitInfo | null;
}

const DAYS = ["", "mon", "", "wed", "", "fri", ""];
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

export default function GitHubActivity() {
  const [data, setData] = useState<GitHubData | null>(null);
  const [loading, setLoading] = useState(true);
  const [isMobile, setIsMobile] = useState(false);

  // detect mobile screen size
  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  useEffect(() => {
    async function fetchData() {
      try {
        const response = await fetch("/api/github");
        if (response.ok) {
          const result = await response.json();
          setData(result);
        }
      } catch (error) {
        console.error("failed to fetch github data:", error);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, []);

  // limit weeks on mobile - must be before early returns
  const displayWeeks = useMemo(() => {
    if (!data) return [];
    if (isMobile) {
      return data.weeks.slice(-MOBILE_WEEKS);
    }
    return data.weeks;
  }, [data, isMobile]);

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const month = (date.getMonth() + 1).toString().padStart(2, "0");
    const day = date.getDate().toString().padStart(2, "0");
    const year = date.getFullYear();
    const hours = date.getHours().toString().padStart(2, "0");
    const minutes = date.getMinutes().toString().padStart(2, "0");
    const seconds = date.getSeconds().toString().padStart(2, "0");
    // get timezone abbreviation
    const tzAbbr = date.toLocaleTimeString('en-US', { timeZoneName: 'short' }).split(' ').pop();
    return `${month}/${day}/${year}, ${hours}:${minutes}:${seconds} ${tzAbbr}`;
  };

  // get month labels for the graph - use the first day of each week that starts a new month
  const getMonthLabels = (weeks: ContributionWeek[]) => {
    const labels: { month: string; weekIndex: number }[] = [];
    let lastMonth = -1;

    weeks.forEach((week, weekIndex) => {
      // skip weeks with no days
      if (week.days.length === 0) return;

      // check if any day in this week starts a new month
      for (const day of week.days) {
        const date = new Date(day.date + 'T00:00:00'); // ensure consistent date parsing
        const month = date.getMonth();
        const dayOfMonth = date.getDate();

        // if this is day 1-7 and we haven't already marked this month
        if (dayOfMonth <= 7 && month !== lastMonth) {
          labels.push({ month: MONTHS[month], weekIndex });
          lastMonth = month;
          break;
        }
      }
    });

    return labels;
  };

  if (loading) {
    return (
      <section className="py-16">
        <div className="h-[100px] card-bg animate-pulse rounded" />
        <div className="h-4 w-64 card-bg animate-pulse rounded mt-4" />
      </section>
    );
  }

  if (!data) {
    return (
      <section className="py-16">
        <div className="text-gray text-lg font-serif">
          failed to load github activity
        </div>
      </section>
    );
  }

  const monthLabels = getMonthLabels(displayWeeks);

  return (
    <section className="py-16">
      <h3 className="font-sans font-bold text-off-white text-3xl" style={{ marginBottom: '0.5rem' }}>
        activity
      </h3>
      {/* contribution graph */}
      <div className="mb-4">
        {/* month labels */}
        <div className="relative mb-1 h-4" style={{ marginLeft: '1.75rem' }}>
          {monthLabels.map((label, i) => (
            <div
              key={i}
              className="text-gray text-xs font-sans absolute"
              style={{
                left: `${label.weekIndex * 12}px`, // 10px square + 2px gap = 12px per week, +36px offset (3 blocks)
              }}
            >
              {label.month}
            </div>
          ))}
        </div>

        <div className="flex">
          {/* day labels */}
          <div className="flex flex-col justify-between text-xs text-gray font-sans py-[2px]" style={{ marginRight: '0.2rem' }}>
            {DAYS.map((day, i) => (
              <div key={i} className="h-[10px] leading-[10px]">
                {day}
              </div>
            ))}
          </div>

          {/* graph grid */}
          <div className="flex gap-[2px]">
            {displayWeeks.map((week, weekIndex) => (
              <div key={weekIndex} className="flex flex-col gap-[2px]">
                {week.days.map((day, dayIndex) => (
                  <div
                    key={dayIndex}
                    className={`w-[10px] h-[10px] rounded-[2px] contrib-${day.level}`}
                    title={`${day.date}: ${day.count} contributions`}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* latest commit info - below the graph */}
      {data.latestCommit && (
        <p className="font-sans text-gray text-lg" style={{ marginTop: '0.5rem' }}>
          this site was last deployed on {formatDate(data.latestCommit.date)} for commit {data.latestCommit.sha}
        </p>
      )}
    </section>
  );
}
