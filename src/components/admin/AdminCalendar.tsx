"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import type { AdminCalendarEvent } from "@/lib/admin/calendar-events";

// unified multi-month admin calendar: every event kind, grid → month → day →
// detail drill-down. new component — the public ActivityCalendar is untouched.

type View =
  | { level: "grid" }
  | { level: "month"; year: number; month: number }
  | { level: "day"; date: string }
  | { level: "detail"; event: AdminCalendarEvent };

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const DAYS = ["s", "m", "t", "w", "t", "f", "s"];

const KIND_ICON: Record<string, string> = {
  leetcode: "/icons/leetcode.svg",
  commit: "/icons/github.svg",
  blog: "/icons/blog.svg",
  library: "/icons/library.svg",
  photos: "/icons/photos.svg",
};

function eventIcon(e: AdminCalendarEvent): string {
  if (e.kind === "activity") {
    const icons: Record<string, string> = {
      Run: "run", Ride: "ride", Swim: "swim", Yoga: "yoga", WeightTraining: "weight",
      Workout: "workout", Hike: "hike", Walk: "walk", Tennis: "tennis", Soccer: "soccer",
      TrailRun: "trailrun", RockClimbing: "climb",
    };
    return `/icons/activities/${icons[e.type] ?? "workout"}.svg`;
  }
  return KIND_ICON[e.kind] ?? "/icons/github.svg";
}

function eventLabel(e: AdminCalendarEvent): string {
  switch (e.kind) {
    case "activity": return e.name;
    case "leetcode": return `${e.problemNumber}. ${e.problemTitle}`;
    case "commit": return `${e.count} commit${e.count === 1 ? "" : "s"}`;
    default: return e.title;
  }
}

function ymKey(year: number, month: number): string {
  return `${year}-${String(month + 1).padStart(2, "0")}`;
}

function monthsBack(n: number): { year: number; month: number }[] {
  const now = new Date();
  const out: { year: number; month: number }[] = [];
  for (let i = 0; i < n; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push({ year: d.getFullYear(), month: d.getMonth() });
  }
  return out;
}

export default function AdminCalendar() {
  const [monthCount, setMonthCount] = useState(6);
  const [events, setEvents] = useState<AdminCalendarEvent[]>([]);
  const [failedSources, setFailedSources] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<View>({ level: "grid" });

  const months = useMemo(() => monthsBack(monthCount), [monthCount]);

  useEffect(() => {
    const oldest = months[months.length - 1];
    const newest = months[0];
    const from = ymKey(oldest.year, oldest.month);
    const to = ymKey(newest.year, newest.month);
    setLoading(true);
    fetch(`/api/admin/calendar?from=${from}&to=${to}`)
      .then(async (res) => {
        const body = await res.json().catch(() => null);
        if (body?.data) {
          setEvents(body.data.events);
          setFailedSources(
            Object.entries(body.data.sources as Record<string, string>)
              .filter(([, v]) => v === "error")
              .map(([k]) => k)
          );
        }
      })
      .catch(() => setFailedSources(["all"]))
      .finally(() => setLoading(false));
  }, [months]);

  const byDate = useMemo(() => {
    const map = new Map<string, AdminCalendarEvent[]>();
    for (const e of events) {
      const list = map.get(e.date) ?? [];
      list.push(e);
      map.set(e.date, list);
    }
    return map;
  }, [events]);

  if (loading) return <div className="card-bg animate-pulse rounded-lg" style={{ height: 300 }} />;

  // ------------------------------------------------------------------ detail
  if (view.level === "detail") {
    const e = view.event;
    return (
      <div className="flex flex-col" style={{ gap: "12px" }}>
        <BackRow onBack={() => setView({ level: "day", date: e.date })} label={e.date} />
        <div className="flex items-center" style={{ gap: "10px" }}>
          <div className="rounded-lg flex items-center justify-center" style={{ width: 40, height: 40, border: "1px solid var(--theme-highlight-bg)" }}>
            <Image src={eventIcon(e)} alt="" width={20} height={20} />
          </div>
          <div>
            <p className="font-sans text-off-white text-base">{eventLabel(e)}</p>
            <p className="font-sans text-gray text-xs">
              {e.kind}
              {"status" in e ? ` · ${e.status}` : ""}
              {e.kind === "activity" ? ` · ${e.startTime}` : ""}
              {e.kind === "leetcode" ? ` · ${e.difficulty}` : ""}
            </p>
          </div>
        </div>
        <div className="flex flex-col" style={{ gap: "6px" }}>
          {e.kind === "activity" && (
            <>
              <Link href={`/activities/${e.id}`} className="font-sans text-gray text-sm link-highlight">open activity →</Link>
              <Link href={`/admin/activities/${e.id}`} className="font-sans text-gray text-sm link-highlight">edit →</Link>
            </>
          )}
          {e.kind === "leetcode" && (
            <a href={e.url} target="_blank" rel="noopener noreferrer" className="font-sans text-gray text-sm link-highlight">view solution →</a>
          )}
          {e.kind === "commit" && (
            <a href="https://github.com/andrewyzhou" target="_blank" rel="noopener noreferrer" className="font-sans text-gray text-sm link-highlight">view on github →</a>
          )}
          {(e.kind === "blog" || e.kind === "library" || e.kind === "photos") && (
            <>
              <Link href={`/admin/content/${e.kind}/${e.slug}`} className="font-sans text-gray text-sm link-highlight">edit →</Link>
              {e.status === "published" && (
                <Link href={`/${e.kind === "photos" ? "photos" : e.kind}/${e.slug}`} className="font-sans text-gray text-sm link-highlight">view on site →</Link>
              )}
            </>
          )}
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------------- day
  if (view.level === "day") {
    const dayEvents = byDate.get(view.date) ?? [];
    const d = new Date(view.date + "T12:00:00");
    return (
      <div className="flex flex-col" style={{ gap: "8px" }}>
        <BackRow
          onBack={() => setView({ level: "month", year: d.getFullYear(), month: d.getMonth() })}
          label={d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }).toLowerCase()}
        />
        {dayEvents.map((e, i) => (
          <button
            key={i}
            onClick={() => setView({ level: "detail", event: e })}
            className="card-bg-hover rounded-lg flex items-center text-left"
            style={{ padding: "8px 10px", gap: "8px" }}
          >
            <Image src={eventIcon(e)} alt="" width={16} height={16} />
            <span className="font-sans text-off-white text-sm" style={{ flex: 1, minWidth: 0 }}>{eventLabel(e)}</span>
            <span className="font-sans text-gray text-xs">{e.kind}</span>
          </button>
        ))}
        {dayEvents.length === 0 && <p className="font-sans text-gray text-sm italic">nothing on this day</p>}
      </div>
    );
  }

  // ------------------------------------------------------------------ month
  if (view.level === "month") {
    const { year, month } = view;
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const cells: (string | null)[] = [
      ...Array.from({ length: firstDay }, () => null),
      ...Array.from({ length: daysInMonth }, (_, i) => `${ymKey(year, month)}-${String(i + 1).padStart(2, "0")}`),
    ];
    return (
      <div className="flex flex-col" style={{ gap: "8px" }}>
        <BackRow onBack={() => setView({ level: "grid" })} label={`${MONTHS[month]} ${year}`} />
        <div className="grid grid-cols-7 gap-1">
          {DAYS.map((d, i) => (
            <div key={i} className="font-sans text-gray text-xs text-center">{d}</div>
          ))}
          {cells.map((date, i) => {
            const dayEvents = date ? byDate.get(date) ?? [] : [];
            const kinds = [...new Set(dayEvents.map((e) => e.kind))];
            // image-carrying entries (blog covers, photo essays) paint a blurred
            // thumbnail behind the day's icons
            const thumb = dayEvents.find((e): e is Extract<AdminCalendarEvent, { thumb?: string }> => "thumb" in e && !!e.thumb)?.thumb;
            return (
              <button
                key={i}
                onClick={() => date && dayEvents.length > 0 && setView({ level: "day", date })}
                disabled={!date || dayEvents.length === 0}
                className="rounded flex flex-col items-center justify-center"
                style={{
                  aspectRatio: "1",
                  backgroundColor: date ? "var(--theme-highlight-bg)" : "transparent",
                  position: "relative",
                  overflow: "hidden",
                }}
              >
                {thumb && (
                  <span
                    aria-hidden
                    style={{
                      position: "absolute",
                      inset: 0,
                      backgroundImage: `url(${thumb})`,
                      backgroundSize: "cover",
                      backgroundPosition: "center",
                      filter: "blur(2px) brightness(0.6)",
                    }}
                  />
                )}
                {date && <span className="font-sans text-gray" style={{ fontSize: "0.6rem", position: "absolute", top: 2, left: 4, zIndex: 1 }}>{Number(date.slice(-2))}</span>}
                {kinds.length > 0 && (
                  <span className="flex" style={{ gap: "2px", zIndex: 1 }}>
                    {kinds.slice(0, 3).map((k) => (
                      <Image key={k} src={eventIcon(dayEvents.find((e) => e.kind === k)!)} alt={k} width={12} height={12} />
                    ))}
                  </span>
                )}
                {dayEvents.length > 1 && (
                  <span className="font-sans text-gray" style={{ fontSize: "0.55rem", position: "absolute", top: 2, right: 3, zIndex: 1 }}>
                    {dayEvents.length}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  // ------------------------------------------------------------------- grid
  return (
    <div className="flex flex-col" style={{ gap: "14px" }}>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        {months.map(({ year, month }) => {
          const firstDay = new Date(year, month, 1).getDay();
          const daysInMonth = new Date(year, month + 1, 0).getDate();
          return (
            <div key={`${year}-${month}`}>
              <button
                onClick={() => setView({ level: "month", year, month })}
                className="font-sans text-gray text-xs link-highlight"
                style={{ marginBottom: "4px" }}
              >
                {MONTHS[month].slice(0, 3)} {year}
              </button>
              <div className="grid grid-cols-7" style={{ gap: "2px" }}>
                {Array.from({ length: firstDay }, (_, i) => (
                  <div key={`pad-${i}`} style={{ aspectRatio: "1" }} />
                ))}
                {Array.from({ length: daysInMonth }, (_, i) => {
                  const date = `${ymKey(year, month)}-${String(i + 1).padStart(2, "0")}`;
                  const dayEvents = byDate.get(date) ?? [];
                  const kindCount = new Set(dayEvents.map((e) => e.kind)).size;
                  return (
                    <div
                      key={date}
                      title={date}
                      className="rounded-sm"
                      style={{
                        aspectRatio: "1",
                        backgroundColor:
                          kindCount === 0
                            ? "var(--theme-highlight-bg)"
                            : "var(--theme-text-primary)",
                        opacity: kindCount === 0 ? 1 : Math.min(0.35 + kindCount * 0.25, 1),
                      }}
                    />
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      <button
        onClick={() => setMonthCount((c) => Math.min(c + 6, 12))}
        disabled={monthCount >= 12}
        className="font-sans text-gray text-sm link-highlight"
        style={{ alignSelf: "flex-start" }}
      >
        load earlier
      </button>
      {failedSources.length > 0 && (
        <p className="font-sans text-gray text-xs italic">some sources unavailable: {failedSources.join(", ")}</p>
      )}
    </div>
  );
}

function BackRow({ onBack, label }: { onBack: () => void; label: string }) {
  return (
    <div className="flex items-center justify-between">
      <button onClick={onBack} aria-label="back">
        <Image src="/icons/arrow-left.svg" alt="" width={16} height={16} className="opacity-70 hover:opacity-100 transition-opacity" />
      </button>
      <span className="font-sans text-off-white text-sm">{label}</span>
      <div style={{ width: 16 }} />
    </div>
  );
}
