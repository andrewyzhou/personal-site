"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

const COLLECTIONS = ["blog", "library", "photos", "work", "research", "teaching", "projects"] as const;
const SINGLETONS = [
  { id: "bio", label: "bio" },
  { id: "sections", label: "sections" },
  { id: "coursework", label: "coursework" },
  { id: "hero-quotes", label: "hero quotes" },
];

interface Item {
  slug: string;
  status: "published" | "wip";
  path: string;
  sha: string;
  frontmatter: Record<string, unknown>;
}

const VIEW_PATH: Record<string, (slug: string) => string> = {
  blog: (s) => `/blog/${s}`,
  library: (s) => `/library/${s}`,
  photos: (s) => `/photos/${s}`,
};

export default function ContentBrowser() {
  const [type, setType] = useState<string>("blog");
  const [items, setItems] = useState<Item[] | null>(null);
  const [stale, setStale] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<"newest" | "az">("newest");

  useEffect(() => {
    let cancelled = false;
    setItems(null);
    setError(null);
    fetch(`/api/admin/content/${type}`)
      .then(async (res) => {
        const body = await res.json().catch(() => null);
        if (cancelled) return;
        if (!res.ok || !body?.data) {
          setError(body?.error?.message ?? "list failed");
          setItems([]);
          return;
        }
        setItems(body.data);
        setStale(body.stale === true);
      })
      .catch(() => {
        if (!cancelled) {
          setError("github unreachable");
          setItems([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [type]);

  const filtered = useMemo(() => {
    if (!items) return [];
    const q = search.trim().toLowerCase();
    let out = items;
    if (q) {
      out = out.filter((i) => {
        const fm = i.frontmatter;
        const hay = [i.slug, fm.title, fm.creator, fm.company, ...(Array.isArray(fm.tags) ? fm.tags : [])]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return hay.includes(q);
      });
    }
    return out.slice().sort((a, b) => {
      if (sort === "az") {
        return String(a.frontmatter.title ?? a.slug).localeCompare(String(b.frontmatter.title ?? b.slug));
      }
      const da = String(a.frontmatter.date ?? a.frontmatter.dateCompleted ?? a.frontmatter.dateStarted ?? "");
      const db = String(b.frontmatter.date ?? b.frontmatter.dateCompleted ?? b.frontmatter.dateStarted ?? "");
      return db.localeCompare(da);
    });
  }, [items, search, sort]);

  return (
    <div className="admin-cms flex flex-col" style={{ gap: "14px" }}>
      <div className="flex flex-wrap" style={{ gap: "6px" }}>
        {COLLECTIONS.map((t) => (
          <button
            key={t}
            onClick={() => setType(t)}
            className={`font-sans text-sm ${type === t ? "text-off-white link-highlight-active" : "text-gray link-highlight"}`}
            style={{ padding: "2px 6px" }}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="flex items-center" style={{ gap: "8px" }}>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="search…"
          style={{ flex: 1 }}
        />
        <button
          onClick={() => setSort(sort === "newest" ? "az" : "newest")}
          className="font-sans text-gray text-sm link-highlight"
          style={{ flexShrink: 0 }}
        >
          {sort === "newest" ? "newest" : "a–z"}
        </button>
        <Link href={`/admin/content/${type}/new`} className="font-sans text-off-white text-sm link-highlight" style={{ flexShrink: 0 }}>
          + new
        </Link>
      </div>

      {stale && <p className="font-sans text-gray text-xs italic">github unreachable — showing cached list</p>}
      {error && <p className="font-sans text-gray text-sm italic">{error}</p>}

      {items === null ? (
        <div className="card-bg animate-pulse rounded-lg" style={{ height: 120 }} />
      ) : (
        <div className="flex flex-col" style={{ gap: "6px" }}>
          {filtered.map((item) => {
            const fm = item.frontmatter;
            const date = String(fm.date ?? fm.dateCompleted ?? fm.dateStarted ?? "");
            const view = VIEW_PATH[type]?.(item.slug);
            return (
              <div key={item.path} className="card-bg-hover rounded-lg flex items-center" style={{ padding: "8px 12px", gap: "8px" }}>
                <Link href={`/admin/content/${type}/${item.slug}`} style={{ flex: 1, minWidth: 0 }}>
                  <span className="font-sans text-off-white text-sm block truncate">
                    {String(fm.title ?? item.slug)}
                    {item.status === "wip" && (
                      <span className="text-gray link-highlight rounded" style={{ fontSize: "0.7rem", padding: "1px 5px", marginLeft: "8px" }}>
                        wip
                      </span>
                    )}
                  </span>
                  <span className="font-sans text-gray text-xs">{date || item.slug}</span>
                </Link>
                {view && item.status === "published" && (
                  <Link href={view} className="font-sans text-gray text-xs link-highlight" style={{ flexShrink: 0 }}>
                    view →
                  </Link>
                )}
              </div>
            );
          })}
          {filtered.length === 0 && <p className="font-sans text-gray text-sm italic">nothing here yet</p>}
        </div>
      )}

      <div style={{ marginTop: "0.5rem" }}>
        <p className="font-sans text-gray text-xs" style={{ marginBottom: "4px" }}>site</p>
        <div className="flex flex-wrap" style={{ gap: "10px" }}>
          {SINGLETONS.map((sg) => (
            <Link key={sg.id} href={`/admin/content/${sg.id}/${sg.id}`} className="font-sans text-gray text-sm link-highlight">
              {sg.label}
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
