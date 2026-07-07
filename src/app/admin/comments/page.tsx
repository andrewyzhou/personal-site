"use client";

import { useEffect, useState } from "react";

interface CommentRow {
  id: number;
  targetType: string;
  targetSlug: string;
  authorName: string;
  authorEmail: string | null;
  isGuest: boolean;
  body: string;
  hidden: boolean;
  createdAt: string;
}

export default function AdminCommentsPage() {
  const [rows, setRows] = useState<CommentRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    fetch("/api/admin/comments")
      .then(async (res) => {
        const body = await res.json().catch(() => null);
        if (!res.ok || !body?.data) {
          setError(body?.error?.message ?? "load failed");
          setRows([]);
          return;
        }
        setRows(body.data);
      })
      .catch(() => {
        setError("load failed");
        setRows([]);
      });
  };

  useEffect(load, []);

  async function setHidden(id: number, hidden: boolean) {
    await fetch("/api/admin/comments", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, hidden }),
    });
    load();
  }

  async function remove(id: number) {
    if (!confirm("permanently delete this comment?")) return;
    await fetch(`/api/admin/comments?id=${id}`, { method: "DELETE" });
    load();
  }

  if (rows === null) return <div className="card-bg animate-pulse rounded-lg" style={{ height: 120 }} />;

  return (
    <div className="flex flex-col" style={{ gap: "8px" }}>
      <p className="font-sans text-gray text-sm">recent comments ({rows.length})</p>
      {error && <p className="font-sans text-gray text-sm italic">{error}</p>}
      {rows.map((c) => (
        <div key={c.id} className="card-bg rounded-lg" style={{ padding: "10px 12px", opacity: c.hidden ? 0.5 : 1 }}>
          <p className="font-sans text-gray text-xs">
            {c.authorName}
            {c.isGuest ? " (guest)" : ` — ${c.authorEmail}`} · {c.targetType}:{c.targetSlug} ·{" "}
            {new Date(c.createdAt).toLocaleString().toLowerCase()}
            {c.hidden && " · hidden"}
          </p>
          <p className="font-sans text-secondary text-sm" style={{ margin: "4px 0" }}>{c.body}</p>
          <span className="flex" style={{ gap: "12px" }}>
            <button onClick={() => setHidden(c.id, !c.hidden)} className="font-sans text-gray text-xs link-highlight">
              {c.hidden ? "unhide" : "hide"}
            </button>
            <button onClick={() => remove(c.id)} className="font-sans text-gray text-xs link-highlight">
              delete
            </button>
          </span>
        </div>
      ))}
      {rows.length === 0 && !error && <p className="font-sans text-gray text-sm italic">no comments yet</p>}
    </div>
  );
}
