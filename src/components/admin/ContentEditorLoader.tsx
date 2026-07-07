"use client";

import { useEffect, useState } from "react";
import ContentEditor from "./ContentEditor";

// fetches an existing entry through the session-authed api, then mounts the
// editor. client-side load keeps the auth cookie flow simple.

interface TypeMeta {
  kind: "mdx" | "yaml";
  singleton: boolean;
  hasWip: boolean;
}

const TYPE_META: Record<string, TypeMeta> = {
  blog: { kind: "mdx", singleton: false, hasWip: true },
  library: { kind: "mdx", singleton: false, hasWip: true },
  photos: { kind: "yaml", singleton: false, hasWip: true },
  work: { kind: "mdx", singleton: false, hasWip: false },
  research: { kind: "mdx", singleton: false, hasWip: false },
  teaching: { kind: "mdx", singleton: false, hasWip: false },
  projects: { kind: "mdx", singleton: false, hasWip: false },
  bio: { kind: "mdx", singleton: true, hasWip: false },
  sections: { kind: "yaml", singleton: true, hasWip: false },
  coursework: { kind: "yaml", singleton: true, hasWip: false },
  "hero-quotes": { kind: "yaml", singleton: true, hasWip: false },
};

const VIEW_PATH: Record<string, (slug: string) => string> = {
  blog: (s) => `/blog/${s}`,
  library: (s) => `/library/${s}`,
  photos: (s) => `/photos/${s}`,
};

export default function ContentEditorLoader({ typeId, slug }: { typeId: string; slug: string | null }) {
  const meta = TYPE_META[typeId];
  const isNew = slug === null;
  const [state, setState] = useState<
    | { phase: "loading" }
    | { phase: "error"; message: string }
    | {
        phase: "ready";
        frontmatter: Record<string, unknown>;
        body: string;
        sha: string | null;
        status: "published" | "wip";
        raw: string;
      }
  >(isNew ? { phase: "ready", frontmatter: {}, body: "", sha: null, status: meta?.hasWip ? "wip" : "published", raw: "" } : { phase: "loading" });

  useEffect(() => {
    if (isNew || !meta) return;
    let cancelled = false;
    fetch(`/api/admin/content/${typeId}/${slug}`)
      .then(async (res) => {
        const body = await res.json().catch(() => null);
        if (cancelled) return;
        if (!res.ok || !body?.data) {
          setState({ phase: "error", message: body?.error?.message ?? "load failed" });
          return;
        }
        setState({
          phase: "ready",
          frontmatter: body.data.frontmatter ?? {},
          body: body.data.body ?? "",
          sha: body.data.sha,
          status: body.data.status,
          raw: body.data.raw ?? "",
        });
      })
      .catch(() => {
        if (!cancelled) setState({ phase: "error", message: "github unreachable — try again" });
      });
    return () => {
      cancelled = true;
    };
  }, [typeId, slug, isNew, meta]);

  if (!meta) return <p className="font-sans text-gray text-sm italic">unknown content type</p>;
  if (state.phase === "loading") return <div className="card-bg animate-pulse rounded-lg" style={{ height: 220 }} />;
  if (state.phase === "error") return <p className="font-sans text-gray text-sm italic">{state.message}</p>;

  const isBlocksFormat = typeId === "photos" && state.frontmatter.format === "blocks";

  return (
    <ContentEditor
      typeId={typeId}
      kind={meta.kind}
      singleton={meta.singleton}
      hasWip={meta.hasWip}
      isNew={isNew}
      slug={slug}
      initialFrontmatter={state.frontmatter}
      initialBody={state.body}
      initialSha={state.sha}
      initialStatus={state.status}
      viewPath={slug && VIEW_PATH[typeId] ? VIEW_PATH[typeId](slug) : null}
      rawFallback={isBlocksFormat}
      initialRaw={state.raw}
    />
  );
}
