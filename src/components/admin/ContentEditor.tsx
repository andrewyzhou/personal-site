"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import FrontmatterForm from "./FrontmatterForm";
import DeployStatus from "./DeployStatus";
import { useLocalDraft } from "./useLocalDraft";

const MdxEditor = dynamic(() => import("./MdxEditorInner"), {
  ssr: false,
  loading: () => <div className="card-bg animate-pulse rounded-lg" style={{ height: 220 }} />,
});
const MdxPreview = dynamic(() => import("./MdxPreview"), { ssr: false });

interface EditorProps {
  typeId: string;
  kind: "mdx" | "yaml";
  singleton: boolean;
  hasWip: boolean;
  isNew: boolean;
  slug: string | null;
  initialFrontmatter: Record<string, unknown>;
  initialBody: string;
  initialSha: string | null;
  initialStatus: "published" | "wip";
  viewPath: string | null; // public url when published
  rawFallback?: boolean; // block-format photosets: edit raw yaml
  initialRaw?: string;
}

interface Conflict {
  remoteSha: string;
  remoteFrontmatter: Record<string, unknown>;
  remoteBody: string;
}

function kebab(v: string): string {
  return v.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export default function ContentEditor(props: EditorProps) {
  const router = useRouter();
  const [slug, setSlug] = useState(props.slug ?? "");
  const [slugTouched, setSlugTouched] = useState(!props.isNew);
  const [frontmatter, setFrontmatter] = useState(props.initialFrontmatter);
  const [body, setBody] = useState(props.initialBody);
  const [raw, setRaw] = useState(props.initialRaw ?? "");
  const [baseSha, setBaseSha] = useState(props.initialSha);
  const [status, setStatus] = useState(props.initialStatus);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [outage, setOutage] = useState(false);
  const [commit, setCommit] = useState<{ sha: string; url: string } | null>(null);
  const [preview, setPreview] = useState(false);

  const { restorable, clearDraft, dismissRestore } = useLocalDraft(
    props.typeId,
    props.isNew ? null : slug,
    frontmatter,
    body,
    baseSha
  );

  // auto-derive slug from title until first manual edit / first save
  const title = typeof frontmatter.title === "string" ? frontmatter.title : "";
  const derivedSlug = props.isNew && !slugTouched && title ? kebab(title) : slug;
  const effectiveSlug = props.isNew ? derivedSlug : slug;

  const uploadPrefix = useMemo(
    () => `content/${props.typeId}/${effectiveSlug || "new"}`,
    [props.typeId, effectiveSlug]
  );

  async function save() {
    setSaving(true);
    setMessage(null);
    setOutage(false);
    try {
      let res: Response;
      if (props.isNew) {
        res = await fetch(`/api/admin/content/${props.typeId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ slug: effectiveSlug, frontmatter, body, wip: props.hasWip }),
        });
      } else {
        res = await fetch(`/api/admin/content/${props.typeId}/${props.singleton ? props.typeId : slug}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ frontmatter, body, baseSha }),
        });
      }
      const payload = await res.json().catch(() => null);

      if (res.status === 409 && payload?.error?.details?.remoteSha) {
        setConflict(payload.error.details as Conflict);
        return;
      }
      if (res.status === 502) {
        setOutage(true);
        return;
      }
      if (!res.ok || !payload?.data) {
        setMessage(payload?.error?.message ?? "save failed");
        return;
      }

      setBaseSha(payload.data.sha ?? null);
      setCommit({ sha: payload.data.commitSha, url: payload.data.commitUrl });
      clearDraft();
      setMessage(null);
      if (props.isNew) {
        router.replace(`/admin/content/${props.typeId}/${effectiveSlug}`);
      }
    } catch {
      setOutage(true);
    } finally {
      setSaving(false);
    }
  }

  async function saveRaw() {
    // raw fallback path: PUT the yaml through the same endpoint with parsed data
    setSaving(true);
    setMessage(null);
    try {
      const yaml = (await import("js-yaml")).load(raw);
      const fm = (typeof yaml === "object" && yaml !== null && !Array.isArray(yaml) ? yaml : { value: yaml }) as Record<string, unknown>;
      const res = await fetch(`/api/admin/content/${props.typeId}/${slug}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ frontmatter: fm, body: "", baseSha }),
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok || !payload?.data) {
        setMessage(payload?.error?.message ?? "save failed");
        return;
      }
      setBaseSha(payload.data.sha);
      setCommit({ sha: payload.data.commitSha, url: payload.data.commitUrl });
    } catch (e) {
      setMessage(`invalid yaml: ${(e as Error).message.slice(0, 120)}`);
    } finally {
      setSaving(false);
    }
  }

  async function move(direction: "publish" | "unpublish") {
    if (!baseSha) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/content/${props.typeId}/${slug}/move`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ direction, baseSha }),
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok || !payload?.data) {
        setMessage(payload?.error?.message ?? `${direction} failed`);
        return;
      }
      setStatus(direction === "publish" ? "published" : "wip");
      setCommit({ sha: payload.data.commitSha, url: payload.data.commitUrl });
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!baseSha) return;
    if (!confirm(`delete this ${props.typeId} entry? this commits a deletion to github.`)) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/content/${props.typeId}/${slug}?sha=${baseSha}`, { method: "DELETE" });
      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        setMessage(payload?.error?.message ?? "delete failed");
        return;
      }
      clearDraft();
      router.push(`/admin/content`);
    } finally {
      setSaving(false);
    }
  }

  if (props.rawFallback) {
    return (
      <div className="admin-cms flex flex-col" style={{ gap: "12px" }}>
        <p className="font-sans text-gray text-sm italic">
          this essay uses the block format — editing raw yaml (the block editor lives in the photo-essay flow)
        </p>
        <textarea value={raw} onChange={(e) => setRaw(e.target.value)} rows={24} style={{ fontFamily: "ui-monospace, monospace" }} />
        {message && <p className="font-sans text-gray text-sm italic">{message}</p>}
        <div className="flex items-center" style={{ gap: "12px" }}>
          <button onClick={saveRaw} disabled={saving} className="card-bg rounded-lg font-sans text-off-white text-lg" style={{ padding: "10px 20px" }}>
            {saving ? "saving…" : "save"}
          </button>
          {commit && <DeployStatus commitSha={commit.sha} commitUrl={commit.url} />}
        </div>
      </div>
    );
  }

  return (
    <div className="admin-cms flex flex-col" style={{ gap: "16px" }}>
      {restorable && (
        <div className="card-bg rounded-lg flex items-center justify-between" style={{ padding: "10px 14px", gap: "8px" }}>
          <span className="font-sans text-gray text-sm">
            restore local draft from {new Date(restorable.savedAt).toLocaleString().toLowerCase()}?
          </span>
          <span className="flex" style={{ gap: "12px" }}>
            <button
              onClick={() => {
                setFrontmatter(restorable.frontmatter);
                setBody(restorable.body);
                dismissRestore();
              }}
              className="font-sans text-off-white text-sm link-highlight"
            >
              restore
            </button>
            <button onClick={() => { clearDraft(); }} className="font-sans text-gray text-sm link-highlight">
              discard
            </button>
          </span>
        </div>
      )}

      {conflict && (
        <div className="card-bg rounded-lg" style={{ padding: "10px 14px" }}>
          <p className="font-sans text-gray text-sm" style={{ marginBottom: "6px" }}>
            this file changed on github since you opened it.
          </p>
          <span className="flex" style={{ gap: "12px" }}>
            <button
              onClick={() => {
                setFrontmatter(conflict.remoteFrontmatter);
                setBody(conflict.remoteBody);
                setBaseSha(conflict.remoteSha);
                setConflict(null);
              }}
              className="font-sans text-off-white text-sm link-highlight"
            >
              reload remote
            </button>
            <button
              onClick={() => {
                setBaseSha(conflict.remoteSha);
                setConflict(null);
                save();
              }}
              className="font-sans text-gray text-sm link-highlight"
            >
              overwrite
            </button>
          </span>
        </div>
      )}

      {outage && (
        <p className="font-sans text-gray text-sm italic">github unreachable — your draft is saved on this device.</p>
      )}

      {props.isNew && !props.singleton && (
        <div className="flex flex-col" style={{ gap: "4px" }}>
          <label className="font-sans">slug (url name — locked after first save)</label>
          <input
            type="text"
            value={derivedSlug}
            onChange={(e) => {
              setSlugTouched(true);
              setSlug(kebab(e.target.value));
            }}
            style={{ fontFamily: "ui-monospace, monospace" }}
          />
        </div>
      )}

      <FrontmatterForm typeId={props.typeId} value={frontmatter} onChange={setFrontmatter} uploadPrefix={uploadPrefix} />

      {props.kind === "mdx" && (
        <div className="flex flex-col" style={{ gap: "8px" }}>
          <div className="flex items-center justify-between">
            <label className="font-sans">body</label>
            <button
              onClick={() => setPreview((p) => !p)}
              className={`font-sans text-sm ${preview ? "text-off-white link-highlight-active" : "text-gray link-highlight"}`}
            >
              preview
            </button>
          </div>
          {preview ? <MdxPreview markdown={body} /> : <MdxEditor markdown={body} onChange={setBody} uploadPrefix={uploadPrefix} />}
        </div>
      )}

      {message && <p className="font-sans text-gray text-sm italic">⚠ {message}</p>}

      <div className="flex items-center flex-wrap" style={{ gap: "12px" }}>
        <button
          onClick={outage ? save : save}
          disabled={saving || (props.isNew && !effectiveSlug)}
          className="card-bg rounded-lg font-sans text-off-white text-lg"
          style={{ padding: "10px 20px" }}
        >
          {saving ? "saving…" : outage ? "retry" : status === "wip" ? "save draft" : "save"}
        </button>
        {!props.isNew && props.hasWip && status === "wip" && (
          <button onClick={() => move("publish")} disabled={saving} className="font-sans text-off-white text-sm link-highlight">
            publish
          </button>
        )}
        {!props.isNew && props.hasWip && status === "published" && (
          <button onClick={() => move("unpublish")} disabled={saving} className="font-sans text-gray text-sm link-highlight">
            unpublish
          </button>
        )}
        {!props.isNew && props.viewPath && status === "published" && (
          <Link href={props.viewPath} className="font-sans text-gray text-sm link-highlight">
            view on site →
          </Link>
        )}
        {commit && <DeployStatus commitSha={commit.sha} commitUrl={commit.url} />}
        {!props.isNew && !props.singleton && (
          <button onClick={remove} disabled={saving} className="font-sans text-gray text-sm link-highlight" style={{ marginLeft: "auto" }}>
            delete
          </button>
        )}
      </div>
    </div>
  );
}
