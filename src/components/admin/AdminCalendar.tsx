"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import RouteThumb from "@/components/RouteThumb";
import type { AdminCalendarEvent } from "@/lib/admin/calendar-events";

// unified multi-month admin calendar: every event kind with per-kind symbols
// and thumbnail day cells at every level. grid → month → day → detail
// drill-down; doubles as the browse ui. the public ActivityCalendar is
// untouched.

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

const KIND_LABEL: Record<string, string> = {
  activity: "activity",
  leetcode: "leetcode",
  commit: "commits",
  blog: "blog",
  library: "library",
  photos: "photos",
};

// full-bleed breakout: escapes the admin shell's narrow column so the calendar
// gets real width without changing any other admin page
const BREAKOUT: React.CSSProperties = {
  position: "relative",
  left: "50%",
  transform: "translateX(-50%)",
  width: "min(94vw, 1100px)",
};

function eventIcon(e: AdminCalendarEvent): string {
  if (e.kind === "activity") {
    const icons: Record<string, string> = {
      Run: "run", Ride: "ride", Swim: "swim", Yoga: "yoga", WeightTraining: "weight",
      Workout: "workout", Hike: "hike", Walk: "walk", Tennis: "tennis", Soccer: "soccer",
      TrailRun: "trailrun", RockClimbing: "climb",
      VirtualRun: "run", VirtualRide: "ride", MountainBikeRide: "ride", GravelRide: "ride",
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

function eventThumb(e: AdminCalendarEvent): string | undefined {
  return "thumb" in e ? e.thumb : undefined;
}

// route thumbs through the next/image optimizer so tiny cells never download
// full-resolution originals (photos are stored at ≤2000px; a 12-month grid
// would otherwise eagerly fetch tens of mb). w must be a default size bucket.
function thumbUrl(thumb: string, w: 64 | 96 | 128 | 384): string {
  return `/_next/image?url=${encodeURIComponent(thumb)}&w=${w}&q=50`;
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

function monthCells(year: number, month: number): (string | null)[] {
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  return [
    ...Array.from({ length: firstDay }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => `${ymKey(year, month)}-${String(i + 1).padStart(2, "0")}`),
  ];
}

// blurred cover painted behind a day cell's symbols. optimizer-resized and
// css-quoted; a broken url degrades invisibly (background just doesn't paint)
function ThumbBackdrop({ thumb, blur = 2 }: { thumb: string; blur?: number }) {
  return (
    <span
      aria-hidden
      style={{
        position: "absolute",
        inset: 0,
        backgroundImage: `url("${thumbUrl(thumb, 64)}")`,
        backgroundSize: "cover",
        backgroundPosition: "center",
        filter: `blur(${blur}px) brightness(0.55)`,
        transform: "scale(1.15)", // hide blur edge bleed
      }}
    />
  );
}

// day-list / detail thumbnail with a quiet fallback to the kind icon when the
// underlying image is gone (deleted blob, typo'd cover path)
function SafeThumb({ thumb, icon, size = 48 }: { thumb?: string; icon: string; size?: number }) {
  const [broken, setBroken] = useState(false);
  if (!thumb || broken) {
    return (
      <span
        className="rounded flex items-center justify-center"
        style={{ width: size, height: size, border: "1px solid var(--theme-highlight-bg)", flexShrink: 0 }}
      >
        <Image src={icon} alt="" width={Math.round(size * 0.42)} height={Math.round(size * 0.42)} />
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- already optimizer-resized via thumbUrl
    <img
      src={thumbUrl(thumb, 96)}
      alt=""
      onError={() => setBroken(true)}
      className="rounded"
      style={{ width: size, height: size, objectFit: "cover", flexShrink: 0 }}
    />
  );
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
    setLoading(true);
    fetch(`/api/admin/calendar?from=${ymKey(oldest.year, oldest.month)}&to=${ymKey(newest.year, newest.month)}`)
      .then(async (res) => {
        const body = await res.json().catch(() => null);
        if (body?.data) {
          setEvents(body.data.events);
          setFailedSources(
            Object.entries(body.data.sources as Record<string, string>)
              .filter(([, v]) => v === "error")
              .map(([k]) => k)
          );
        } else {
          setFailedSources(["calendar"]);
        }
      })
      .catch(() => setFailedSources(["calendar"]))
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

  if (loading) {
    return (
      <div style={BREAKOUT}>
        <div className="card-bg animate-pulse rounded-lg" style={{ height: 420 }} />
      </div>
    );
  }

  // ------------------------------------------------------------------ detail
  if (view.level === "detail") {
    return (
      <div style={{ maxWidth: 480, marginLeft: "auto", marginRight: "auto" }}>
        <EventDetail event={view.event} onBack={() => setView({ level: "day", date: view.event.date })} />
      </div>
    );
  }

  // -------------------------------------------------------------------- day
  if (view.level === "day") {
    const dayEvents = byDate.get(view.date) ?? [];
    const d = new Date(view.date + "T12:00:00");
    return (
      <div className="flex flex-col" style={{ gap: "8px", maxWidth: 480, marginLeft: "auto", marginRight: "auto" }}>
        <BackRow
          onBack={() => setView({ level: "month", year: d.getFullYear(), month: d.getMonth() })}
          label={d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }).toLowerCase()}
        />
        {dayEvents.map((e, i) => {
          const thumb = eventThumb(e);
          return (
            <button
              key={i}
              onClick={() => setView({ level: "detail", event: e })}
              className="card-bg-hover rounded-lg flex items-center text-left"
              style={{ padding: "8px 10px", gap: "10px" }}
            >
              <SafeThumb thumb={thumb} icon={eventIcon(e)} />
              <span style={{ flex: 1, minWidth: 0 }}>
                <span className="font-sans text-off-white text-sm block truncate">{eventLabel(e)}</span>
                <span className="font-sans text-gray text-xs">
                  {KIND_LABEL[e.kind]}
                  {e.kind === "activity" ? ` · ${e.startTime}` : ""}
                  {e.kind === "leetcode" ? ` · ${e.difficulty}` : ""}
                  {"status" in e ? ` · ${e.status}` : ""}
                </span>
              </span>
              <Image src={eventIcon(e)} alt="" width={14} height={14} style={{ flexShrink: 0, opacity: 0.7 }} />
            </button>
          );
        })}
        {dayEvents.length === 0 && <p className="font-sans text-gray text-sm italic">nothing on this day</p>}
      </div>
    );
  }

  // ------------------------------------------------------------------ month
  if (view.level === "month") {
    const { year, month } = view;
    const cells = monthCells(year, month);
    return (
      <div style={BREAKOUT}>
        <div className="flex flex-col" style={{ gap: "10px", maxWidth: 720, marginLeft: "auto", marginRight: "auto" }}>
          <BackRow onBack={() => setView({ level: "grid" })} label={`${MONTHS[month]} ${year}`} />
          <div className="grid grid-cols-7 gap-1">
            {DAYS.map((d, i) => (
              <div key={i} className="font-sans text-gray text-xs text-center">{d}</div>
            ))}
            {cells.map((date, i) => {
              const dayEvents = date ? byDate.get(date) ?? [] : [];
              const kinds = [...new Set(dayEvents.map((e) => e.kind))];
              const thumb = dayEvents.map(eventThumb).find(Boolean);
              return (
                <button
                  key={i}
                  onClick={() => date && dayEvents.length > 0 && setView({ level: "day", date })}
                  disabled={!date || dayEvents.length === 0}
                  title={dayEvents.map(eventLabel).join("\n")}
                  className="rounded flex flex-col items-center justify-center"
                  style={{
                    aspectRatio: "1",
                    backgroundColor: date ? "var(--theme-highlight-bg)" : "transparent",
                    position: "relative",
                    overflow: "hidden",
                  }}
                >
                  {thumb && <ThumbBackdrop thumb={thumb} />}
                  {date && (
                    <span className="font-sans text-gray" style={{ fontSize: "0.65rem", position: "absolute", top: 3, left: 5, zIndex: 1 }}>
                      {Number(date.slice(-2))}
                    </span>
                  )}
                  {kinds.length > 0 && (
                    <span className="flex flex-wrap items-center justify-center" style={{ gap: "3px", zIndex: 1, padding: "0 4px" }}>
                      {kinds.slice(0, 4).map((k) => (
                        <Image key={k} src={eventIcon(dayEvents.find((e) => e.kind === k)!)} alt={k} width={14} height={14} />
                      ))}
                    </span>
                  )}
                  {dayEvents.length > 1 && (
                    <span className="font-sans text-gray" style={{ fontSize: "0.6rem", position: "absolute", top: 3, right: 4, zIndex: 1 }}>
                      {dayEvents.length}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          <Legend />
        </div>
      </div>
    );
  }

  // ------------------------------------------------------------------- grid
  return (
    <div style={BREAKOUT}>
      <div className="flex flex-col" style={{ gap: "16px" }}>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {months.map(({ year, month }) => {
            const cells = monthCells(year, month);
            return (
              <div key={`${year}-${month}`}>
                <button
                  onClick={() => setView({ level: "month", year, month })}
                  className="font-sans text-gray text-sm link-highlight"
                  style={{ marginBottom: "6px" }}
                >
                  {MONTHS[month]} {year}
                </button>
                <div className="grid grid-cols-7" style={{ gap: "3px" }}>
                  {cells.map((date, i) => {
                    if (!date) return <div key={`pad-${i}`} style={{ aspectRatio: "1" }} />;
                    const dayEvents = byDate.get(date) ?? [];
                    const kinds = [...new Set(dayEvents.map((e) => e.kind))];
                    const thumb = dayEvents.map(eventThumb).find(Boolean);
                    return (
                      <button
                        key={date}
                        onClick={() => dayEvents.length > 0 && setView({ level: "day", date })}
                        disabled={dayEvents.length === 0}
                        title={dayEvents.length > 0 ? `${date}\n${dayEvents.map(eventLabel).join("\n")}` : date}
                        className="rounded-sm flex items-center justify-center"
                        style={{
                          aspectRatio: "1",
                          backgroundColor: "var(--theme-highlight-bg)",
                          position: "relative",
                          overflow: "hidden",
                        }}
                      >
                        {thumb && <ThumbBackdrop thumb={thumb} blur={1} />}
                        {kinds.length > 0 && (
                          <span className="flex flex-wrap items-center justify-center" style={{ gap: "1px", zIndex: 1 }}>
                            {kinds.slice(0, 2).map((k) => (
                              <Image key={k} src={eventIcon(dayEvents.find((e) => e.kind === k)!)} alt={k} width={10} height={10} />
                            ))}
                          </span>
                        )}
                        {kinds.length > 2 && (
                          <span
                            aria-hidden
                            style={{
                              position: "absolute", bottom: 1, right: 2, zIndex: 1,
                              width: 3, height: 3, borderRadius: "50%",
                              backgroundColor: "var(--theme-text-primary)",
                            }}
                          />
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
        <div className="flex items-center justify-between flex-wrap" style={{ gap: "10px" }}>
          <button
            onClick={() => setMonthCount((c) => Math.min(c + 6, 12))}
            disabled={monthCount >= 12}
            className="font-sans text-gray text-sm link-highlight"
            style={{ opacity: monthCount >= 12 ? 0.4 : 1 }}
          >
            load earlier
          </button>
          <Legend />
        </div>
        {failedSources.length > 0 && (
          <p className="font-sans text-gray text-xs italic">some sources unavailable: {failedSources.join(", ")}</p>
        )}
      </div>
    </div>
  );
}

// symbol key: one entry per kind, always visible so the icons are legible
function Legend() {
  const entries: { icon: string; label: string }[] = [
    { icon: "/icons/activities/run.svg", label: "activity" },
    { icon: "/icons/leetcode.svg", label: "leetcode" },
    { icon: "/icons/github.svg", label: "commits" },
    { icon: "/icons/blog.svg", label: "blog" },
    { icon: "/icons/library.svg", label: "library" },
    { icon: "/icons/photos.svg", label: "photos" },
  ];
  return (
    <div className="flex items-center flex-wrap" style={{ gap: "12px" }}>
      {entries.map((e) => (
        <span key={e.label} className="flex items-center" style={{ gap: "4px" }}>
          <Image src={e.icon} alt="" width={12} height={12} />
          <span className="font-sans text-gray text-xs">{e.label}</span>
        </span>
      ))}
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

// per-kind detail panel. activities lazily enhance with their route + photos
// from the public per-id api; failures degrade to the basic panel quietly.
function EventDetail({ event: e, onBack }: { event: AdminCalendarEvent; onBack: () => void }) {
  const [activityExtra, setActivityExtra] = useState<{
    cardPolyline: string | null;
    photos: { url: string }[];
  } | null>(null);

  useEffect(() => {
    if (e.kind !== "activity") return;
    let cancelled = false;
    fetch(`/api/activities/${e.id}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (!cancelled && body?.activity) {
          setActivityExtra({ cardPolyline: body.activity.cardPolyline ?? null, photos: body.activity.photos ?? [] });
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [e]);

  const thumb = eventThumb(e);

  return (
    <div className="flex flex-col" style={{ gap: "12px" }}>
      <BackRow onBack={onBack} label={e.date} />
      <div className="flex items-center" style={{ gap: "10px" }}>
        <div className="rounded-lg flex items-center justify-center shrink-0" style={{ width: 40, height: 40, border: "1px solid var(--theme-highlight-bg)" }}>
          <Image src={eventIcon(e)} alt="" width={20} height={20} />
        </div>
        <div style={{ minWidth: 0 }}>
          <p className="font-sans text-off-white text-base break-words">{eventLabel(e)}</p>
          <p className="font-sans text-gray text-xs">
            {KIND_LABEL[e.kind]}
            {"status" in e ? ` · ${e.status}` : ""}
            {e.kind === "activity" ? ` · ${e.startTime}` : ""}
            {e.kind === "leetcode" ? ` · ${e.difficulty}` : ""}
          </p>
        </div>
      </div>

      {/* header image for image-carrying entries */}
      {thumb && e.kind !== "activity" && (
        // eslint-disable-next-line @next/next/no-img-element -- optimizer-resized via thumbUrl
        <img
          src={thumbUrl(thumb, 384)}
          alt=""
          onError={(ev) => {
            ev.currentTarget.style.display = "none";
          }}
          className="rounded-lg"
          style={{ maxHeight: 220, objectFit: "cover", width: "100%" }}
        />
      )}

      {/* activity enhancement: route + photos */}
      {e.kind === "activity" && activityExtra?.cardPolyline && (
        <div className="card-bg rounded-lg flex justify-center" style={{ padding: "0.75rem" }}>
          <RouteThumb polyline={activityExtra.cardPolyline} height={90} />
        </div>
      )}
      {e.kind === "activity" && activityExtra && activityExtra.photos.length > 0 && (
        <div className="flex" style={{ gap: "6px", overflowX: "auto" }}>
          {activityExtra.photos.map((p, i) => (
            // eslint-disable-next-line @next/next/no-img-element -- optimizer-resized via thumbUrl
            <img
              key={i}
              src={thumbUrl(p.url, 128)}
              alt=""
              onError={(ev) => {
                ev.currentTarget.style.display = "none";
              }}
              className="rounded"
              style={{ width: 64, height: 64, objectFit: "cover", flexShrink: 0 }}
            />
          ))}
        </div>
      )}

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
              <Link href={`/${e.kind}/${e.slug}`} className="font-sans text-gray text-sm link-highlight">view on site →</Link>
            )}
          </>
        )}
      </div>
    </div>
  );
}
