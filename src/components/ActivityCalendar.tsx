"use client";

import { useEffect, useState, useMemo, useRef, useCallback } from "react";
import Image from "next/image";
import { LeetCodeSubmission, StoredSubmissions, getDifficultyColor, getDifficultyLetter } from "@/lib/leetcode";
import RouteThumb from "@/components/RouteThumb";
import {
  FAMILIES,
  SPORT_TYPE_KEYS,
  sportMetric,
  sportNoun,
  sportTypeIcon,
  typesInFamily,
  typesWithMetric,
  type SportFamily,
} from "@/lib/sport-types";

// ============================================================================
// SHARED TYPES & CONSTANTS
// ============================================================================

type CalendarMode = "activities" | "leetcode";

const MONTHS = ["january", "february", "march", "april", "may", "june",
                "july", "august", "september", "october", "november", "december"];
const DAYS = ["s", "m", "t", "w", "t", "f", "s"];

// ============================================================================
// ACTIVITY TYPES & HELPERS
// ============================================================================

interface CalendarActivity {
  id: number;
  name: string;
  type: string;
  date: string;
  startTime: string;
  distance: number;
  duration: number;
  elapsedTime: number;
  totalElevationGain: number;
  averageSpeed: number;
  maxSpeed: number;
  averageHeartrate: number | null;
  maxHeartrate: number | null;
  averageCadence: number | null;
  averageWatts: number | null;
  maxWatts: number | null;
  kilojoules: number | null;
  description: string | null;
  sufferScore: number | null;
  href?: string; // own page (lift-only workouts); no preview fetch
  liftSummary?: string; // "3 exercises · 6 sets" on lift-only workouts
}

// lift-only workouts without a watch recording have no duration; "0 min" would be wrong
function liftMetric(activity: CalendarActivity): string | null {
  if (!activity.href || activity.duration > 0) return null;
  return activity.liftSummary || "lift";
}

interface StoredActivities {
  activities: CalendarActivity[];
  lastFetchedAt: number | null;
}

// lift-only workouts arrive beside the list; appended so activities[0] stays the latest recording
function withLifts(result: StoredActivities & { lifts?: CalendarActivity[] }): StoredActivities {
  return { ...result, activities: [...(result.activities ?? []), ...(result.lifts ?? [])] };
}

// every type's icon, noun and stat style comes from the sport-type table
const DURATION_TYPES: readonly string[] = typesWithMetric("duration");
const PACE_TYPES: readonly string[] = typesInFamily("run");
const SPEED_TYPES: readonly string[] = typesInFamily("ride");
const DISTANCE_TYPES: readonly string[] = SPORT_TYPE_KEYS.filter((k) => sportMetric(k) !== "duration");

function getIconForType(type: string): string {
  return sportTypeIcon(type);
}

function getActivityName(type: string): string {
  return sportNoun(type);
}

function formatDistance(meters: number): string {
  return `${(meters / 1609.344).toFixed(1)} mi`;
}

function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours > 0 ? `${hours} hr ${minutes} min` : `${minutes} min`;
}

function formatPace(metersPerSecond: number): string {
  if (metersPerSecond <= 0) return "--:--";
  const secondsPerMile = 1609.344 / metersPerSecond;
  const minutes = Math.floor(secondsPerMile / 60);
  const seconds = Math.round(secondsPerMile % 60);
  return `${minutes}:${seconds.toString().padStart(2, "0")}/mi`;
}

function formatSpeed(metersPerSecond: number): string {
  if (metersPerSecond <= 0) return "0 mph";
  return `${(metersPerSecond * 2.23694).toFixed(1)} mph`;
}

function formatElevation(meters: number): string {
  return `${Math.round(meters * 3.28084)} ft`;
}

function formatTimeOfDay(time24: string): string {
  const [hours, minutes] = time24.split(":").map(Number);
  const period = hours >= 12 ? "pm" : "am";
  const hours12 = hours % 12 || 12;
  return `${hours12}:${minutes.toString().padStart(2, "0")} ${period}`;
}

// ============================================================================
// ACTIVITY VIEW STATE
// ============================================================================

type ActivityViewState =
  | { type: "calendar" }
  | { type: "selector"; date: string; activities: CalendarActivity[] }
  | { type: "detail"; activity: CalendarActivity };

// ============================================================================
// LEETCODE VIEW STATE
// ============================================================================

type LeetCodeViewState =
  | { type: "calendar" }
  | { type: "selector"; date: string; submissions: LeetCodeSubmission[] }
  | { type: "detail"; submission: LeetCodeSubmission };

// ============================================================================
// ACTIVITY COMPONENTS
// ============================================================================

function ActivityDayCell({
  activities,
  dayNumber,
  onActivityClick
}: {
  activities: CalendarActivity[];
  dayNumber: number;
  onActivityClick: (activities: CalendarActivity[], date: string) => void;
}) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isTransitioning, setIsTransitioning] = useState(false);

  useEffect(() => {
    if (activities.length <= 1) return;
    const interval = setInterval(() => {
      setIsTransitioning(true);
      setTimeout(() => {
        setCurrentIndex(prev => (prev + 1) % activities.length);
        setIsTransitioning(false);
      }, 150);
    }, 2000);
    return () => clearInterval(interval);
  }, [activities.length]);

  if (activities.length === 0) {
    return <span className="calendar-day-number">{dayNumber}</span>;
  }

  const currentActivity = activities[currentIndex % activities.length];

  return (
    <div className="relative w-full h-full">
      <button
        onClick={() => onActivityClick(activities, activities[0].date)}
        className="calendar-activity"
        title={`${activities.length} activit${activities.length === 1 ? 'y' : 'ies'}`}
      >
        <div style={{ opacity: isTransitioning ? 0 : 1, transition: 'opacity 0.3s ease' }}>
          <Image
            src={`/icons/activities/${getIconForType(currentActivity.type)}.svg`}
            alt={currentActivity.type}
            width={16}
            height={16}
            className="activity-icon"
          />
        </div>
        {activities.length > 1 && (
          <span className="absolute -top-1 -right-1 bg-gray text-off-black text-[10px] font-bold rounded-full w-3.5 h-3.5 flex items-center justify-center">
            {activities.length}
          </span>
        )}
      </button>
    </div>
  );
}

function ActivitySelector({
  activities,
  date,
  onSelect,
  onBack
}: {
  activities: CalendarActivity[];
  date: string;
  onSelect: (activity: CalendarActivity) => void;
  onBack: () => void;
}) {
  const dateObj = new Date(date + "T12:00:00");
  const dateDisplay = dateObj.toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric"
  }).toLowerCase();

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between" style={{ marginBottom: '24px' }}>
        <button onClick={onBack} className="flex items-center justify-center" aria-label="Back">
          <Image src="/icons/arrow-left.svg" alt="" width={16} height={16} className="opacity-70 hover:opacity-100 transition-opacity" />
        </button>
        <span className="font-sans text-off-white text-sm">{dateDisplay}</span>
        <div className="w-4" />
      </div>
      <div className="flex flex-col gap-2">
        {activities.map((activity) => {
          const isDurationBased = DURATION_TYPES.includes(activity.type);
          const metric = liftMetric(activity) ?? (isDurationBased ? formatDuration(activity.elapsedTime) : formatDistance(activity.distance));
          return (
            <button
              key={activity.id}
              onClick={() => onSelect(activity)}
              className="link-highlight rounded-lg text-left flex items-center gap-3"
              style={{ padding: '8px 12px' }}
            >
              <Image
                src={`/icons/activities/${getIconForType(activity.type)}.svg`}
                alt={activity.type}
                width={18}
                height={18}
                className="activity-icon"
              />
              <div className="flex flex-col">
                <span className="font-sans text-off-white text-sm">{getActivityName(activity.type)}</span>
                <span className="font-sans text-gray text-xs">{metric} • {formatTimeOfDay(activity.startTime)}</span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ActivityDetail({
  activity,
  onBack
}: {
  activity: CalendarActivity;
  onBack: () => void;
}) {
  // lazy enhancement: fetch route thumbnail + photos for this activity; quiet
  // no-op on failure (list payload stays polyline-free to keep load cost flat)
  const [detail, setDetail] = useState<{ cardPolyline: string | null; photos: { url: string }[] } | null>(null);
  useEffect(() => {
    if (activity.href) return;
    let cancelled = false;
    fetch(`/api/activities/${activity.id}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (!cancelled && body?.activity) {
          setDetail({ cardPolyline: body.activity.cardPolyline ?? null, photos: body.activity.photos ?? [] });
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [activity.id, activity.href]);

  const showDistance = DISTANCE_TYPES.includes(activity.type);
  const showPace = PACE_TYPES.includes(activity.type);
  const showSpeed = SPEED_TYPES.includes(activity.type);
  const showElevation = activity.totalElevationGain > 0;
  const showHeartrate = activity.averageHeartrate !== null;
  const showMaxHeartrate = activity.maxHeartrate !== null;
  const isDurationBased = DURATION_TYPES.includes(activity.type);

  const dateObj = new Date(activity.date + "T12:00:00");
  const dateDisplay = dateObj.toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric"
  }).toLowerCase();

  const stats: { label: string; value: string }[] = [];
  const lift = liftMetric(activity);
  if (!lift) stats.push({ label: "time", value: formatDuration(isDurationBased ? activity.elapsedTime : activity.duration) });
  if (showDistance) stats.push({ label: "distance", value: formatDistance(activity.distance) });
  if (showPace && activity.averageSpeed > 0) stats.push({ label: "avg pace", value: formatPace(activity.averageSpeed) });
  if (showSpeed && activity.averageSpeed > 0) stats.push({ label: "avg speed", value: formatSpeed(activity.averageSpeed) });
  if (showElevation) stats.push({ label: "elevation", value: formatElevation(activity.totalElevationGain) });
  if (showHeartrate) stats.push({ label: "avg hr", value: `${Math.round(activity.averageHeartrate!)} bpm` });
  if (showMaxHeartrate) stats.push({ label: "max hr", value: `${Math.round(activity.maxHeartrate!)} bpm` });

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between" style={{ marginBottom: '24px' }}>
        <button onClick={onBack} className="flex items-center justify-center" aria-label="Back">
          <Image src="/icons/arrow-left.svg" alt="" width={16} height={16} className="opacity-70 hover:opacity-100 transition-opacity" />
        </button>
        <span className="font-sans text-off-white text-sm">{dateDisplay}</span>
        <div className="w-4" />
      </div>
      <div className="flex items-center gap-3" style={{ marginBottom: '12px' }}>
        <div className="w-10 h-10 shrink-0 rounded-lg flex items-center justify-center" style={{ border: '1px solid var(--theme-highlight-bg)' }}>
          <Image src={`/icons/activities/${getIconForType(activity.type)}.svg`} alt={activity.type} width={24} height={24} className="activity-icon" />
        </div>
        <div className="min-w-0">
          <h4 className="font-sans font-medium text-off-white text-base leading-tight break-words line-clamp-3">
            {activity.name || getActivityName(activity.type)}
          </h4>
          <span className="font-sans text-gray text-xs">{formatTimeOfDay(activity.startTime)}</span>
        </div>
      </div>
      {lift && <p className="font-sans text-gray text-sm mb-4">{lift}</p>}
      {activity.description && (
        <p className="font-sans text-gray text-sm mb-4 leading-relaxed">{activity.description}</p>
      )}
      {detail?.cardPolyline && (
        <div className="flex justify-center" style={{ marginBottom: '12px' }}>
          <RouteThumb polyline={detail.cardPolyline} height={80} />
        </div>
      )}
      <div className="grid grid-cols-3 gap-3" style={{ marginBottom: '24px' }}>
        {stats.map((stat) => (
          <div key={stat.label} className="text-center">
            <div className="font-sans text-off-white text-sm font-medium">{stat.value}</div>
            <div className="font-sans text-gray text-xs">{stat.label}</div>
          </div>
        ))}
      </div>
      {detail && detail.photos.length > 0 && (
        <div className="flex" style={{ gap: '6px', marginBottom: '12px', overflowX: 'auto' }}>
          {detail.photos.map((p, i) => (
            // eslint-disable-next-line @next/next/no-img-element -- pre-downscaled photos bypass image optimization by design
            <img key={i} src={p.url} alt="" className="rounded" style={{ width: 48, height: 48, objectFit: 'cover', flexShrink: 0 }} />
          ))}
        </div>
      )}
      <a
        href={activity.href ?? `/activities/${activity.id}`}
        className="font-sans text-gray text-sm hover:text-off-white transition-colors text-center mt-auto"
      >
        {activity.href ? "view workout" : "view activity"} &rarr;
      </a>
    </div>
  );
}

// ============================================================================
// LEETCODE COMPONENTS
// ============================================================================

function LeetCodeDayCell({
  submissions,
  dayNumber,
  onSubmissionClick
}: {
  submissions: LeetCodeSubmission[];
  dayNumber: number;
  onSubmissionClick: (submissions: LeetCodeSubmission[], date: string) => void;
}) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isTransitioning, setIsTransitioning] = useState(false);

  useEffect(() => {
    if (submissions.length <= 1) return;
    const interval = setInterval(() => {
      setIsTransitioning(true);
      setTimeout(() => {
        setCurrentIndex(prev => (prev + 1) % submissions.length);
        setIsTransitioning(false);
      }, 150);
    }, 2000);
    return () => clearInterval(interval);
  }, [submissions.length]);

  if (submissions.length === 0) {
    return <span className="calendar-day-number">{dayNumber}</span>;
  }

  const currentSubmission = submissions[currentIndex % submissions.length];

  return (
    <div className="relative w-full h-full">
      <button
        onClick={() => onSubmissionClick(submissions, submissions[0].date)}
        className="calendar-activity"
        title={`${submissions.length} problem${submissions.length === 1 ? '' : 's'}`}
      >
        <div style={{ opacity: isTransitioning ? 0 : 1, transition: 'opacity 0.3s ease' }}>
          <span
            className="font-sans font-bold text-sm"
            style={{ color: getDifficultyColor() }}
          >
            {getDifficultyLetter(currentSubmission.difficulty)}
          </span>
        </div>
        {submissions.length > 1 && (
          <span className="absolute -top-1 -right-1 bg-gray text-off-black text-[10px] font-bold rounded-full w-3.5 h-3.5 flex items-center justify-center">
            {submissions.length}
          </span>
        )}
      </button>
    </div>
  );
}

function LeetCodeProblemSelector({
  submissions,
  date,
  onSelect,
  onBack
}: {
  submissions: LeetCodeSubmission[];
  date: string;
  onSelect: (submission: LeetCodeSubmission) => void;
  onBack: () => void;
}) {
  const dateObj = new Date(date + "T12:00:00");
  const dateDisplay = dateObj.toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric"
  }).toLowerCase();

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between" style={{ marginBottom: '24px' }}>
        <button onClick={onBack} className="flex items-center justify-center" aria-label="Back">
          <Image src="/icons/arrow-left.svg" alt="" width={16} height={16} className="opacity-70 hover:opacity-100 transition-opacity" />
        </button>
        <span className="font-sans text-off-white text-sm">{dateDisplay}</span>
        <div className="w-4" />
      </div>
      <div className="flex flex-col gap-2">
        {submissions.map((submission) => (
          <button
            key={submission.sha}
            onClick={() => onSelect(submission)}
            className="link-highlight rounded-lg text-left flex items-center gap-3"
            style={{ padding: '8px 12px' }}
          >
            <span
              className="font-sans font-bold text-lg w-6 text-center"
              style={{ color: getDifficultyColor() }}
            >
              {getDifficultyLetter(submission.difficulty)}
            </span>
            <div className="flex flex-col min-w-0">
              <span className="font-sans text-off-white text-sm truncate">
                {submission.problemNumber}. {submission.problemTitle}
              </span>
              <span className="font-sans text-gray text-xs capitalize">
                {submission.difficulty}
              </span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function LeetCodeProblemDetail({
  submission,
  onBack
}: {
  submission: LeetCodeSubmission;
  onBack: () => void;
}) {
  const dateObj = new Date(submission.date + "T12:00:00");
  const dateDisplay = dateObj.toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric"
  }).toLowerCase();

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between" style={{ marginBottom: '24px' }}>
        <button onClick={onBack} className="flex items-center justify-center" aria-label="Back">
          <Image src="/icons/arrow-left.svg" alt="" width={16} height={16} className="opacity-70 hover:opacity-100 transition-opacity" />
        </button>
        <span className="font-sans text-off-white text-sm">{dateDisplay}</span>
        <div className="w-4" />
      </div>
      <div className="flex items-center gap-3" style={{ marginBottom: '12px' }}>
        <div
          className="w-10 h-10 shrink-0 rounded-lg flex items-center justify-center"
          style={{ border: '1px solid var(--theme-highlight-bg)' }}
        >
          <span
            className="font-sans font-bold text-xl"
            style={{ color: getDifficultyColor() }}
          >
            {getDifficultyLetter(submission.difficulty)}
          </span>
        </div>
        <div className="min-w-0">
          <h4 className="font-sans font-medium text-off-white text-base leading-tight break-words line-clamp-3">
            {submission.problemNumber}. {submission.problemTitle}
          </h4>
          <span
            className="font-sans text-xs capitalize"
            style={{ color: getDifficultyColor() }}
          >
            {submission.difficulty}
          </span>
        </div>
      </div>
      <div className="flex flex-col gap-2 mt-auto">
        <a
          href={`https://leetcode.com/problems/${submission.problemTitle.toLowerCase().replace(/\s+/g, '-')}/`}
          target="_blank"
          rel="noopener noreferrer"
          className="font-sans text-gray text-sm hover:text-off-white transition-colors text-center"
        >
          view problem &rarr;
        </a>
        <a
          href={submission.url}
          target="_blank"
          rel="noopener noreferrer"
          className="font-sans text-gray text-sm hover:text-off-white transition-colors text-center"
        >
          view solution &rarr;
        </a>
      </div>
    </div>
  );
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export default function ActivityCalendar() {
  const [mode, setMode] = useState<CalendarMode>("activities");
  const [currentMonth, setCurrentMonth] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });
  const [lockedHeight, setLockedHeight] = useState<number | null>(null);
  const [lockedWidth, setLockedWidth] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // activity state
  const [activityData, setActivityData] = useState<StoredActivities | null>(null);
  const [activityLoading, setActivityLoading] = useState(true);
  const [activityViewState, setActivityViewState] = useState<ActivityViewState>({ type: "calendar" });

  // LeetCode state
  const [leetcodeData, setLeetcodeData] = useState<StoredSubmissions | null>(null);
  const [leetcodeLoading, setLeetcodeLoading] = useState(true);
  const [leetcodeViewState, setLeetcodeViewState] = useState<LeetCodeViewState>({ type: "calendar" });

  // Fetch activity data
  useEffect(() => {
    async function fetchActivities() {
      try {
        const response = await fetch("/api/activities");
        if (response.ok) {
          const result = await response.json();
          setActivityData(withLifts(result));
        }
      } catch (error) {
        console.error("Failed to fetch activities:", error);
      } finally {
        setActivityLoading(false);
      }
    }
    fetchActivities();
  }, []);

  // Listen for activity updates
  useEffect(() => {
    function handleLatestActivity(e: Event) {
      const { latestActivityId } = (e as CustomEvent).detail;
      const cachedLatestId = activityData?.activities?.[0]?.id;
      if (latestActivityId && latestActivityId !== cachedLatestId) {
        fetch("/api/activities")
          .then(res => res.ok ? res.json() : null)
          .then(result => { if (result) setActivityData(withLifts(result)); })
          .catch(err => console.error("Failed to refresh activities:", err));
      }
    }
    window.addEventListener("latest-activity", handleLatestActivity);
    return () => window.removeEventListener("latest-activity", handleLatestActivity);
  }, [activityData]);

  // Fetch LeetCode data
  useEffect(() => {
    async function fetchLeetCodeSubmissions() {
      try {
        const response = await fetch("/api/github/leetcode");
        if (response.ok) {
          const result = await response.json();
          setLeetcodeData(result);
        }
      } catch (error) {
        console.error("Failed to fetch leetcode submissions:", error);
      } finally {
        setLeetcodeLoading(false);
      }
    }
    fetchLeetCodeSubmissions();
  }, []);

  // Group activity activities by date
  const activitiesByDate = useMemo(() => {
    if (!activityData?.activities) return new Map<string, CalendarActivity[]>();
    const map = new Map<string, CalendarActivity[]>();
    for (const activity of activityData.activities) {
      const existing = map.get(activity.date) || [];
      existing.push(activity);
      map.set(activity.date, existing);
    }
    for (const acts of map.values()) {
      acts.sort((a, b) => a.startTime.localeCompare(b.startTime));
    }
    return map;
  }, [activityData]);

  // Group LeetCode submissions by date
  const leetcodeByDate = useMemo(() => {
    if (!leetcodeData?.submissions) return new Map<string, LeetCodeSubmission[]>();
    const map = new Map<string, LeetCodeSubmission[]>();
    for (const submission of leetcodeData.submissions) {
      const existing = map.get(submission.date) || [];
      existing.push(submission);
      map.set(submission.date, existing);
    }
    return map;
  }, [leetcodeData]);

  // activity stats - yearly totals by activity type
  const activityYearlyStats = useMemo(() => {
    if (!activityData?.activities) return [];
    const currentYear = new Date().getFullYear();
    const yearActivities = activityData.activities.filter(a => a.date.startsWith(String(currentYear)));

    const miles = (acts: CalendarActivity[]) => `${(acts.reduce((s, a) => s + a.distance, 0) / 1609.344).toFixed(1)} mi`;
    const minutes = (acts: CalendarActivity[]) => `${Math.round(acts.reduce((s, a) => s + a.duration, 0) / 60)} min`;
    // one rotating stat per sport family (walks and hikes share one)
    const stat = (families: SportFamily[], format: (acts: CalendarActivity[]) => string, icon = FAMILIES[families[0]].icon) =>
      ({ types: typesInFamily(...families) as string[], icon, format });
    const statDefs: { types: string[]; icon: string; format: (acts: CalendarActivity[]) => string }[] = [
      stat(["run"], miles),
      stat(["ride"], miles),
      stat(["walk", "hike"], miles, "walk"),
      stat(["strength", "cardio"], minutes, "weight"),
      stat(["team"], minutes),
      stat(["mind"], minutes),
      stat(["racket"], minutes),
      stat(["climb"], minutes),
      stat(["swim"], miles),
      stat(["snow"], miles),
      stat(["water"], miles),
      stat(["skate"], miles),
      stat(["golf"], minutes),
    ];

    return statDefs
      .map(def => {
        const acts = yearActivities.filter(a => def.types.includes(a.type));
        if (acts.length === 0) return null;
        return { icon: def.icon, value: def.format(acts) };
      })
      .filter((s): s is { icon: string; value: string } => s !== null);
  }, [activityData]);

  const [activityStatIndex, setActivityStatIndex] = useState(0);
  const [activityStatTransitioning, setActivityStatTransitioning] = useState(false);

  useEffect(() => {
    if (activityYearlyStats.length <= 1) return;
    const interval = setInterval(() => {
      setActivityStatTransitioning(true);
      setTimeout(() => {
        setActivityStatIndex(prev => (prev + 1) % activityYearlyStats.length);
        setActivityStatTransitioning(false);
      }, 150);
    }, 2000);
    return () => clearInterval(interval);
  }, [activityYearlyStats.length]);

  const activityStreak = useMemo(() => {
    if (!activityData?.activities || activityData.activities.length === 0) return 0;
    const activityDates = [...new Set(activityData.activities.map(a => a.date))].sort().reverse();
    if (activityDates.length === 0) return 0;
    const today = new Date();
    const todayStr = today.toISOString().split("T")[0];
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split("T")[0];
    const mostRecent = activityDates[0];
    if (mostRecent !== todayStr && mostRecent !== yesterdayStr) return 0;
    let streak = 0;
    const checkDate = new Date(mostRecent);
    for (const dateStr of activityDates) {
      const expectedStr = checkDate.toISOString().split("T")[0];
      if (dateStr === expectedStr) {
        streak++;
        checkDate.setDate(checkDate.getDate() - 1);
      } else if (dateStr < expectedStr) {
        break;
      }
    }
    return streak;
  }, [activityData]);

  // LeetCode stats
  const leetcodeYearlySolved = useMemo(() => {
    if (!leetcodeData?.submissions) return 0;
    const currentYear = new Date().getFullYear();
    return leetcodeData.submissions.filter(s => s.date.startsWith(String(currentYear))).length;
  }, [leetcodeData]);

  const leetcodeStreak = useMemo(() => {
    if (!leetcodeData?.submissions || leetcodeData.submissions.length === 0) return 0;
    const submissionDates = [...new Set(leetcodeData.submissions.map(s => s.date))].sort().reverse();
    if (submissionDates.length === 0) return 0;
    const today = new Date();
    const todayStr = today.toISOString().split("T")[0];
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split("T")[0];
    const mostRecent = submissionDates[0];
    if (mostRecent !== todayStr && mostRecent !== yesterdayStr) return 0;
    let streak = 0;
    const checkDate = new Date(mostRecent);
    for (const dateStr of submissionDates) {
      const expectedStr = checkDate.toISOString().split("T")[0];
      if (dateStr === expectedStr) {
        streak++;
        checkDate.setDate(checkDate.getDate() - 1);
      } else if (dateStr < expectedStr) {
        break;
      }
    }
    return streak;
  }, [leetcodeData]);

  // Calendar days
  const calendarDays = useMemo(() => {
    const { year, month } = currentMonth;
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const startDayOfWeek = firstDay.getDay();
    const daysInMonth = lastDay.getDate();
    const days: (number | null)[] = [];
    for (let i = 0; i < startDayOfWeek; i++) days.push(null);
    for (let day = 1; day <= daysInMonth; day++) days.push(day);
    while (days.length < 42) days.push(null);
    return days;
  }, [currentMonth]);

  const goToPrevMonth = useCallback(() => {
    setCurrentMonth(prev => prev.month === 0 ? { year: prev.year - 1, month: 11 } : { year: prev.year, month: prev.month - 1 });
  }, []);

  const goToNextMonth = useCallback(() => {
    setCurrentMonth(prev => prev.month === 11 ? { year: prev.year + 1, month: 0 } : { year: prev.year, month: prev.month + 1 });
  }, []);

  const formatDateKey = useCallback((day: number) => {
    const { year, month } = currentMonth;
    return `${year}-${(month + 1).toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
  }, [currentMonth]);

  // activity handlers
  const handleDayActivityClick = useCallback((activities: CalendarActivity[], date: string) => {
    if (containerRef.current) {
      setLockedHeight(containerRef.current.offsetHeight);
      setLockedWidth(containerRef.current.offsetWidth);
    }
    if (activities.length === 1) {
      setActivityViewState({ type: "detail", activity: activities[0] });
    } else {
      setActivityViewState({ type: "selector", date, activities });
    }
  }, []);

  const handleActivityBackToCalendar = useCallback(() => {
    setLockedHeight(null);
    setLockedWidth(null);
    setActivityViewState({ type: "calendar" });
  }, []);

  const handleSelectActivity = useCallback((activity: CalendarActivity) => {
    setActivityViewState({ type: "detail", activity });
  }, []);

  const handleActivityBackFromDetail = useCallback(() => {
    if (activityViewState.type === "detail") {
      const activity = activityViewState.activity;
      const sameDay = (activityData?.activities.filter(a => a.date === activity.date) || []).slice().sort((a, b) => a.startTime.localeCompare(b.startTime));
      if (sameDay.length > 1) {
        setActivityViewState({ type: "selector", date: activity.date, activities: sameDay });
      } else {
        setActivityViewState({ type: "calendar" });
      }
    } else {
      setActivityViewState({ type: "calendar" });
    }
  }, [activityViewState, activityData]);

  // LeetCode handlers
  const handleLeetCodeSubmissionClick = useCallback((submissions: LeetCodeSubmission[], date: string) => {
    if (containerRef.current) {
      setLockedHeight(containerRef.current.offsetHeight);
      setLockedWidth(containerRef.current.offsetWidth);
    }
    if (submissions.length === 1) {
      setLeetcodeViewState({ type: "detail", submission: submissions[0] });
    } else {
      setLeetcodeViewState({ type: "selector", date, submissions });
    }
  }, []);

  const handleLeetCodeBackToCalendar = useCallback(() => {
    setLockedHeight(null);
    setLockedWidth(null);
    setLeetcodeViewState({ type: "calendar" });
  }, []);

  const handleLeetCodeSelectSubmission = useCallback((submission: LeetCodeSubmission) => {
    setLeetcodeViewState({ type: "detail", submission });
  }, []);

  const handleLeetCodeBackFromDetail = useCallback(() => {
    if (leetcodeViewState.type === "detail") {
      const submission = leetcodeViewState.submission;
      const sameDay = leetcodeData?.submissions.filter(s => s.date === submission.date) || [];
      if (sameDay.length > 1) {
        setLeetcodeViewState({ type: "selector", date: submission.date, submissions: sameDay });
      } else {
        setLeetcodeViewState({ type: "calendar" });
      }
    } else {
      setLeetcodeViewState({ type: "calendar" });
    }
  }, [leetcodeViewState, leetcodeData]);

  // Mode switch handler - reset view state
  const handleModeSwitch = useCallback((newMode: CalendarMode) => {
    if (newMode !== mode) {
      setMode(newMode);
      setLockedHeight(null);
      setLockedWidth(null);
      setActivityViewState({ type: "calendar" });
      setLeetcodeViewState({ type: "calendar" });
    }
  }, [mode]);

  const loading = mode === "activities" ? activityLoading : leetcodeLoading;
  const hasData = mode === "activities"
    ? activityData && activityData.activities.length > 0
    : leetcodeData && leetcodeData.submissions.length > 0;

  if (loading) {
    return (
      <div className="activity-calendar">
        <div className="h-[300px] card-bg animate-pulse rounded-lg" />
      </div>
    );
  }

  // Render calendar view for current mode
  const calendarView = (
    <>
      {/* Mode toggle + Month navigation */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {/* Mode toggle */}
          <div className="flex items-center">
            <button
              onClick={() => handleModeSwitch("activities")}
              className={`flex items-center justify-center transition-opacity ${mode === "activities" ? "opacity-100" : "opacity-40 hover:opacity-70"}`}
              aria-label="activities mode"
            >
              <Image src="/icons/activity.svg" alt="activities" width={16} height={16} />
            </button>
            <span className="text-gray mx-1.5 text-xs">|</span>
            <button
              onClick={() => handleModeSwitch("leetcode")}
              className={`flex items-center justify-center transition-opacity ${mode === "leetcode" ? "opacity-100" : "opacity-40 hover:opacity-70"}`}
              aria-label="LeetCode mode"
            >
              <Image src="/icons/leetcode.svg" alt="LeetCode" width={16} height={16} />
            </button>
          </div>

          {/* refresh button removed: it fired the destructive full-refresh endpoint
              from the public page (one tap wiped the activity history once the
              upstream api died). syncs are admin-only now. */}
        </div>

        {/* Month navigation */}
        <div className="flex items-center gap-0.5">
          <button
            onClick={goToPrevMonth}
            className="flex items-center justify-center"
            aria-label="Previous month"
          >
            <Image src="/icons/arrow-left.svg" alt="" width={16} height={16} className="opacity-70 hover:opacity-100 transition-opacity" />
          </button>
          <span className="font-sans font-medium text-off-white text-sm min-w-[120px] text-center">
            {MONTHS[currentMonth.month]} {currentMonth.year}
          </span>
          <button
            onClick={goToNextMonth}
            className="flex items-center justify-center"
            aria-label="Next month"
          >
            <Image src="/icons/arrow-right.svg" alt="" width={16} height={16} className="opacity-70 hover:opacity-100 transition-opacity" />
          </button>
        </div>
      </div>

      {/* Day headers */}
      <div style={{ paddingTop: '16px', paddingBottom: '8px' }}>
        <div className="grid grid-cols-7 gap-1">
          {DAYS.map((day, i) => (
            <div key={i} className="flex items-center justify-center">
              <span className="font-sans font-bold text-gray text-xs">{day}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Calendar grid */}
      <div className="grid grid-cols-7 gap-1">
        {calendarDays.map((day, i) => {
          if (day === null) {
            return <div key={i} className="calendar-day" />;
          }
          const dateKey = formatDateKey(day);

          if (mode === "activities") {
            const activities = activitiesByDate.get(dateKey) || [];
            return (
              <div key={i} className="calendar-day">
                <ActivityDayCell
                  activities={activities}
                  dayNumber={day}
                  onActivityClick={handleDayActivityClick}
                />
              </div>
            );
          } else {
            const submissions = leetcodeByDate.get(dateKey) || [];
            return (
              <div key={i} className="calendar-day">
                <LeetCodeDayCell
                  submissions={submissions}
                  dayNumber={day}
                  onSubmissionClick={handleLeetCodeSubmissionClick}
                />
              </div>
            );
          }
        })}
      </div>

      {/* Stats row */}
      <div className="flex items-center justify-between" style={{ marginTop: '12px' }}>
        {mode === "activities" ? (
          <>
            {activityYearlyStats.length > 0 && (
              <span className="font-sans text-gray text-sm flex items-center gap-1">
                <div className="flex items-center gap-1" style={{ opacity: activityStatTransitioning ? 0 : 1, transition: 'opacity 0.3s ease' }}>
                  <Image src={`/icons/activities/${activityYearlyStats[activityStatIndex % activityYearlyStats.length].icon}.svg`} alt="" width={14} height={14} className="opacity-70" />
                  <span className="font-bold">{activityYearlyStats[activityStatIndex % activityYearlyStats.length].value}</span>
                </div>
                 in {new Date().getFullYear()}
              </span>
            )}
            {activityStreak > 0 && (
              <span className="font-sans text-gray text-sm flex items-center gap-1">
                <Image src="/icons/fire.svg" alt="Streak" width={14} height={14} className="opacity-70" />
                {activityStreak}
              </span>
            )}
          </>
        ) : (
          <>
            <span className="font-sans text-gray text-sm">
              <span className="font-bold">{leetcodeYearlySolved}</span> solved in {new Date().getFullYear()}
            </span>
            {leetcodeStreak > 0 && (
              <span className="font-sans text-gray text-sm flex items-center gap-1">
                <Image src="/icons/fire.svg" alt="Streak" width={14} height={14} className="opacity-70" />
                {leetcodeStreak}
              </span>
            )}
          </>
        )}
      </div>
    </>
  );

  // Render content based on mode and view state
  const renderContent = () => {
    if (mode === "activities") {
      if (activityViewState.type === "selector") {
        return (
          <ActivitySelector
            activities={activityViewState.activities}
            date={activityViewState.date}
            onSelect={handleSelectActivity}
            onBack={handleActivityBackToCalendar}
          />
        );
      }
      if (activityViewState.type === "detail") {
        return (
          <ActivityDetail
            activity={activityViewState.activity}
            onBack={handleActivityBackFromDetail}
          />
        );
      }
    } else {
      if (leetcodeViewState.type === "selector") {
        return (
          <LeetCodeProblemSelector
            submissions={leetcodeViewState.submissions}
            date={leetcodeViewState.date}
            onSelect={handleLeetCodeSelectSubmission}
            onBack={handleLeetCodeBackToCalendar}
          />
        );
      }
      if (leetcodeViewState.type === "detail") {
        return (
          <LeetCodeProblemDetail
            submission={leetcodeViewState.submission}
            onBack={handleLeetCodeBackFromDetail}
          />
        );
      }
    }

    // Show calendar if no data for current mode, or show calendar view
    if (!hasData) {
      return calendarView;
    }

    return calendarView;
  };

  return (
    <div className="activity-calendar">
      <div
        ref={containerRef}
        className="card-bg rounded-lg overflow-hidden flex flex-col !p-5"
        style={{
          ...(lockedHeight ? { height: lockedHeight } : {}),
          ...(lockedWidth ? { width: lockedWidth } : {}),
        }}
      >
        {renderContent()}
      </div>
    </div>
  );
}
