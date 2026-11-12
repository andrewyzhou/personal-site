"use client";

import { TYPE_NAMES } from "./type-names";
import { useEffect, useMemo, useState } from "react";
import NextLink from "next/link";
import { Badge, Button, Card, Chip, Cluster, EmptyState, Input, Link, Select, Skeleton, Stack, Table, Text } from "@/design-system";

const COLLECTIONS = ["blog", "library", "screen", "photos", "work", "research", "teaching", "projects"] as const;

const SINGLETONS = [
  { id: "bio", label: "bio", hint: "the about-me text on the home page" },
  { id: "sections", label: "sections", hint: "the blurb under each home tab" },
  { id: "coursework", label: "coursework", hint: "semesters, courses, reviews" },
  { id: "hero-quotes", label: "hero quotes", hint: "the rotating quotes in the hero" },
];

interface Item {
  slug: string;
  status: "published" | "wip";
  path: string;
  sha: string;
  frontmatter: Record<string, unknown>;
}

const VIEW_PATH: Record<string, (slug: string) => string> = {
  blog: (s) => `/writing/${s}`,
  library: (s) => `/library/reading/${s}`,
  screen: (s) => `/library/tv-movies/${s}`,
  photos: (s) => `/library/photos/${s}`,
};

const dateOf = (fm: Record<string, unknown>) => String(fm.date ?? fm.dateCompleted ?? fm.dateStarted ?? "");

// the content list: one collection at a time, searchable, with the site-wide
// singletons (bio, sections, …) in their own card
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
      if (sort === "az") return String(a.frontmatter.title ?? a.slug).localeCompare(String(b.frontmatter.title ?? b.slug));
      return dateOf(b.frontmatter).localeCompare(dateOf(a.frontmatter));
    });
  }, [items, search, sort]);

  return (
    <Stack gap="6">
      <Card
        title={
          <Cluster gap="2">
            {COLLECTIONS.map((t) => (
              <Chip key={t} selected={type === t} onClick={() => setType(t)}>
                {TYPE_NAMES[t] ?? t}
              </Chip>
            ))}
          </Cluster>
        }
        actions={
          <Button href={`/admin/content/${type}/new`} variant="primary" size="sm">
            {`new ${type === "photos" ? "photoset" : type === "library" || type === "screen" ? "entry" : type === "blog" ? "post" : "item"}`}
          </Button>
        }
        padded={false}
      >
        <div className="adm-toolbar">
          <Input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={`search ${type}`} aria-label="search" />
          <Select value={sort} onChange={(e) => setSort(e.target.value as "newest" | "az")} aria-label="sort">
            <option value="newest">newest first</option>
            <option value="az">a–z</option>
          </Select>
        </div>
        {stale ? (
          <div className="adm-note">
            <Text size="xs" tone="muted">
              github is unreachable — showing the last list we had
            </Text>
          </div>
        ) : null}
        {items === null ? (
          <div className="adm-pad">
            <Stack gap="2">
              <Skeleton height="1.25rem" />
              <Skeleton height="1.25rem" />
              <Skeleton height="1.25rem" width="60%" />
            </Stack>
          </div>
        ) : error ? (
          <div className="adm-pad">
            <EmptyState title="couldn't load this list" body={error} />
          </div>
        ) : filtered.length === 0 ? (
          <div className="adm-pad">
            <EmptyState title={search ? "no matches" : "nothing here yet"} />
          </div>
        ) : (
          <div className="adm-table-wrap">
            <Table
              rowKey={(i) => i.path}
              rows={filtered}
              columns={[
                {
                  key: "title",
                  header: "title",
                  cell: (i) => (
                    <NextLink href={`/admin/content/${type}/${i.slug}`} className="adm-row-link">
                      <span>{String(i.frontmatter.title ?? i.slug)}</span>
                      {i.status === "wip" ? <Badge tone="accent">draft</Badge> : null}
                    </NextLink>
                  ),
                },
                { key: "date", header: "date", align: "right", cell: (i) => dateOf(i.frontmatter) || "—" },
                {
                  key: "view",
                  header: "",
                  align: "right",
                  cell: (i) => {
                    const view = VIEW_PATH[type]?.(i.slug);
                    return view && i.status === "published" ? (
                      <Link href={view} variant="standalone" tone="muted">
                        view
                      </Link>
                    ) : null;
                  },
                },
              ]}
            />
          </div>
        )}
      </Card>

      <Card title="site text" padded={false}>
        <ul className="adm-list">
          {SINGLETONS.map((s) => (
            <li key={s.id}>
              <NextLink href={`/admin/content/${s.id}/${s.id}`} className="adm-list-row">
                <span className="adm-list-label">{s.label}</span>
                <span className="adm-list-hint">{s.hint}</span>
              </NextLink>
            </li>
          ))}
        </ul>
      </Card>
    </Stack>
  );
}
