"use client";

import { useEffect, useRef, useState } from "react";

// debounced localstorage drafts: nothing typed in the cms is ever lost to a
// github outage or closed tab. cleared on successful commit.

export interface LocalDraft {
  frontmatter: Record<string, unknown>;
  body: string;
  baseSha: string | null;
  savedAt: number;
}

export function draftKey(type: string, slug: string | null): string {
  return `admin:draft:${type}:${slug ?? "new"}`;
}

export function useLocalDraft(
  type: string,
  slug: string | null,
  frontmatter: Record<string, unknown>,
  body: string,
  baseSha: string | null
) {
  const key = draftKey(type, slug);
  const [restorable, setRestorable] = useState<LocalDraft | null>(null);
  const skipNextWrite = useRef(true);

  // offer restore once on mount if a draft exists and differs
  useEffect(() => {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return;
      const draft = JSON.parse(raw) as LocalDraft;
      if (draft.body !== body || JSON.stringify(draft.frontmatter) !== JSON.stringify(frontmatter)) {
        setRestorable(draft);
      }
    } catch {
      // corrupt draft — ignore
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // debounced write
  useEffect(() => {
    if (skipNextWrite.current) {
      skipNextWrite.current = false;
      return;
    }
    const t = setTimeout(() => {
      try {
        const draft: LocalDraft = { frontmatter, body, baseSha, savedAt: Date.now() };
        localStorage.setItem(key, JSON.stringify(draft));
      } catch {
        // storage full — drafts are best-effort
      }
    }, 2000);
    return () => clearTimeout(t);
  }, [key, frontmatter, body, baseSha]);

  const clearDraft = () => {
    try {
      localStorage.removeItem(key);
    } catch {
      // ignore
    }
    setRestorable(null);
  };

  const dismissRestore = () => setRestorable(null);

  return { restorable, clearDraft, dismissRestore };
}
