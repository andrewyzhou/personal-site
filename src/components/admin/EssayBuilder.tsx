"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { TextField, DateField, TextareaField, CheckboxField } from "./fields";
import DeployStatus from "./DeployStatus";
import { prepareImage } from "@/lib/client/image";
import { extractMeta, type ExtractedMeta } from "@/lib/client/exif";

// block-format photo essay builder: upload photos (exif extracted before the
// downscale strips it, gps pre-rounded), interleave text blocks, reorder,
// caption, publish as yaml through the cms api.

interface ImageBlockDraft {
  kind: "image";
  key: string;
  status: "working" | "done" | "error";
  previewUrl: string;
  src?: string;
  width?: number;
  height?: number;
  caption: string;
  text: string;
  includeLocation: boolean;
  meta: ExtractedMeta;
}

interface TextBlockDraft {
  kind: "text";
  key: string;
  body: string;
}

type BlockDraft = ImageBlockDraft | TextBlockDraft;

function kebab(v: string): string {
  return v.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export default function EssayBuilder() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [caption, setCaption] = useState("");
  const [blocks, setBlocks] = useState<BlockDraft[]>([]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [commit, setCommit] = useState<{ sha: string; url: string } | null>(null);
  const [savedSlug, setSavedSlug] = useState<string | null>(null);

  const slug = kebab(title);

  async function addImages(files: FileList) {
    for (const file of Array.from(files)) {
      const key = `${file.name}-${Date.now()}-${Math.random()}`;
      const previewUrl = URL.createObjectURL(file);
      const draft: ImageBlockDraft = {
        kind: "image", key, status: "working", previewUrl,
        caption: "", text: "", includeLocation: true, meta: {},
      };
      setBlocks((prev) => [...prev, draft]);
      try {
        // exif first — the re-encode below strips it
        const meta = await extractMeta(file);
        const prepared = await prepareImage(file);
        const form = new FormData();
        form.append("file", prepared.blob, "photo.jpg");
        form.append("prefix", `content/photos/${slug || "essay"}`);
        form.append("width", String(prepared.width));
        form.append("height", String(prepared.height));
        const res = await fetch("/api/admin/upload", { method: "POST", body: form });
        const body = await res.json().catch(() => null);
        if (!res.ok || !body?.data?.url) throw new Error();
        setBlocks((prev) =>
          prev.map((b) =>
            b.key === key
              ? { ...draft, status: "done", src: body.data.url, width: prepared.width, height: prepared.height, meta }
              : b
          )
        );
      } catch {
        setBlocks((prev) => prev.map((b) => (b.key === key ? { ...draft, status: "error" } : b)));
      }
    }
  }

  function updateBlock(key: string, patch: Partial<Omit<ImageBlockDraft, "kind">> | Partial<Omit<TextBlockDraft, "kind">>) {
    setBlocks((prev) => prev.map((b) => (b.key === key ? ({ ...b, ...patch } as BlockDraft) : b)));
  }

  function move(key: string, dir: -1 | 1) {
    setBlocks((prev) => {
      const i = prev.findIndex((b) => b.key === key);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= prev.length) return prev;
      const next = prev.slice();
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }

  async function save() {
    setSaving(true);
    setMessage(null);
    try {
      const yamlBlocks = blocks
        .map((b) => {
          if (b.kind === "text") {
            return b.body.trim() ? { kind: "text", body: b.body.trim() } : null;
          }
          if (b.status !== "done" || !b.src) return null;
          return {
            kind: "image",
            src: b.src,
            width: b.width,
            height: b.height,
            alt: b.caption || title || "photo",
            ...(b.caption ? { caption: b.caption } : {}),
            ...(b.text ? { text: b.text } : {}),
            ...(b.meta.exif ? { exif: b.meta.exif } : {}),
            ...(b.includeLocation && b.meta.gps ? { gps: b.meta.gps } : {}),
            ...(b.meta.takenAt ? { takenAt: b.meta.takenAt } : {}),
          };
        })
        .filter(Boolean);

      if (yamlBlocks.length === 0) {
        setMessage("add at least one photo or text block");
        return;
      }

      const res = await fetch("/api/admin/content/photos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug,
          frontmatter: { format: "blocks", title, date, caption, blocks: yamlBlocks },
          body: "",
          wip: true,
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.data) {
        setMessage(body?.error?.message ?? "save failed");
        return;
      }
      setCommit({ sha: body.data.commitSha, url: body.data.commitUrl });
      setSavedSlug(slug);
    } catch {
      setMessage("save failed — check your connection");
    } finally {
      setSaving(false);
    }
  }

  if (savedSlug) {
    return (
      <div className="admin-cms flex flex-col" style={{ gap: "10px" }}>
        <p className="font-sans text-off-white text-lg">saved as draft</p>
        {commit && <DeployStatus commitSha={commit.sha} commitUrl={commit.url} />}
        <Link href={`/admin/content/photos/${savedSlug}`} className="font-sans text-gray text-sm link-highlight">
          open in editor (publish from there) →
        </Link>
        <button
          onClick={() => router.push("/admin/essays/new")}
          className="font-sans text-gray text-sm link-highlight"
          style={{ alignSelf: "flex-start" }}
        >
          start another
        </button>
      </div>
    );
  }

  return (
    <div className="admin-cms flex flex-col" style={{ gap: "14px" }}>
      <TextField label="title" value={title} onChange={setTitle} />
      <DateField label="date" value={date} onChange={setDate} />
      <TextareaField label="set caption (optional)" value={caption} onChange={setCaption} rows={2} />

      <div className="flex" style={{ gap: "10px" }}>
        <label className="font-sans text-gray text-sm link-highlight rounded" style={{ padding: "4px 10px", cursor: "pointer" }}>
          + add photos
          <input type="file" accept="image/*" multiple hidden onChange={(e) => e.target.files && addImages(e.target.files)} />
        </label>
        <button
          onClick={() => setBlocks((prev) => [...prev, { kind: "text", key: `t-${Date.now()}`, body: "" }])}
          className="font-sans text-gray text-sm link-highlight rounded"
          style={{ padding: "4px 10px" }}
        >
          + add text
        </button>
      </div>

      <div className="flex flex-col" style={{ gap: "12px" }}>
        {blocks.map((b) => (
          <div key={b.key} className="card-bg rounded-lg flex" style={{ padding: "10px", gap: "10px" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              {b.kind === "image" ? (
                <div className="flex flex-col" style={{ gap: "8px" }}>
                  <div className="flex items-center" style={{ gap: "10px" }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={b.previewUrl} alt="" className="rounded" style={{ width: 72, height: 72, objectFit: "cover", opacity: b.status === "done" ? 1 : 0.5 }} />
                    <div className="font-sans text-gray text-xs">
                      {b.status === "working" && "processing…"}
                      {b.status === "error" && "failed — remove and retry"}
                      {b.status === "done" && (
                        <>
                          {b.meta.exif?.camera ?? "no exif"}
                          {b.meta.gps ? ` · ${b.meta.gps.lat}, ${b.meta.gps.lon} (approx)` : " · no location"}
                        </>
                      )}
                    </div>
                  </div>
                  <TextField label="caption" value={b.caption} onChange={(v) => updateBlock(b.key, { caption: v })} />
                  <TextareaField label="paragraph under caption (optional)" value={b.text} onChange={(v) => updateBlock(b.key, { text: v })} rows={2} />
                  {b.meta.gps && (
                    <CheckboxField
                      label="include location (rounded to ~1 km)"
                      checked={b.includeLocation}
                      onChange={(v) => updateBlock(b.key, { includeLocation: v })}
                    />
                  )}
                </div>
              ) : (
                <TextareaField label="text block" value={b.body} onChange={(v) => updateBlock(b.key, { body: v })} rows={3} />
              )}
            </div>
            <div className="flex flex-col" style={{ gap: "4px", flexShrink: 0 }}>
              <button onClick={() => move(b.key, -1)} className="font-sans text-gray text-xs link-highlight" aria-label="move up">↑</button>
              <button onClick={() => move(b.key, 1)} className="font-sans text-gray text-xs link-highlight" aria-label="move down">↓</button>
              <button onClick={() => setBlocks((prev) => prev.filter((x) => x.key !== b.key))} className="font-sans text-gray text-xs link-highlight" aria-label="remove">×</button>
            </div>
          </div>
        ))}
      </div>

      {message && <p className="font-sans text-gray text-sm italic">⚠ {message}</p>}

      <button
        onClick={save}
        disabled={saving || !title || !slug || blocks.some((b) => b.kind === "image" && b.status === "working")}
        className="card-bg rounded-lg font-sans text-off-white text-lg"
        style={{ padding: "12px" }}
      >
        {saving ? "saving…" : "save draft"}
      </button>
    </div>
  );
}
