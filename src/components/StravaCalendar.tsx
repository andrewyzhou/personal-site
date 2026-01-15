"use client";

import { useEffect, useState, useMemo } from "react";
import Image from "next/image";

interface CalendarActivity {
  id: number;
  type: string;
  date: string; // YYYY-MM-DD
  distance: number; // in meters
  duration: number; // in seconds
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
  // fallbacks
  VirtualRide: "ride",
  VirtualRun: "run",
  TrailRun: "run",
  MountainBikeRide: "ride",
  GravelRide: "ride",
  Crossfit: "workout",
};

function getIconForType(type: string): string {
  return ACTIVITY_ICONS[type] || "workout";
}

export default function StravaCalendar() {
  const [data, setData] = useState<StoredActivities | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentMonth, setCurrentMonth] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });

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

  // group activities by date for quick lookup
  const activitiesByDate = useMemo(() => {
    if (!data?.activities) return new Map<string, CalendarActivity>();
    const map = new Map<string, CalendarActivity>();
    // store first activity of each day (most activities will be one per day)
    for (const activity of data.activities) {
      if (!map.has(activity.date)) {
        map.set(activity.date, activity);
      }
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

  const goToPrevMonth = () => {
    setCurrentMonth(prev => {
      if (prev.month === 0) {
        return { year: prev.year - 1, month: 11 };
      }
      return { year: prev.year, month: prev.month - 1 };
    });
  };

  const goToNextMonth = () => {
    setCurrentMonth(prev => {
      if (prev.month === 11) {
        return { year: prev.year + 1, month: 0 };
      }
      return { year: prev.year, month: prev.month + 1 };
    });
  };

  const formatDateKey = (day: number) => {
    const { year, month } = currentMonth;
    const m = (month + 1).toString().padStart(2, "0");
    const d = day.toString().padStart(2, "0");
    return `${year}-${m}-${d}`;
  };

  if (loading) {
    return (
      <div className="strava-calendar">
        <div className="h-[200px] card-bg animate-pulse rounded" />
      </div>
    );
  }

  if (!data || data.activities.length === 0) {
    return null;
  }

  return (
    <div className="strava-calendar">
      {/* month navigation */}
      <div className="flex items-center justify-between">
        <button
          onClick={goToPrevMonth}
          className="font-sans text-gray text-sm hover:text-off-white transition-colors px-2"
          aria-label="Previous month"
        >
          &lt;
        </button>
        <span className="font-sans font-medium text-off-white text-sm">
          {MONTHS[currentMonth.month]} {currentMonth.year}
        </span>
        <button
          onClick={goToNextMonth}
          className="font-sans text-gray text-sm hover:text-off-white transition-colors px-2"
          aria-label="Next month"
        >
          &gt;
        </button>
      </div>

      {/* day headers */}
      <div style={{ paddingTop: '12px', paddingBottom: '6px' }}>
        <div className="grid grid-cols-7 gap-1">
          {DAYS.map((day, i) => (
            <div key={i} className="flex items-center justify-center">
              <span className="font-sans font-medium text-gray text-xs">{day}</span>
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
          const activity = activitiesByDate.get(dateKey);

          return (
            <div key={i} className="calendar-day">
              {activity ? (
                <a
                  href={`https://www.strava.com/activities/${activity.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="calendar-activity"
                  title={`${activity.type} on ${dateKey}`}
                >
                  <Image
                    src={`/icons/activities/${getIconForType(activity.type)}.svg`}
                    alt={activity.type}
                    width={16}
                    height={16}
                    className="activity-icon"
                  />
                </a>
              ) : (
                <span className="calendar-day-number">{day}</span>
              )}
            </div>
          );
        })}
      </div>

      {/* stats row */}
      <div className="flex items-center justify-between" style={{ paddingTop: '12px' }}>
        <span className="font-sans text-gray text-sm flex items-center gap-1">
          <Image
            src="/icons/activities/run.svg"
            alt="Running"
            width={14}
            height={14}
            className="opacity-70"
          />
          {yearlyMileage.toFixed(1)} mi in {new Date().getFullYear()}
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
    </div>
  );
}
