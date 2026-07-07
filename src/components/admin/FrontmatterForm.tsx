"use client";

import { useState } from "react";
import { TextField, DateField, TextareaField, SelectField, NumberField, CheckboxField, TagInput, Field } from "./fields";
import { prepareImage } from "@/lib/client/image";

type FM = Record<string, unknown>;

interface FormProps {
  typeId: string;
  value: FM;
  onChange: (v: FM) => void;
  uploadPrefix: string;
}

const s = (v: unknown): string => (typeof v === "string" ? v : "");
const n = (v: unknown): number | "" => (typeof v === "number" ? v : "");
const arr = (v: unknown): string[] => (Array.isArray(v) ? (v as string[]) : []);

export default function FrontmatterForm({ typeId, value, onChange, uploadPrefix }: FormProps) {
  const set = (key: string, v: unknown) => onChange({ ...value, [key]: v });

  switch (typeId) {
    case "blog":
      return (
        <div className="flex flex-col" style={{ gap: "12px" }}>
          <TextField label="title" value={s(value.title)} onChange={(v) => set("title", v)} />
          <DateField label="date" value={s(value.date)} onChange={(v) => set("date", v)} />
          <TextareaField label="summary" value={s(value.summary)} onChange={(v) => set("summary", v)} />
          <TagInput label="tags" value={arr(value.tags)} onChange={(v) => set("tags", v)} />
          <CoverField label="cover (optional)" value={s(value.cover)} onChange={(v) => set("cover", v)} uploadPrefix={uploadPrefix} />
          <CheckboxField label="pinned (sorts first everywhere)" checked={value.pinned === true} onChange={(v) => set("pinned", v)} />
        </div>
      );

    case "library":
      return (
        <div className="flex flex-col" style={{ gap: "12px" }}>
          <TextField label="title" value={s(value.title)} onChange={(v) => set("title", v)} />
          <TextField label="creator" value={s(value.creator)} onChange={(v) => set("creator", v)} />
          <SelectField
            label="type"
            value={s(value.type) || "book"}
            onChange={(v) => set("type", v)}
            options={["book", "video", "podcast", "course", "article"].map((t) => ({ value: t, label: t }))}
          />
          <TextField label="source url (optional)" value={s(value.sourceUrl)} onChange={(v) => set("sourceUrl", v)} />
          <DateField label="date started (optional)" value={s(value.dateStarted)} onChange={(v) => set("dateStarted", v)} />
          <DateField label="date completed (optional — setting this marks the entry completed)" value={s(value.dateCompleted)} onChange={(v) => set("dateCompleted", v)} />
          <NumberField label="rating (0–5, optional)" value={n(value.rating)} onChange={(v) => set("rating", v === "" ? undefined : v)} step={0.5} min={0} max={5} />
          <TagInput label="tags" value={arr(value.tags)} onChange={(v) => set("tags", v)} />
          <TextareaField label="summary" value={s(value.summary)} onChange={(v) => set("summary", v)} />
        </div>
      );

    case "photos":
      return (
        <div className="flex flex-col" style={{ gap: "12px" }}>
          <TextField label="title" value={s(value.title)} onChange={(v) => set("title", v)} />
          <DateField label="date" value={s(value.date)} onChange={(v) => set("date", v)} />
          <TextareaField label="caption" value={s(value.caption)} onChange={(v) => set("caption", v)} />
          <TextField label="cover (filename inside public/photos/<slug>/)" value={s(value.cover)} onChange={(v) => set("cover", v)} mono />
          <StringListField label="photos (ordered filenames)" value={arr(value.photos)} onChange={(v) => set("photos", v)} />
          <p className="font-sans text-gray text-xs italic">
            this form edits classic photosets (files in public/photos/). block-format essays are edited with the blocks editor.
          </p>
        </div>
      );

    case "work":
    case "research":
    case "teaching":
    case "projects":
      return (
        <div className="flex flex-col" style={{ gap: "12px" }}>
          <NumberField label="order (lower sorts first)" value={n(value.order)} onChange={(v) => set("order", v === "" ? undefined : v)} />
          <TextField label="title" value={s(value.title)} onChange={(v) => set("title", v)} />
          <TextField label="company" value={s(value.company)} onChange={(v) => set("company", v)} />
          <TextField label="company url (optional)" value={s(value.companyUrl)} onChange={(v) => set("companyUrl", v)} />
          <TextField label="location (optional)" value={s(value.location)} onChange={(v) => set("location", v)} />
          <TextField label="period (optional, e.g. may 2026 – aug 2026)" value={s(value.period)} onChange={(v) => set("period", v)} />
          <TextField label="year (text, e.g. 2026)" value={s(value.year)} onChange={(v) => set("year", v)} />
          <p className="font-sans text-gray text-xs italic">note: experience items have no draft state — saves go live on the next rebuild.</p>
        </div>
      );

    case "sections": {
      const keys = ["work", "research", "teaching", "projects", "library", "blog", "photos", "coursework"];
      return (
        <div className="flex flex-col" style={{ gap: "12px" }}>
          {keys.map((k) => (
            <TextareaField key={k} label={`${k} (leave empty to hide the blurb)`} value={s(value[k])} onChange={(v) => set(k, v)} rows={2} />
          ))}
        </div>
      );
    }

    case "hero-quotes": {
      const quotes = (Array.isArray(value.value) ? value.value : []) as { text?: string; attribution?: string }[];
      const setQuotes = (q: unknown[]) => onChange({ ...value, value: q });
      return (
        <RepeaterField
          label="quotes"
          items={quotes}
          onChange={setQuotes}
          makeNew={() => ({ text: "", attribution: "" })}
          render={(q, update) => (
            <div className="flex flex-col" style={{ gap: "8px", flex: 1 }}>
              <TextareaField label="text" value={s(q.text)} onChange={(v) => update({ ...q, text: v })} rows={2} />
              <TextField label="attribution" value={s(q.attribution)} onChange={(v) => update({ ...q, attribution: v })} />
            </div>
          )}
        />
      );
    }

    case "coursework": {
      const semesters = (Array.isArray(value.value) ? value.value : []) as {
        name?: string;
        courses?: { code?: string; title?: string; cheatsheets?: { label?: string; url?: string }[] }[];
      }[];
      const setSemesters = (sem: unknown[]) => onChange({ ...value, value: sem });
      return (
        <RepeaterField
          label="semesters (a trailing * on a course title marks external-accredited)"
          items={semesters}
          onChange={setSemesters}
          makeNew={() => ({ name: "", courses: [] })}
          render={(sem, update) => (
            <div className="flex flex-col card-bg rounded-lg" style={{ gap: "8px", flex: 1, padding: "10px" }}>
              <TextField label="semester name" value={s(sem.name)} onChange={(v) => update({ ...sem, name: v })} />
              <RepeaterField
                label="courses"
                items={sem.courses ?? []}
                onChange={(courses) => update({ ...sem, courses: courses as typeof sem.courses })}
                makeNew={() => ({ code: "", title: "" })}
                render={(c, updateCourse) => (
                  <div className="flex flex-col" style={{ gap: "6px", flex: 1 }}>
                    <div className="flex" style={{ gap: "8px" }}>
                      <TextField label="code" value={s(c.code)} onChange={(v) => updateCourse({ ...c, code: v })} />
                      <TextField label="title" value={s(c.title)} onChange={(v) => updateCourse({ ...c, title: v })} />
                    </div>
                    <RepeaterField
                      label="cheatsheets"
                      items={c.cheatsheets ?? []}
                      onChange={(cs) => updateCourse({ ...c, cheatsheets: cs.length > 0 ? (cs as typeof c.cheatsheets) : undefined })}
                      makeNew={() => ({ label: "", url: "" })}
                      render={(cs, updateCs) => (
                        <div className="flex" style={{ gap: "8px", flex: 1 }}>
                          <TextField label="label" value={s(cs.label)} onChange={(v) => updateCs({ ...cs, label: v })} />
                          <TextField label="url" value={s(cs.url)} onChange={(v) => updateCs({ ...cs, url: v })} mono />
                        </div>
                      )}
                    />
                  </div>
                )}
              />
            </div>
          )}
        />
      );
    }

    default:
      return null; // bio: body-only
  }
}

// ---------------------------------------------------------------------------

function StringListField({ label, value, onChange }: { label: string; value: string[]; onChange: (v: string[]) => void }) {
  return (
    <RepeaterField
      label={label}
      items={value}
      onChange={(v) => onChange(v as string[])}
      makeNew={() => ""}
      render={(item, update) => (
        <input type="text" value={item} onChange={(e) => update(e.target.value)} style={{ flex: 1, fontFamily: "ui-monospace, monospace" }} />
      )}
    />
  );
}

function RepeaterField<T>({
  label, items, onChange, makeNew, render,
}: {
  label: string;
  items: T[];
  onChange: (items: unknown[]) => void;
  makeNew: () => T;
  render: (item: T, update: (v: T) => void) => React.ReactNode;
}) {
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= items.length) return;
    const next = items.slice();
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };

  return (
    <Field label={label}>
      <div className="flex flex-col" style={{ gap: "8px" }}>
        {items.map((item, i) => (
          <div key={i} className="flex items-start" style={{ gap: "6px" }}>
            {render(item, (v) => onChange(items.map((x, j) => (j === i ? v : x))))}
            <div className="flex flex-col" style={{ gap: "2px", flexShrink: 0 }}>
              <button type="button" onClick={() => move(i, -1)} className="font-sans text-gray text-xs link-highlight" aria-label="move up">↑</button>
              <button type="button" onClick={() => move(i, 1)} className="font-sans text-gray text-xs link-highlight" aria-label="move down">↓</button>
              <button type="button" onClick={() => onChange(items.filter((_, j) => j !== i))} className="font-sans text-gray text-xs link-highlight" aria-label="remove">×</button>
            </div>
          </div>
        ))}
        <button type="button" onClick={() => onChange([...items, makeNew()])} className="font-sans text-gray text-sm link-highlight" style={{ alignSelf: "flex-start" }}>
          + add
        </button>
      </div>
    </Field>
  );
}

function CoverField({ label, value, onChange, uploadPrefix }: { label: string; value: string; onChange: (v: string) => void; uploadPrefix: string }) {
  const [status, setStatus] = useState<"idle" | "uploading" | "error">("idle");

  async function upload(file: File) {
    setStatus("uploading");
    try {
      const prepared = await prepareImage(file);
      const form = new FormData();
      form.append("file", prepared.blob, "cover.jpg");
      form.append("prefix", uploadPrefix);
      form.append("width", String(prepared.width));
      form.append("height", String(prepared.height));
      const res = await fetch("/api/admin/upload", { method: "POST", body: form });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.data?.url) throw new Error();
      onChange(body.data.url);
      setStatus("idle");
    } catch {
      setStatus("error");
    }
  }

  return (
    <Field label={label} error={status === "error" ? "upload failed — retry or paste a url" : undefined}>
      <div className="flex items-center" style={{ gap: "8px" }}>
        <input type="text" value={value} onChange={(e) => onChange(e.target.value)} placeholder="/blog/<slug>/cover.jpg or https://…" style={{ flex: 1 }} />
        <label className="font-sans text-gray text-sm link-highlight rounded" style={{ padding: "4px 8px", cursor: "pointer", flexShrink: 0 }}>
          {status === "uploading" ? "uploading…" : "upload"}
          <input type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
        </label>
      </div>
    </Field>
  );
}
