"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import type { LibraryEntry } from "@/lib/library";
import { useSite } from "@/content/SiteProvider";
import { formatDay } from "@/content/format";
import SourceIcon from "./SourceIcon";
import Rating from "./Rating";

interface Props {
  entries: LibraryEntry[];
  allTags: string[];
}


export default function LibraryIndex({ entries, allTags }: Props) {
  const copy = useSite().pages.library;
  const [activeTags, setActiveTags] = useState<Set<string>>(new Set());
  const [hydrated, setHydrated] = useState(false);

  // read tags from URL on mount
  useEffect(() => {
    setHydrated(true);
    const params = new URLSearchParams(window.location.search);
    const tagParam = params.get("tags");
    if (tagParam) {
      setActiveTags(new Set(tagParam.split(",").filter(Boolean)));
    }
  }, []);

  // sync URL when active tags change
  useEffect(() => {
    if (!hydrated) return;
    const params = new URLSearchParams(window.location.search);
    if (activeTags.size === 0) {
      params.delete("tags");
    } else {
      params.set("tags", Array.from(activeTags).join(","));
    }
    const qs = params.toString();
    const url = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
    window.history.replaceState(null, "", url);
  }, [activeTags, hydrated]);

  const toggleTag = (tag: string) => {
    setActiveTags((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });
  };

  const filtered = useMemo(() => {
    if (activeTags.size === 0) return entries;
    return entries.filter((e) => e.tags.some((t) => activeTags.has(t)));
  }, [entries, activeTags]);

  const inProgress = filtered.filter((e) => e.status === "in-progress");
  const completed = filtered.filter((e) => e.status === "completed");

  return (
    <div>
      {/* tag chips */}
      {allTags.length > 0 && (
        <div className="flex flex-wrap gap-2" style={{ marginBottom: "2rem" }}>
          <button
            onClick={() => setActiveTags(new Set())}
            className={`font-sans text-lg transition-colors ${
              activeTags.size === 0
                ? "text-off-white link-highlight-active"
                : "text-gray link-highlight"
            }`}
          >
            {copy.allTags}
          </button>
          {allTags.map((tag) => (
            <button
              key={tag}
              onClick={() => toggleTag(tag)}
              className={`font-sans text-lg transition-colors ${
                activeTags.has(tag)
                  ? "text-off-white link-highlight-active"
                  : "text-gray link-highlight"
              }`}
            >
              {tag}
            </button>
          ))}
        </div>
      )}

      {filtered.length === 0 && (
        <p className="font-sans text-gray text-lg italic">{copy.noMatch}</p>
      )}

      {inProgress.length > 0 && (
        <Section title={copy.inProgress} entries={inProgress} onTagClick={toggleTag} activeTags={activeTags} />
      )}
      {completed.length > 0 && (
        <Section title={copy.completed} entries={completed} onTagClick={toggleTag} activeTags={activeTags} />
      )}
    </div>
  );
}

interface SectionProps {
  title: string;
  entries: LibraryEntry[];
  onTagClick: (t: string) => void;
  activeTags: Set<string>;
}

function Section({ title, entries, onTagClick, activeTags }: SectionProps) {
  return (
    <div style={{ marginBottom: "2.5rem" }}>
      <h3 className="font-sans text-off-white text-sm uppercase tracking-widest" style={{ marginBottom: "0.75rem", opacity: 0.6 }}>
        {title}
      </h3>
      <div className="flex flex-col gap-2">
        {entries.map((entry) => (
          <EntryRow key={entry.slug} entry={entry} onTagClick={onTagClick} activeTags={activeTags} />
        ))}
      </div>
    </div>
  );
}

interface RowProps {
  entry: LibraryEntry;
  onTagClick: (t: string) => void;
  activeTags: Set<string>;
}

function EntryRow({ entry, onTagClick, activeTags }: RowProps) {
  const copy = useSite().pages.library;
  const dateStr =
    entry.status === "completed"
      ? `${copy.completed} ${formatDay(entry.dateCompleted)}`
      : entry.dateStarted
      ? `${copy.started} ${formatDay(entry.dateStarted)}`
      : "";

  return (
    <div className="card-bg rounded-lg" style={{ padding: "1rem 1.25rem" }}>
      <div className="flex items-start gap-3">
        <div style={{ marginTop: "0.25rem" }}>
          <SourceIcon type={entry.type} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline justify-between gap-3 flex-wrap">
            <Link
              href={`/library/${entry.slug}`}
              className="font-sans text-off-white text-lg font-bold link-highlight"
            >
              {entry.title}
            </Link>
            <Rating value={entry.rating} />
          </div>
          <p className="font-sans text-gray text-sm" style={{ marginTop: "0.125rem" }}>
            {entry.creator}
            {dateStr && <> · {dateStr}</>}
          </p>
          {entry.summary && (
            <p className="font-sans text-secondary text-base leading-[1.4]" style={{ marginTop: "0.5rem" }}>
              {entry.summary}
            </p>
          )}
          {entry.tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5" style={{ marginTop: "0.5rem" }}>
              {entry.tags.map((tag) => (
                <button
                  key={tag}
                  onClick={() => onTagClick(tag)}
                  className={`font-sans text-xs transition-colors ${
                    activeTags.has(tag)
                      ? "text-off-white link-highlight-active"
                      : "text-gray link-highlight"
                  }`}
                >
                  {tag}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
