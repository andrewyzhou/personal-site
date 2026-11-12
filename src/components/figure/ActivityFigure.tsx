"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSite } from "@/content/SiteProvider";
import {
  FIGURE_KINDS,
  MONTHS,
  buildFigure,
  dayLabel,
  figureRanges,
  loudEvents,
  minutesLabel,
  placeLabels,
  quietLevel,
  type FigureDay,
  type FigureEvent,
  type FigureKind,
} from "@/lib/figure";

// one year, one cell per day, everything in one place. workouts and code are
// the quiet gray texture (stronger on bigger days); something written or
// added to the library is a full-contrast mark, and a post carries its title
// above its column. a kind can be isolated, a day opened, the year changed.
// on a phone the grid keeps its cell size and scrolls, starting at today.

const GAP = 3;
// below this column width the grid stops shrinking and scrolls instead
const MIN_COL = 16;
const LABEL_PX = 13;
const ALL: ReadonlySet<FigureKind> = new Set(FIGURE_KINDS);
// the quiet texture: how much of the text colour a day's cell takes, by level.
// it tops out well short of full contrast, which is kept for the marks.
const TINT = [6, 14, 22, 30, 38] as const;
const tint = (level: number) => `color-mix(in oklch, var(--theme-text-primary) ${TINT[level]}%, transparent)`;

interface ApiActivity {
  id: number;
  name: string;
  date: string;
  duration: number;
  href?: string;
}

function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url);
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

export default function ActivityFigure({ marks }: { marks: FigureEvent[] }) {
  const { figure: copy } = useSite();
  const [today, setToday] = useState<string | null>(null);
  const [workouts, setWorkouts] = useState<FigureEvent[]>([]);
  const [problems, setProblems] = useState<FigureEvent[]>([]);
  // contributions per range id, fetched when a range is first shown
  const [contributions, setContributions] = useState<Record<string, FigureEvent[]>>({});
  const [rangeIndex, setRangeIndex] = useState(0);
  const [only, setOnly] = useState<FigureKind | null>(null);
  const [pinned, setPinned] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [colWidth, setColWidth] = useState(20);
  const scroller = useRef<HTMLDivElement>(null);
  const grid = useRef<HTMLDivElement>(null);

  // the grid depends on today's date, so it is drawn after mount (a static
  // page would otherwise bake in the day it was built)
  useEffect(() => {
    setToday(localToday());
    getJson<{ activities?: ApiActivity[]; lifts?: ApiActivity[] }>("/api/activities").then((r) => {
      if (!r) return;
      setWorkouts(
        [...(r.activities ?? []), ...(r.lifts ?? [])].map((a) => ({
          kind: "workouts" as const,
          date: a.date,
          label: a.name,
          href: a.href ?? `/activities/${a.id}`,
          amount: (a.duration ?? 0) / 60,
        })),
      );
    });
    getJson<{ submissions?: { date: string; problemNumber: number; problemTitle: string; url: string }[] }>("/api/github/leetcode").then((r) => {
      if (!r) return;
      setProblems((r.submissions ?? []).map((s) => ({ kind: "code" as const, date: s.date, label: `${s.problemNumber}. ${s.problemTitle}`.toLowerCase(), href: s.url, amount: 1 })));
    });
  }, []);

  const ranges = useMemo(() => {
    if (!today) return [];
    const earliest = [...marks, ...workouts].reduce<string | undefined>((min, e) => (!min || e.date < min ? e.date : min), undefined);
    return figureRanges(today, earliest);
  }, [today, marks, workouts]);
  const range = ranges[Math.min(rangeIndex, Math.max(0, ranges.length - 1))];

  const rangeId = range?.id;
  useEffect(() => {
    if (!rangeId || contributions[rangeId]) return;
    let cancelled = false;
    getJson<{ weeks?: { days: { date: string; count: number }[] }[] }>(rangeId === "past" ? "/api/github" : `/api/github?year=${rangeId}`).then((r) => {
      if (cancelled) return;
      const days = (r?.weeks ?? []).flatMap((w) => w.days).filter((d) => d.count > 0);
      setContributions((c) => ({
        ...c,
        [rangeId]: days.map((d) => ({ kind: "code" as const, date: d.date, label: (d.count === 1 ? copy.contributions.one : copy.contributions.other).replace("{n}", String(d.count)), amount: d.count })),
      }));
    });
    return () => {
      cancelled = true;
    };
  }, [rangeId, contributions, copy.contributions.one, copy.contributions.other]);

  const figure = useMemo(() => {
    if (!range || !today) return null;
    const counted = contributions[range.id] ?? [];
    const countedDays = new Set(counted.map((e) => e.date));
    // a solved problem is already one of that day's contributions: list it, don't count it twice
    const listed = problems.map((p) => (countedDays.has(p.date) ? { ...p, amount: 0 } : p));
    return buildFigure(range, [...marks, ...workouts, ...counted, ...listed], today);
  }, [range, today, marks, workouts, problems, contributions]);

  const visible = useMemo<ReadonlySet<FigureKind>>(() => (only ? new Set([only]) : ALL), [only]);
  const weeks = figure?.weeks.length ?? 53;
  const ready = figure !== null;
  // a grid that includes today opens scrolled to it; an older year opens at january
  const endsNow = !!figure && !!today && figure.range.from <= today && figure.range.to >= today;

  // measure a column so titles can be fitted to the columns they cover
  useEffect(() => {
    const el = grid.current;
    if (!el) return;
    const measure = () => setColWidth((el.clientWidth + GAP) / weeks);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [weeks, ready]);

  useEffect(() => {
    const el = scroller.current;
    if (!el || !ready) return;
    el.scrollLeft = endsNow ? el.scrollWidth : 0;
  }, [rangeId, endsNow, ready]);

  const days = useMemo(() => figure?.weeks.flat().filter((d) => d.inRange) ?? [], [figure]);
  const byDate = useMemo(() => new Map(days.map((d) => [d.date, d])), [days]);
  // with nothing chosen, the strip shows the latest day that has anything
  const latest = useMemo(() => [...days].reverse().find((d) => !d.future && d.events.some((e) => visible.has(e.kind)))?.date ?? null, [days, visible]);
  const shown = byDate.get(hovered ?? pinned ?? "") ?? (latest ? byDate.get(latest) : undefined);

  const labels = useMemo(() => {
    if (!figure) return [];
    const posts = figure.weeks.flatMap((week, w) => week.flatMap((d) => loudEvents(d, "writing", ALL).map((e) => ({ week: w, text: e.label }))));
    return placeLabels(posts, { colsPerChar: (LABEL_PX * 0.55) / colWidth });
  }, [figure, colWidth]);
  const labelRows = labels.reduce((n, l) => Math.max(n, l.row + 1), 0);

  const move = useCallback(
    (from: string, by: number) => {
      const i = days.findIndex((d) => d.date === from);
      const next = days[i + by];
      if (!next) return;
      setPinned(next.date);
      grid.current?.querySelector<HTMLButtonElement>(`[data-day="${next.date}"]`)?.focus();
    },
    [days],
  );

  const columns = { display: "grid", gridTemplateColumns: `repeat(${weeks}, minmax(0, 1fr))`, columnGap: GAP } as const;

  return (
    <div>
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-3" style={{ marginBottom: "1rem" }}>
        <h3 className="font-sans font-bold text-off-white text-3xl">{copy.heading}</h3>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 md:justify-end">
          <div className="flex flex-wrap gap-1">
            {FIGURE_KINDS.map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setOnly(only === k ? null : k)}
                aria-pressed={only === k}
                className={`font-sans text-sm transition-colors inline-flex items-center gap-1.5 ${only === k ? "text-off-white font-medium link-highlight-active" : "text-gray link-highlight"}`}
              >
                <Swatch kind={k} />
                <span>{copy.kinds[k]}</span>
                {figure ? <span style={{ fontVariantNumeric: "tabular-nums" }}>{figure.totals[k].toLocaleString("en-US")}</span> : null}
              </button>
            ))}
          </div>
          {ranges.length > 1 && range ? (
            <div className="flex items-center gap-1 font-sans text-sm text-gray">
              <button type="button" className="link-highlight" aria-label={copy.earlier} disabled={rangeIndex >= ranges.length - 1} onClick={() => { setRangeIndex(rangeIndex + 1); setPinned(null); }} style={{ opacity: rangeIndex >= ranges.length - 1 ? 0.35 : 1 }}>
                ‹
              </button>
              <span className="text-off-white font-medium text-center" style={{ minWidth: "5.5rem" }}>
                {range.id === "past" ? copy.pastYear : range.id}
              </span>
              <button type="button" className="link-highlight" aria-label={copy.later} disabled={rangeIndex === 0} onClick={() => { setRangeIndex(rangeIndex - 1); setPinned(null); }} style={{ opacity: rangeIndex === 0 ? 0.35 : 1 }}>
                ›
              </button>
            </div>
          ) : null}
        </div>
      </div>

      <div ref={scroller} style={{ overflowX: "auto", overflowY: "hidden", paddingBottom: 2 }}>
        <div style={{ minWidth: weeks * MIN_COL - GAP }}>
          {/* months */}
          <div style={{ ...columns, marginBottom: 4 }} aria-hidden="true">
            {(figure?.months ?? []).map((m) => (
              <span key={`${m.month}:${m.week}`} className="font-sans text-gray text-xs" style={{ gridColumn: `${m.week + 1} / span 3`, gridRow: 1, whiteSpace: "nowrap" }}>
                {MONTHS[m.month]}
              </span>
            ))}
            {!figure && <span className="font-sans text-gray text-xs">&nbsp;</span>}
          </div>

          {/* post titles: each ends at its column, with a line down to the grid */}
          {labelRows > 0 && (
            <div style={{ ...columns, gridTemplateRows: `repeat(${labelRows}, ${LABEL_PX + 7}px)`, visibility: visible.has("writing") ? "visible" : "hidden" }} aria-hidden="true">
              {labels.map((l) => (
                <span
                  key={`${l.week}:${l.row}:${l.text}`}
                  className="font-sans text-off-white"
                  style={{
                    gridColumn: `${l.week - l.span + 2} / ${l.week + 2}`,
                    gridRow: `${labelRows - l.row} / ${labelRows + 1}`,
                    fontSize: LABEL_PX,
                    lineHeight: `${LABEL_PX + 5}px`,
                    textAlign: "right",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    paddingRight: 5,
                    marginRight: Math.max(0, (colWidth - GAP) / 2 - 0.5),
                    borderRight: "1px solid var(--theme-text-primary)",
                  }}
                >
                  {l.text}
                </span>
              ))}
            </div>
          )}

          {/* days */}
          <div ref={grid} role="grid" aria-label={copy.heading} style={{ ...columns, gridTemplateRows: "repeat(7, auto)", gridAutoFlow: "column", rowGap: GAP }}>
            {(figure?.weeks ?? PLACEHOLDER).flat().map((d, i) => (
              <Cell
                key={figure ? d.date : i}
                day={d}
                visible={visible}
                selected={!!figure && d.date === (pinned ?? "")}
                tabbable={!!figure && d.date === (pinned ?? latest ?? "")}
                onHover={setHovered}
                onPin={(date) => setPinned(pinned === date ? null : date)}
                onMove={move}
              />
            ))}
          </div>
        </div>
      </div>

      {/* what happened on the day in view */}
      <p className="font-sans text-gray text-sm leading-[1.5]" style={{ marginTop: "0.75rem", minHeight: "3em" }} aria-live="polite">
        {shown ? (
          <>
            <span className="text-off-white font-semibold">{dayLabel(shown.date)}</span>
            {(() => {
              const events = FIGURE_KINDS.flatMap((k) => (visible.has(k) ? shown.events.filter((e) => e.kind === k) : []));
              if (events.length === 0) return <span>{` · ${copy.nothing}`}</span>;
              return events.map((e, i) => {
                const text = e.kind === "workouts" && e.amount ? `${e.label.toLowerCase()} ${minutesLabel(e.amount)}` : e.kind === "workouts" ? e.label.toLowerCase() : e.label;
                return (
                  <span key={`${e.kind}:${i}:${e.label}`}>
                    {" · "}
                    {e.href ? (
                      e.href.startsWith("/") ? (
                        <Link href={e.href} className="link-highlight">
                          {text}
                        </Link>
                      ) : (
                        <a href={e.href} target="_blank" rel="noopener noreferrer" className="link-highlight">
                          {text}
                        </a>
                      )
                    ) : (
                      text
                    )}
                  </span>
                );
              });
            })()}
          </>
        ) : figure ? (
          copy.nothing
        ) : (
          copy.loading
        )}
      </p>
    </div>
  );
}

// before the date is known: a blank year, so the page doesn't jump
const PLACEHOLDER: FigureDay[][] = Array.from({ length: 53 }, () => Array.from({ length: 7 }, () => ({ date: "", inRange: true, future: true, events: [], workouts: 0 as const, code: 0 as const })));

function Swatch({ kind }: { kind: FigureKind }) {
  const base = { display: "inline-block", width: 9, height: 9, flexShrink: 0 } as const;
  if (kind === "writing") return <span aria-hidden="true" style={{ ...base, borderRadius: 2, background: "var(--theme-text-primary)" }} />;
  if (kind === "library")
    return (
      <span aria-hidden="true" style={{ ...base, borderRadius: 2, position: "relative", background: tint(0) }}>
        <span style={{ position: "absolute", inset: "22%", borderRadius: "50%", background: "var(--theme-text-primary)" }} />
      </span>
    );
  return <span aria-hidden="true" style={{ ...base, borderRadius: 2, background: tint(3) }} />;
}

function Cell({
  day,
  visible,
  selected,
  tabbable,
  onHover,
  onPin,
  onMove,
}: {
  day: FigureDay;
  visible: ReadonlySet<FigureKind>;
  selected: boolean;
  tabbable: boolean;
  onHover: (date: string | null) => void;
  onPin: (date: string) => void;
  onMove: (from: string, by: number) => void;
}) {
  if (!day.inRange) return <span aria-hidden="true" style={{ aspectRatio: "1 / 1" }} />;
  const wrote = loudEvents(day, "writing", visible).length > 0;
  const added = loudEvents(day, "library", visible).length > 0;
  const level = quietLevel(day, visible);
  const count = day.events.filter((e) => visible.has(e.kind)).length;
  const blank = day.date === "";

  return (
    <button
      type="button"
      role="gridcell"
      data-day={day.date}
      tabIndex={tabbable ? 0 : -1}
      disabled={blank}
      aria-label={blank ? undefined : `${dayLabel(day.date)}: ${count}`}
      aria-selected={selected}
      onMouseEnter={() => !blank && onHover(day.date)}
      onMouseLeave={() => onHover(null)}
      onFocus={() => !blank && onHover(day.date)}
      onBlur={() => onHover(null)}
      onClick={() => onPin(day.date)}
      onKeyDown={(e) => {
        const by = { ArrowLeft: -7, ArrowRight: 7, ArrowUp: -1, ArrowDown: 1 }[e.key];
        if (by === undefined) return;
        e.preventDefault();
        onMove(day.date, by);
      }}
      style={{
        aspectRatio: "1 / 1",
        position: "relative",
        padding: 0,
        border: 0,
        borderRadius: 3,
        cursor: blank ? "default" : "pointer",
        opacity: day.future ? 0.45 : 1,
        background: wrote ? "var(--theme-text-primary)" : tint(level),
        outline: selected ? "2px solid var(--theme-text-primary)" : undefined,
        outlineOffset: 1,
      }}
    >
      {added && <span aria-hidden="true" style={{ position: "absolute", inset: "24%", borderRadius: "50%", background: wrote ? "var(--theme-bg)" : "var(--theme-text-primary)" }} />}
    </button>
  );
}
