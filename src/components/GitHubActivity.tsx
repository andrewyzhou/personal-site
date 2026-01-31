"use client";

import { useEffect, useState, useMemo } from "react";

const MOBILE_WEEKS = 24;
const STACK_BREAKPOINT = 768;

// gradual week reduction breakpoints (widest to narrowest)
// reduces by 1 week every ~12.5px as screen gets narrower
const DESKTOP_BREAKPOINTS = [
  { minWidth: 1152, weeks: 52 },
  { minWidth: 1140, weeks: 51 },
  { minWidth: 1127, weeks: 50 },
  { minWidth: 1114, weeks: 49 },
  { minWidth: 1101, weeks: 48 },
  { minWidth: 1088, weeks: 47 },
  { minWidth: 1075, weeks: 46 },
  { minWidth: 1062, weeks: 45 },
  { minWidth: 1049, weeks: 44 },
  { minWidth: 1036, weeks: 43 },
  { minWidth: 1023, weeks: 42 },
  { minWidth: 1010, weeks: 41 },
  { minWidth: 997, weeks: 40 },
  { minWidth: 984, weeks: 39 },
  { minWidth: 971, weeks: 38 },
  { minWidth: 958, weeks: 37 },
  { minWidth: 945, weeks: 36 },
  { minWidth: 932, weeks: 35 },
  { minWidth: 919, weeks: 34 },
  { minWidth: 906, weeks: 33 },
  { minWidth: 893, weeks: 32 },
  { minWidth: 880, weeks: 31 },
  { minWidth: 867, weeks: 30 },
  { minWidth: 854, weeks: 29 },
  { minWidth: STACK_BREAKPOINT, weeks: 28 },  // 768-854 stays at 28
];

const MOBILE_BREAKPOINTS = [
  { minWidth: 755, weeks: 51 },
  { minWidth: 742, weeks: 50 },
  { minWidth: 729, weeks: 49 },
  { minWidth: 716, weeks: 48 },
  { minWidth: 703, weeks: 47 },
  { minWidth: 690, weeks: 46 },
  { minWidth: 677, weeks: 45 },
  { minWidth: 664, weeks: 44 },
  { minWidth: 651, weeks: 43 },
  { minWidth: 638, weeks: 42 },
  { minWidth: 625, weeks: 41 },
  { minWidth: 612, weeks: 40 },
  { minWidth: 599, weeks: 39 },
  { minWidth: 586, weeks: 38 },
  { minWidth: 573, weeks: 37 },
  { minWidth: 560, weeks: 36 },
  { minWidth: 547, weeks: 35 },
  { minWidth: 534, weeks: 34 },
  { minWidth: 521, weeks: 33 },
  { minWidth: 508, weeks: 32 },
  { minWidth: 495, weeks: 31 },
  { minWidth: 482, weeks: 30 },
  { minWidth: 469, weeks: 29 },
  { minWidth: 456, weeks: 28 },
  { minWidth: 443, weeks: 27 },
  { minWidth: 430, weeks: 26 },
  { minWidth: 417, weeks: 25 },
  { minWidth: 404, weeks: MOBILE_WEEKS },
];

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

interface GitHubActivityProps {
  showHeading?: boolean;
  mobileHeading?: boolean;
}

export default function GitHubActivity({ showHeading = true, mobileHeading = true }: GitHubActivityProps) {
  const [data, setData] = useState<GitHubData | null>(null);
  const [loading, setLoading] = useState(true);
  const [weeksToShow, setWeeksToShow] = useState(52);

  // detect how many weeks to show based on viewport width
  // gradually reduces weeks as screen narrows (both desktop and mobile)
  useEffect(() => {
    const updateWeeks = () => {
      const width = window.innerWidth;

      // desktop/side-by-side mode (768px and above)
      if (width >= STACK_BREAKPOINT) {
        for (const breakpoint of DESKTOP_BREAKPOINTS) {
          if (width >= breakpoint.minWidth) {
            setWeeksToShow(breakpoint.weeks);
            return;
          }
        }
        setWeeksToShow(MOBILE_WEEKS);
        return;
      }

      // mobile/stacked mode (below 768px) - starts at 52 weeks
      if (width >= 718) {
        setWeeksToShow(52);
        return;
      }
      for (const breakpoint of MOBILE_BREAKPOINTS) {
        if (width >= breakpoint.minWidth) {
          setWeeksToShow(breakpoint.weeks);
          return;
        }
      }

      // fallback to mobile weeks if narrower than all breakpoints
      setWeeksToShow(MOBILE_WEEKS);
    };
    updateWeeks();
    window.addEventListener("resize", updateWeeks);
    return () => window.removeEventListener("resize", updateWeeks);
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

  // limit weeks based on viewport - must be before early returns
  const displayWeeks = useMemo(() => {
    if (!data) return [];
    if (weeksToShow < 52) {
      return data.weeks.slice(-weeksToShow);
    }
    return data.weeks;
  }, [data, weeksToShow]);

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const month = MONTHS[date.getMonth()];
    const day = date.getDate();
    const year = date.getFullYear();
    let hours = date.getHours();
    const minutes = date.getMinutes().toString().padStart(2, "0");
    const ampm = hours >= 12 ? "pm" : "am";
    hours = hours % 12 || 12;
    return `${month} ${day}, ${year} at ${hours}:${minutes} ${ampm}`;
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
      <div>
        <div className="h-[100px] card-bg animate-pulse rounded" />
        <div className="h-4 w-64 card-bg animate-pulse rounded mt-4" />
      </div>
    );
  }

  if (!data) {
    return (
      <div>
        <div className="text-gray text-lg font-sans">
          failed to load github activity
        </div>
      </div>
    );
  }

  const monthLabels = getMonthLabels(displayWeeks);

  return (
    <div>
      {showHeading && (
        <h3 className={`font-sans font-bold text-off-white text-3xl${!mobileHeading ? ' hidden activity-stack:block' : ''}`} style={{ marginBottom: '0.5rem' }}>
          activity
        </h3>
      )}

      {/* contribution graph */}
      <div className="mb-4">
        {/* month labels */}
        <div className="relative mb-1 h-4" style={{ marginLeft: '1.75rem' }}>
            {monthLabels.map((label, i) => (
              <div
                key={i}
                className="text-gray text-xs font-sans absolute"
                style={{
                  left: `${label.weekIndex * 12}px`,
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

      {/* latest commit info */}
      {data.latestCommit && (
        <p className="font-sans text-gray text-lg" style={{ marginTop: '0.5rem' }}>
          this site was last deployed on {formatDate(data.latestCommit.date)} for commit <a href={`https://github.com/andrewyzhou/personal-site/commit/${data.latestCommit.sha}`} target="_blank" rel="noopener noreferrer" className="link-highlight">{data.latestCommit.sha}</a>
        </p>
      )}
    </div>
  );
}
