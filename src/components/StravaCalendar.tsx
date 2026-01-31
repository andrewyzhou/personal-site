"use client";

import { useEffect, useState, useMemo, useRef, useCallback } from "react";
import Image from "next/image";

interface CalendarActivity {
  id: number;
  name: string;
  type: string;
  date: string; // YYYY-MM-DD
  startTime: string; // HH:MM format (local time)
  distance: number; // in meters
  duration: number; // in seconds (moving time)
  elapsedTime: number; // in seconds (total elapsed time)
  totalElevationGain: number; // in meters
  averageSpeed: number; // in meters per second
  maxSpeed: number; // in meters per second
  averageHeartrate: number | null;
  maxHeartrate: number | null;
  averageCadence: number | null;
  averageWatts: number | null;
  maxWatts: number | null;
  kilojoules: number | null;
  description: string | null;
  sufferScore: number | null;
}

interface StoredActivities {
  activities: CalendarActivity[];
  lastFetchedAt: number | null;
}

const MONTHS = ["january", "february", "march", "april", "may", "june",
                "july", "august", "september", "october", "november", "december"];
const DAYS = ["s", "m", "t", "w", "t", "f", "s"];

// map Strava activity types to icon filenames
const ACTIVITY_ICONS: Record<string, string> = {
  Run: "run",
  Ride: "ride",
  Swim: "swim",
  Yoga: "yoga",
  WeightTraining: "weight",
  Workout: "workout",
  Hike: "hike",
  Walk: "walk",
  Tennis: "tennis",
  Soccer: "soccer",
  TrailRun: "trailrun",
  RockClimbing: "climb",
  // fallbacks
  VirtualRide: "ride",
  VirtualRun: "run",
  MountainBikeRide: "ride",
  GravelRide: "ride",
  Crossfit: "workout",
};

// activity types that use duration instead of distance
const DURATION_TYPES = ["WeightTraining", "Workout", "Yoga", "Crossfit", "Tennis", "Soccer", "RockClimbing"];

// activity type display names
const ACTIVITY_NAMES: Record<string, string> = {
  Run: "run",
  Ride: "bike ride",
  Swim: "swim",
  Walk: "walk",
  Hike: "hike",
  WeightTraining: "lift",
  Workout: "workout",
  Tennis: "tennis",
  Soccer: "soccer",
  TrailRun: "trail run",
  RockClimbing: "climb",
  Yoga: "yoga",
  Crossfit: "crossfit",
  VirtualRun: "run",
  VirtualRide: "bike ride",
  MountainBikeRide: "bike ride",
  GravelRide: "bike ride",
};

function getIconForType(type: string): string {
  return ACTIVITY_ICONS[type] || "workout";
}

function getActivityName(type: string): string {
  return ACTIVITY_NAMES[type] || type.toLowerCase();
}

function formatDistance(meters: number): string {
  const miles = meters / 1609.344;
  return `${miles.toFixed(1)} mi`;
}

function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) {
    return `${hours} hr ${minutes} min`;
  }
  return `${minutes} min`;
}

function getActivityDescription(activity: CalendarActivity): string {
  const useDuration = DURATION_TYPES.includes(activity.type);
  const metric = useDuration ? formatDuration(activity.duration) : formatDistance(activity.distance);
  const name = getActivityName(activity.type);
  return `${metric} ${name}`;
}

// format pace as min:sec per mile
function formatPace(metersPerSecond: number): string {
  if (metersPerSecond <= 0) return "--:--";
  const secondsPerMile = 1609.344 / metersPerSecond;
  const minutes = Math.floor(secondsPerMile / 60);
  const seconds = Math.round(secondsPerMile % 60);
  return `${minutes}:${seconds.toString().padStart(2, "0")}/mi`;
}

// format speed in mph
function formatSpeed(metersPerSecond: number): string {
  if (metersPerSecond <= 0) return "0 mph";
  const mph = metersPerSecond * 2.23694;
  return `${mph.toFixed(1)} mph`;
}

// format elevation in feet
function formatElevation(meters: number): string {
  const feet = meters * 3.28084;
  return `${Math.round(feet)} ft`;
}

// format time of day (24h to 12h)
function formatTimeOfDay(time24: string): string {
  const [hours, minutes] = time24.split(":").map(Number);
  const period = hours >= 12 ? "pm" : "am";
  const hours12 = hours % 12 || 12;
  return `${hours12}:${minutes.toString().padStart(2, "0")} ${period}`;
}

// activity types that show pace (running activities)
const PACE_TYPES = ["Run", "VirtualRun", "TrailRun"];
// activity types that show speed (cycling activities)
const SPEED_TYPES = ["Ride", "VirtualRide", "MountainBikeRide", "GravelRide"];
// activity types that show distance
const DISTANCE_TYPES = ["Run", "VirtualRun", "TrailRun", "Ride", "VirtualRide", "MountainBikeRide", "GravelRide", "Swim", "Walk", "Hike"];

// view state types
type ViewState =
  | { type: "calendar" }
  | { type: "selector"; date: string; activities: CalendarActivity[] }
  | { type: "detail"; activity: CalendarActivity };

// Component for a single calendar day cell with activities
function CalendarDayCell({
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

  // cycle through activities every 2s if multiple
  useEffect(() => {
    if (activities.length <= 1) return;

    const interval = setInterval(() => {
      setIsTransitioning(true);
      setTimeout(() => {
        setCurrentIndex(prev => (prev + 1) % activities.length);
        setIsTransitioning(false);
      }, 150); // half of transition duration
    }, 2000);

    return () => clearInterval(interval);
  }, [activities.length]);

  if (activities.length === 0) {
    return <span className="calendar-day-number">{dayNumber}</span>;
  }

  const currentActivity = activities[currentIndex];

  return (
    <div className="relative w-full h-full">
      <button
        onClick={() => onActivityClick(activities, activities[0].date)}
        className="calendar-activity"
        title={`${activities.length} activit${activities.length === 1 ? 'y' : 'ies'}`}
      >
        <div className={`transition-opacity duration-300 ${isTransitioning ? 'opacity-0' : 'opacity-100'}`}>
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

// Component for selecting which activity to view (when multiple on same day)
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
  // parse date for display
  const dateObj = new Date(date + "T12:00:00");
  const dateDisplay = dateObj.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric"
  }).toLowerCase();

  return (
    <div className="flex flex-col h-full">
      {/* header */}
      <div className="flex items-center justify-between" style={{ marginBottom: '24px' }}>
        <button
          onClick={onBack}
          className="font-sans text-gray text-sm hover:text-off-white hover:underline transition-colors"
        >
          &lt; back
        </button>
        <span className="font-sans text-off-white text-sm">{dateDisplay}</span>
        <div className="w-12" /> {/* spacer for alignment */}
      </div>

      {/* activity list */}
      <div className="flex flex-col gap-2">
        {activities.map((activity) => {
          const isDurationBased = DURATION_TYPES.includes(activity.type);
          const time = isDurationBased ? formatDuration(activity.elapsedTime) : formatDuration(activity.duration);
          const metric = isDurationBased ? time : formatDistance(activity.distance);

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
                <span className="font-sans text-off-white text-sm">
                  {getActivityName(activity.type)}
                </span>
                <span className="font-sans text-gray text-xs">
                  {metric} • {formatTimeOfDay(activity.startTime)}
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// Component for displaying activity details
function ActivityDetail({
  activity,
  onBack
}: {
  activity: CalendarActivity;
  onBack: () => void;
}) {
  const showDistance = DISTANCE_TYPES.includes(activity.type);
  const showPace = PACE_TYPES.includes(activity.type);
  const showSpeed = SPEED_TYPES.includes(activity.type);
  const showElevation = activity.totalElevationGain > 0;
  const showHeartrate = activity.averageHeartrate !== null;
  const showMaxHeartrate = activity.maxHeartrate !== null;
  const showPower = activity.averageWatts !== null;
  const isDurationBased = DURATION_TYPES.includes(activity.type);

  // parse date for display
  const dateObj = new Date(activity.date + "T12:00:00");
  const dateDisplay = dateObj.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric"
  }).toLowerCase();

  // build stats array dynamically based on activity type
  const stats: { label: string; value: string }[] = [];

  // time: use elapsed time for duration-based activities, moving time for others
  if (isDurationBased) {
    stats.push({ label: "time", value: formatDuration(activity.elapsedTime) });
  } else {
    stats.push({ label: "time", value: formatDuration(activity.duration) });
  }

  if (showDistance) {
    stats.push({ label: "distance", value: formatDistance(activity.distance) });
  }

  if (showPace && activity.averageSpeed > 0) {
    stats.push({ label: "avg pace", value: formatPace(activity.averageSpeed) });
  }

  if (showSpeed && activity.averageSpeed > 0) {
    stats.push({ label: "avg speed", value: formatSpeed(activity.averageSpeed) });
  }

  if (showElevation) {
    stats.push({ label: "elevation", value: formatElevation(activity.totalElevationGain) });
  }

  if (showHeartrate) {
    stats.push({ label: "avg hr", value: `${Math.round(activity.averageHeartrate!)} bpm` });
  }

  if (showMaxHeartrate) {
    stats.push({ label: "max hr", value: `${Math.round(activity.maxHeartrate!)} bpm` });
  }

  if (showPower) {
    stats.push({ label: "power", value: `${Math.round(activity.averageWatts!)}W` });
  }

  return (
    <div className="flex flex-col h-full">
      {/* header */}
      <div className="flex items-center justify-between" style={{ marginBottom: '24px' }}>
        <button
          onClick={onBack}
          className="font-sans text-gray text-sm hover:text-off-white hover:underline transition-colors"
        >
          &lt; back
        </button>
        <span className="font-sans text-off-white text-sm">{dateDisplay}</span>
        <div className="w-12" /> {/* spacer for alignment */}
      </div>

      {/* activity header */}
      <div className="flex items-center gap-3" style={{ marginBottom: '12px' }}>
        <div className="w-10 h-10 shrink-0 rounded-lg flex items-center justify-center" style={{ border: '1px solid var(--theme-highlight-bg)' }}>
          <Image
            src={`/icons/activities/${getIconForType(activity.type)}.svg`}
            alt={activity.type}
            width={24}
            height={24}
            className="activity-icon"
          />
        </div>
        <div className="min-w-0">
          <h4 className="font-sans font-medium text-off-white text-base leading-tight break-words line-clamp-3">
            {activity.name || getActivityName(activity.type)}
          </h4>
          <span className="font-sans text-gray text-xs">
            {formatTimeOfDay(activity.startTime)}
          </span>
        </div>
      </div>

      {/* description if present */}
      {activity.description && (
        <p className="font-sans text-gray text-sm mb-4 leading-relaxed">
          {activity.description}
        </p>
      )}

      {/* stats grid */}
      <div className="grid grid-cols-3 gap-3" style={{ marginBottom: '24px' }}>
        {stats.map((stat) => (
          <div key={stat.label} className="text-center">
            <div className="font-sans text-off-white text-sm font-medium">
              {stat.value}
            </div>
            <div className="font-sans text-gray text-xs">
              {stat.label}
            </div>
          </div>
        ))}
      </div>

      {/* strava link */}
      <a
        href={`https://www.strava.com/activities/${activity.id}`}
        target="_blank"
        rel="noopener noreferrer"
        className="font-sans text-gray text-sm hover:text-off-white hover:underline transition-colors text-center mt-auto"
      >
        view on strava &rarr;
      </a>
    </div>
  );
}

export default function StravaCalendar() {
  const [data, setData] = useState<StoredActivities | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentMonth, setCurrentMonth] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });
  const [viewState, setViewState] = useState<ViewState>({ type: "calendar" });
  const [lockedHeight, setLockedHeight] = useState<number | null>(null);
  const [lockedWidth, setLockedWidth] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // handler for when an activity day is clicked
  const handleActivityClick = useCallback((activities: CalendarActivity[], date: string) => {
    // lock dimensions before transitioning
    if (containerRef.current) {
      setLockedHeight(containerRef.current.offsetHeight);
      setLockedWidth(containerRef.current.offsetWidth);
    }
    if (activities.length === 1) {
      // single activity - go directly to detail view
      setViewState({ type: "detail", activity: activities[0] });
    } else {
      // multiple activities - show selector
      setViewState({ type: "selector", date, activities });
    }
  }, []);

  // handler for going back to calendar
  const handleBackToCalendar = useCallback(() => {
    setLockedHeight(null);
    setLockedWidth(null);
    setViewState({ type: "calendar" });
  }, []);

  // handler for selecting an activity from selector
  const handleSelectActivity = useCallback((activity: CalendarActivity) => {
    setViewState({ type: "detail", activity });
  }, []);

  // handler for going back from detail to selector (if came from selector)
  const handleBackFromDetail = useCallback(() => {
    // check if we should go back to selector or calendar
    if (viewState.type === "detail") {
      const activity = viewState.activity;
      // find all activities on the same date
      const sameDay = data?.activities.filter(a => a.date === activity.date) || [];
      if (sameDay.length > 1) {
        setViewState({ type: "selector", date: activity.date, activities: sameDay });
      } else {
        setViewState({ type: "calendar" });
      }
    } else {
      setViewState({ type: "calendar" });
    }
  }, [viewState, data]);

  useEffect(() => {
    async function fetchActivities() {
      try {
        const response = await fetch("/api/strava/activities");
        if (response.ok) {
          const result = await response.json();
          setData(result);
        }
      } catch (error) {
        console.error("Failed to fetch strava activities:", error);
      } finally {
        setLoading(false);
      }
    }
    fetchActivities();
  }, []);

  // Listen for new activity events from the Currently section
  useEffect(() => {
    function handleLatestActivity(e: Event) {
      const { latestActivityId } = (e as CustomEvent).detail;
      const cachedLatestId = data?.activities?.[0]?.id;
      if (latestActivityId && latestActivityId !== cachedLatestId) {
        fetch("/api/strava/activities")
          .then(res => res.ok ? res.json() : null)
          .then(result => {
            if (result) setData(result);
          })
          .catch(err => console.error("Failed to refresh strava activities:", err));
      }
    }

    window.addEventListener("strava-latest-activity", handleLatestActivity);
    return () => window.removeEventListener("strava-latest-activity", handleLatestActivity);
  }, [data]);

  // group activities by date - now returns array of activities per date
  const activitiesByDate = useMemo(() => {
    if (!data?.activities) return new Map<string, CalendarActivity[]>();
    const map = new Map<string, CalendarActivity[]>();

    for (const activity of data.activities) {
      const existing = map.get(activity.date) || [];
      existing.push(activity);
      map.set(activity.date, existing);
    }

    // sort each day's activities chronologically (by id as proxy, lower id = earlier)
    for (const acts of map.values()) {
      acts.sort((a, b) => a.id - b.id);
    }

    return map;
  }, [data]);

  // calculate yearly mileage (runs only)
  const yearlyMileage = useMemo(() => {
    if (!data?.activities) return 0;
    const currentYear = new Date().getFullYear();
    const runTypes = ["Run", "VirtualRun", "TrailRun"];

    const totalMeters = data.activities
      .filter(a => a.date.startsWith(String(currentYear)) && runTypes.includes(a.type))
      .reduce((sum, a) => sum + (a.distance || 0), 0);

    return totalMeters / 1609.344; // convert to miles
  }, [data]);

  // calculate current streak (consecutive days with activity ending today or yesterday)
  const currentStreak = useMemo(() => {
    if (!data?.activities || data.activities.length === 0) return 0;

    // get unique dates with activities, sorted descending
    const activityDates = [...new Set(data.activities.map(a => a.date))].sort().reverse();

    if (activityDates.length === 0) return 0;

    const today = new Date();
    const todayStr = today.toISOString().split("T")[0];
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split("T")[0];

    // streak must start from today or yesterday
    const mostRecent = activityDates[0];
    if (mostRecent !== todayStr && mostRecent !== yesterdayStr) return 0;

    let streak = 0;
    let checkDate = new Date(mostRecent);

    for (const dateStr of activityDates) {
      const expectedStr = checkDate.toISOString().split("T")[0];
      if (dateStr === expectedStr) {
        streak++;
        checkDate.setDate(checkDate.getDate() - 1);
      } else if (dateStr < expectedStr) {
        // gap in dates, streak broken
        break;
      }
    }

    return streak;
  }, [data]);

  // generate calendar days for current month
  const calendarDays = useMemo(() => {
    const { year, month } = currentMonth;
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const startDayOfWeek = firstDay.getDay();
    const daysInMonth = lastDay.getDate();

    const days: (number | null)[] = [];

    // add empty slots for days before first of month
    for (let i = 0; i < startDayOfWeek; i++) {
      days.push(null);
    }

    // add days of month
    for (let day = 1; day <= daysInMonth; day++) {
      days.push(day);
    }

    return days;
  }, [currentMonth]);

  const goToPrevMonth = useCallback(() => {
    setCurrentMonth(prev => {
      if (prev.month === 0) {
        return { year: prev.year - 1, month: 11 };
      }
      return { year: prev.year, month: prev.month - 1 };
    });
  }, []);

  const goToNextMonth = useCallback(() => {
    setCurrentMonth(prev => {
      if (prev.month === 11) {
        return { year: prev.year + 1, month: 0 };
      }
      return { year: prev.year, month: prev.month + 1 };
    });
  }, []);

  const formatDateKey = useCallback((day: number) => {
    const { year, month } = currentMonth;
    const m = (month + 1).toString().padStart(2, "0");
    const d = day.toString().padStart(2, "0");
    return `${year}-${m}-${d}`;
  }, [currentMonth]);

  if (loading) {
    return (
      <div className="strava-calendar">
        <div className="h-[300px] card-bg animate-pulse rounded-lg" />
      </div>
    );
  }

  if (!data || data.activities.length === 0) {
    return null;
  }

  // calendar content component
  const CalendarView = () => (
    <>
      {/* month navigation */}
      <div className="flex items-center justify-between">
        <button
          onClick={goToPrevMonth}
          className="font-sans text-gray text-sm hover:text-off-white hover:underline transition-colors"
          aria-label="Previous month"
        >
          &lt;
        </button>
        <span className="font-sans font-medium text-off-white text-sm">
          {MONTHS[currentMonth.month]} {currentMonth.year}
        </span>
        <button
          onClick={goToNextMonth}
          className="font-sans text-gray text-sm hover:text-off-white hover:underline transition-colors"
          aria-label="Next month"
        >
          &gt;
        </button>
      </div>

      {/* day headers */}
      <div style={{ paddingTop: '16px', paddingBottom: '8px' }}>
        <div className="grid grid-cols-7 gap-1">
          {DAYS.map((day, i) => (
            <div key={i} className="flex items-center justify-center">
              <span className="font-sans font-bold text-gray text-xs">{day}</span>
            </div>
          ))}
        </div>
      </div>

      {/* calendar grid */}
      <div className="grid grid-cols-7 gap-1">
        {calendarDays.map((day, i) => {
          if (day === null) {
            return <div key={i} className="calendar-day" />;
          }

          const dateKey = formatDateKey(day);
          const activities = activitiesByDate.get(dateKey) || [];

          return (
            <div key={i} className="calendar-day">
              <CalendarDayCell
                activities={activities}
                dayNumber={day}
                onActivityClick={handleActivityClick}
              />
            </div>
          );
        })}
      </div>

      {/* stats row */}
      <div className="flex items-center justify-between" style={{ marginTop: '12px' }}>
        <span className="font-sans text-gray text-sm flex items-center gap-1">
          <Image
            src="/icons/activities/run.svg"
            alt="Running"
            width={14}
            height={14}
            className="opacity-70"
          />
          <span className="font-bold">{yearlyMileage.toFixed(1)} mi</span> in {new Date().getFullYear()}
        </span>
        {currentStreak > 0 && (
          <span className="font-sans text-gray text-sm flex items-center gap-1">
            <Image
              src="/icons/fire.svg"
              alt="Streak"
              width={14}
              height={14}
              className="opacity-70"
            />
            {currentStreak}
          </span>
        )}
      </div>
    </>
  );

  // render content based on view state
  const renderContent = () => {
    if (viewState.type === "selector") {
      return (
        <ActivitySelector
          activities={viewState.activities}
          date={viewState.date}
          onSelect={handleSelectActivity}
          onBack={handleBackToCalendar}
        />
      );
    }

    if (viewState.type === "detail") {
      return (
        <ActivityDetail
          activity={viewState.activity}
          onBack={handleBackFromDetail}
        />
      );
    }

    return <CalendarView />;
  };

  return (
    <div className="strava-calendar">
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
