"use client";

import { useMemo, useState } from "react";
import { Badge, Button, Card, Cluster, Field, Input, Link, Skeleton, Stack, Text } from "@/design-system";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import FrontmatterForm from "./FrontmatterForm";
import DeployStatus from "./DeployStatus";
import { useLocalDraft } from "./useLocalDraft";

const MdxEditor = dynamic(() => import("./MdxEditorInner"), {
  ssr: false,
  loading: () => <Skeleton height="20rem" />,
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
  // a draft save has no commit to follow; it gets a plain confirmation instead
  const [draftSaved, setDraftSaved] = useState(false);
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
      setCommit(payload.data.commitSha ? { sha: payload.data.commitSha, url: payload.data.commitUrl } : null);
      setDraftSaved(!payload.data.commitSha);
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
      setBaseSha(payload.data.sha ?? baseSha);
      setDraftSaved(false);
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

  const saveLabel = saving ? "saving…" : outage ? "retry save" : status === "wip" ? "save draft" : "save";

  if (props.rawFallback) {
    return (
      <div className="adm-editor">
        <Callout>this essay uses the block format, so it&apos;s edited as raw yaml here. the block editor lives in the photo-essay flow.</Callout>
        <Card
          title="yaml"
          actions={
            <>
              {commit && <DeployStatus commitSha={commit.sha} commitUrl={commit.url} />}
              <Button variant="primary" size="sm" onClick={saveRaw} disabled={saving}>
                {saving ? "saving…" : "save"}
              </Button>
            </>
          }
          padded={false}
        >
          <textarea className="adm-code" value={raw} onChange={(e) => setRaw(e.target.value)} rows={24} spellCheck={false} />
        </Card>
        {message && <Callout tone="danger">{message}</Callout>}
      </div>
    );
  }

  const details = (
    <Card title="details">
      <Stack gap="4">
        {props.isNew && !props.singleton && (
          <Field id="slug" label="url name" hint="used in the address; locked after the first save">
            <Input
              id="slug"
              value={derivedSlug}
              onChange={(e) => {
                setSlugTouched(true);
                setSlug(kebab(e.target.value));
              }}
              className="ds-input adm-mono"
            />
          </Field>
        )}
        <FrontmatterForm typeId={props.typeId} value={frontmatter} onChange={setFrontmatter} uploadPrefix={uploadPrefix} />
      </Stack>
    </Card>
  );

  const publish = (
    <Card title="publish">
      <Stack gap="3">
        {props.hasWip && !props.isNew ? (
          <Cluster gap="2">
            <Text size="sm" tone="muted">
              status
            </Text>
            <Badge tone={status === "published" ? "accent" : "neutral"}>{status === "published" ? "published" : "draft"}</Badge>
          </Cluster>
        ) : null}
        <Button variant="primary" onClick={save} disabled={saving || (props.isNew && !effectiveSlug)}>
          {saveLabel}
        </Button>
        {!props.isNew && props.hasWip && status === "wip" && (
          <Button onClick={() => move("publish")} disabled={saving}>
            publish
          </Button>
        )}
        {!props.isNew && props.hasWip && status === "published" && (
          <Button variant="ghost" onClick={() => move("unpublish")} disabled={saving}>
            move back to drafts
          </Button>
        )}
        {commit && <DeployStatus commitSha={commit.sha} commitUrl={commit.url} />}
        {draftSaved && !commit && (
          <Text size="sm" tone="muted">
            draft saved
          </Text>
        )}
        {!props.isNew && props.viewPath && status === "published" && (
          <Link href={props.viewPath} variant="standalone" tone="muted">
            view on site
          </Link>
        )}
        <Text size="xs" tone="subtle">
          {props.hasWip && status !== "published"
            ? "drafts are private. publishing adds the file to the site's repo; the site redeploys in about a minute."
            : "saving commits this file to github; the site redeploys in about a minute."}
        </Text>
        {!props.isNew && !props.singleton && (
          <div className="adm-danger-zone">
            <Button variant="danger" size="sm" onClick={remove} disabled={saving}>
              delete entry
            </Button>
          </div>
        )}
      </Stack>
    </Card>
  );

  return (
    <div className="adm-editor">
      {restorable && (
        <Callout
          actions={
            <>
              <Button
                size="sm"
                onClick={() => {
                  setFrontmatter(restorable.frontmatter);
                  setBody(restorable.body);
                  dismissRestore();
                }}
              >
                restore
              </Button>
              <Button size="sm" variant="ghost" onClick={() => clearDraft()}>
                discard
              </Button>
            </>
          }
        >
          {`you have unsaved changes on this device from ${new Date(restorable.savedAt).toLocaleString().toLowerCase()}.`}
        </Callout>
      )}

      {conflict && (
        <Callout
          tone="danger"
          actions={
            <>
              <Button
                size="sm"
                onClick={() => {
                  setFrontmatter(conflict.remoteFrontmatter);
                  setBody(conflict.remoteBody);
                  setBaseSha(conflict.remoteSha);
                  setConflict(null);
                }}
              >
                load their version
              </Button>
              <Button
                size="sm"
                variant="danger"
                onClick={() => {
                  setBaseSha(conflict.remoteSha);
                  setConflict(null);
                  save();
                }}
              >
                overwrite with mine
              </Button>
            </>
          }
        >
          this file changed on github since you opened it.
        </Callout>
      )}

      {outage && <Callout tone="danger">github is unreachable. your changes are kept on this device; try saving again.</Callout>}
      {message && <Callout tone="danger">{message}</Callout>}

      {props.kind === "mdx" ? (
        <div className="adm-editor-grid">
          <div className="adm-editor-main">
            <Card
              title="text"
              actions={
                <div className="adm-segmented" role="tablist" aria-label="view">
                  <button type="button" role="tab" aria-selected={!preview} onClick={() => setPreview(false)}>
                    write
                  </button>
                  <button type="button" role="tab" aria-selected={preview} onClick={() => setPreview(true)}>
                    preview
                  </button>
                </div>
              }
              padded={false}
            >
              {preview ? (
                <div className="adm-pad">
                  <MdxPreview markdown={body} />
                </div>
              ) : (
                <MdxEditor markdown={body} onChange={setBody} uploadPrefix={uploadPrefix} />
              )}
            </Card>
          </div>
          <aside className="adm-editor-side">
            {publish}
            {/* the bio is text only: no fields to show */}
            {props.singleton ? null : details}
          </aside>
        </div>
      ) : (
        <div className="adm-editor-grid">
          <div className="adm-editor-main">{details}</div>
          <aside className="adm-editor-side">{publish}</aside>
        </div>
      )}
    </div>
  );
}

// a one-line notice above the editor, with optional actions
function Callout({ tone, actions, children }: { tone?: "danger"; actions?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="adm-callout" data-tone={tone} role={tone === "danger" ? "alert" : "status"}>
      <span>{children}</span>
      {actions ? <span className="adm-callout-actions">{actions}</span> : null}
    </div>
  );
}
