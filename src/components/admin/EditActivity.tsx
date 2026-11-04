"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { SPORT_LABELS } from "@/lib/activity-format";
import type { Visibility } from "@/lib/public-activity";
import { uploadActivityPhoto, type OriginalStatus, type PhotoPrivateFields } from "@/lib/client/photo-original";

export interface EditPhoto {
  pathname: string;
  url: string;
  width: number | null;
  height: number | null;
  caption: string | null;
}

interface EditProps {
  id: number;
  initial: {
    name: string;
    sportType: string;
    gear: string | null;
    description: string | null;
    visibility: Visibility;
    hrHidden: boolean;
    trimStartM: number;
    trimEndM: number;
    hasOriginal: boolean;
    utcOffsetMin: number;
    photos: EditPhoto[];
  };
}

// existing photos carry no private fields: the server keeps theirs by pathname
interface PhotoItem {
  key: string;
  status: "uploading" | "done" | "error";
  previewUrl: string;
  photo?: EditPhoto & Partial<PhotoPrivateFields>;
  originalStatus?: OriginalStatus;
}

const MAX_PHOTOS = 10;

const VISIBILITY_LABELS: Record<Visibility, string> = {
  public: "public",
  "hide-map": "hide map",
  private: "private",
};

const inputStyle: React.CSSProperties = {
  padding: "8px 12px",
  border: "1px solid var(--theme-highlight-bg)",
  backgroundColor: "var(--theme-card-bg)",
  borderRadius: "8px",
  width: "100%",
};

// post-publish fixes: metadata, visibility, photos and trim (server recomputes
// the published route/stats from the stored original). exists so a bad trim
// never requires re-uploading.
export default function EditActivity({ id, initial }: EditProps) {
  const router = useRouter();
  const [name, setName] = useState(initial.name);
  const [sportType, setSportType] = useState(initial.sportType);
  const [gear, setGear] = useState(initial.gear ?? "");
  const [description, setDescription] = useState(initial.description ?? "");
  const [visibility, setVisibility] = useState<Visibility>(initial.visibility);
  const [hrHidden, setHrHidden] = useState(initial.hrHidden);
  const [trimStart, setTrimStart] = useState(initial.trimStartM);
  const [trimEnd, setTrimEnd] = useState(initial.trimEndM);
  const [photos, setPhotos] = useState<PhotoItem[]>(() =>
    initial.photos.map((p) => ({ key: p.pathname, status: "done", previewUrl: p.url, photo: p }))
  );
  const [photosDirty, setPhotosDirty] = useState(false);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [message, setMessage] = useState("");
  const photoInputRef = useRef<HTMLInputElement>(null);

  const uploading = photos.some((p) => p.status === "uploading");

  async function addPhotos(files: FileList) {
    const list = Array.from(files).slice(0, MAX_PHOTOS - photos.length);
    if (list.length === 0) return;
    setPhotosDirty(true);
    await Promise.all(
      list.map(async (file) => {
        const key = `${file.name}-${Date.now()}-${Math.random()}`;
        const previewUrl = URL.createObjectURL(file);
        setPhotos((prev) => [...prev, { key, status: "uploading", previewUrl }]);
        try {
          const up = await uploadActivityPhoto(file, { utcOffsetMin: initial.utcOffsetMin });
          setPhotos((prev) =>
            prev.map((p) =>
              p.key === key
                ? {
                    ...p,
                    status: "done",
                    originalStatus: up.originalStatus,
                    photo: {
                      pathname: up.pathname,
                      url: up.url,
                      width: up.width,
                      height: up.height,
                      caption: null,
                      originalSha256: up.originalSha256,
                      takenAt: up.takenAt,
                      gpsLat: up.gpsLat,
                      gpsLng: up.gpsLng,
                    },
                  }
                : p
            )
          );
        } catch {
          setPhotos((prev) => prev.map((p) => (p.key === key ? { ...p, status: "error" } : p)));
        }
      })
    );
  }

  function removePhoto(key: string) {
    setPhotos((prev) => prev.filter((x) => x.key !== key));
    setPhotosDirty(true);
  }

  async function save() {
    setStatus("saving");
    try {
      const res = await fetch(`/api/admin/activities/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          sportType,
          gear: gear || null,
          description: description || null,
          visibility,
          hrHidden,
          trimStartM: trimStart,
          trimEndM: trimEnd,
          ...(photosDirty
            ? { photos: photos.filter((p) => p.status === "done" && p.photo).map((p) => p.photo) }
            : {}),
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.ok) {
        setStatus("error");
        setMessage(body?.error ?? "save failed");
        return;
      }
      setStatus("saved");
      setMessage("saved");
      setPhotosDirty(false);
      router.refresh();
    } catch {
      setStatus("error");
      setMessage("save failed — check your connection");
    }
  }

  async function remove() {
    if (!confirm("hide this activity from the site? (soft delete — recoverable)")) return;
    const res = await fetch(`/api/admin/activities/${id}`, { method: "DELETE" });
    if (res.ok) {
      router.push("/admin");
    } else {
      setStatus("error");
      setMessage("delete failed");
    }
  }

  return (
    <div className="flex flex-col" style={{ gap: "12px" }}>
      <input value={name} onChange={(e) => setName(e.target.value)} className="font-sans text-off-white text-sm" style={inputStyle} />
      <select value={sportType} onChange={(e) => setSportType(e.target.value)} className="font-sans text-off-white text-sm" style={inputStyle}>
        {Object.entries(SPORT_LABELS).map(([key, label]) => (
          <option key={key} value={key}>{label}</option>
        ))}
      </select>
      <input value={gear} onChange={(e) => setGear(e.target.value)} placeholder="gear notes" className="font-sans text-off-white text-sm" style={inputStyle} />
      <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="description" rows={3} className="font-sans text-off-white text-sm" style={inputStyle} />

      {initial.hasOriginal && (
        <div className="flex" style={{ gap: "12px" }}>
          <label className="font-sans text-gray text-sm" style={{ flex: 1 }}>
            trim start (m)
            <input type="number" min={0} step={10} value={trimStart} onChange={(e) => setTrimStart(Number(e.target.value))} className="font-sans text-off-white text-sm" style={inputStyle} />
          </label>
          <label className="font-sans text-gray text-sm" style={{ flex: 1 }}>
            trim end (m)
            <input type="number" min={0} step={10} value={trimEnd} onChange={(e) => setTrimEnd(Number(e.target.value))} className="font-sans text-off-white text-sm" style={inputStyle} />
          </label>
        </div>
      )}

      <label className="font-sans text-gray text-sm">
        visibility
        <select
          value={visibility}
          onChange={(e) => setVisibility(e.target.value as Visibility)}
          className="font-sans text-off-white text-sm"
          style={inputStyle}
        >
          {(Object.keys(VISIBILITY_LABELS) as Visibility[]).map((v) => (
            <option key={v} value={v}>{VISIBILITY_LABELS[v]}</option>
          ))}
        </select>
      </label>
      <label className="font-sans text-gray text-sm flex items-center" style={{ gap: "8px" }}>
        <input type="checkbox" checked={hrHidden} onChange={(e) => setHrHidden(e.target.checked)} style={{ accentColor: "var(--theme-text-primary)" }} />
        hide heart rate
      </label>

      <div>
        <button
          onClick={() => photoInputRef.current?.click()}
          className="font-sans text-gray text-sm link-highlight rounded-lg"
          style={{ padding: "4px 8px" }}
          disabled={photos.length >= MAX_PHOTOS}
        >
          add photos ({photos.length}/{MAX_PHOTOS})
        </button>
        <input
          ref={photoInputRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files) addPhotos(e.target.files);
            e.target.value = "";
          }}
        />
        {photos.length > 0 && (
          <div className="flex flex-wrap" style={{ gap: "8px", marginTop: "8px" }}>
            {photos.map((p) => (
              <div key={p.key} style={{ position: "relative" }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={p.previewUrl}
                  alt=""
                  className="rounded-lg"
                  style={{ width: 64, height: 64, objectFit: "cover", opacity: p.status === "done" ? 1 : 0.5 }}
                />
                <button
                  onClick={() => removePhoto(p.key)}
                  aria-label="remove photo"
                  className="font-sans text-off-white text-xs"
                  style={{ position: "absolute", top: 2, right: 2, background: "oklch(17.3% 0 0 / 0.7)", borderRadius: 4, padding: "0 4px" }}
                >
                  ×
                </button>
                {(p.status !== "done" || p.originalStatus === "failed") && (
                  <span className="font-sans text-gray text-xs" style={{ position: "absolute", bottom: 2, left: 4 }}>
                    {p.status === "error" ? "failed" : p.status === "uploading" ? "uploading…" : "no original"}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <button
        onClick={save}
        disabled={status === "saving" || uploading}
        className="card-bg rounded-lg font-sans text-off-white text-lg"
        style={{ padding: "12px", width: "100%", opacity: uploading ? 0.5 : 1 }}
      >
        {status === "saving" ? "saving…" : uploading ? "uploading photos…" : "save"}
      </button>
      {message && <p className="font-sans text-gray text-sm italic">{message}</p>}

      <div className="flex items-center justify-between" style={{ marginTop: "0.5rem" }}>
        <Link href={`/activities/${id}`} className="font-sans text-gray text-sm link-highlight">
          view public page →
        </Link>
        {initial.hasOriginal && <Link href={`/admin/activities/${id}/clean`} className="font-sans text-gray text-sm link-highlight">clean track</Link>}
        <button onClick={remove} className="font-sans text-gray text-sm link-highlight">
          hide activity
        </button>
      </div>
    </div>
  );
}
