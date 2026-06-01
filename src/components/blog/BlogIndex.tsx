"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import Image from "next/image";
import type { BlogPost } from "@/lib/blog";

interface Props {
  posts: BlogPost[];
  allTags: string[];
}

function formatDate(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso + "T00:00:00");
  const month = d.toLocaleDateString("en-US", { month: "short" }).toLowerCase();
  return `${month} ${d.getDate()}, ${d.getFullYear()}`;
}

export default function BlogIndex({ posts, allTags }: Props) {
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
    if (activeTags.size === 0) return posts;
    return posts.filter((p) => p.tags.some((t) => activeTags.has(t)));
  }, [posts, activeTags]);

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
            all
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
        <p className="font-sans text-gray text-lg italic">no posts match these tags.</p>
      )}

      <div className="flex flex-col gap-2">
        {filtered.map((post) => (
          <PostRow key={post.slug} post={post} onTagClick={toggleTag} activeTags={activeTags} />
        ))}
      </div>
    </div>
  );
}

interface RowProps {
  post: BlogPost;
  onTagClick: (t: string) => void;
  activeTags: Set<string>;
}

function PostRow({ post, onTagClick, activeTags }: RowProps) {
  return (
    <div className="card-bg rounded-lg" style={{ padding: "1rem 1.25rem" }}>
      <div className="flex items-start gap-4">
        {post.cover && (
          <Link href={`/blog/${post.slug}`} className="shrink-0">
            <Image
              src={post.cover}
              alt={post.title}
              width={88}
              height={88}
              className="rounded-md object-cover"
              style={{ width: 88, height: 88, objectFit: "cover" }}
            />
          </Link>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline justify-between gap-3 flex-wrap">
            <Link
              href={`/blog/${post.slug}`}
              className="font-sans text-off-white text-lg font-bold link-highlight"
            >
              {post.title}
            </Link>
            <span className="font-sans text-gray text-sm shrink-0">{formatDate(post.date)}</span>
          </div>
          {post.summary && (
            <p className="font-sans text-secondary text-base leading-[1.4]" style={{ marginTop: "0.5rem" }}>
              {post.summary}
            </p>
          )}
          {post.tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5" style={{ marginTop: "0.5rem" }}>
              {post.tags.map((tag) => (
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
