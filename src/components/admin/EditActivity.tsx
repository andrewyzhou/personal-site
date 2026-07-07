"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { SPORT_LABELS } from "@/lib/activity-format";

interface EditProps {
  id: number;
  initial: {
    name: string;
    sportType: string;
    gear: string | null;
    description: string | null;
    hidden: boolean;
    trimStartM: number;
    trimEndM: number;
    hasOriginal: boolean;
  };
}

const inputStyle: React.CSSProperties = {
  padding: "8px 12px",
  border: "1px solid var(--theme-highlight-bg)",
  backgroundColor: "var(--theme-card-bg)",
  borderRadius: "8px",
  width: "100%",
};

// post-publish fixes: metadata, visibility, and trim (server recomputes the
// published route/stats from the stored original). exists so a bad trim never
// requires re-uploading.
export default function EditActivity({ id, initial }: EditProps) {
  const router = useRouter();
  const [name, setName] = useState(initial.name);
  const [sportType, setSportType] = useState(initial.sportType);
  const [gear, setGear] = useState(initial.gear ?? "");
  const [description, setDescription] = useState(initial.description ?? "");
  const [hidden, setHidden] = useState(initial.hidden);
  const [trimStart, setTrimStart] = useState(initial.trimStartM);
  const [trimEnd, setTrimEnd] = useState(initial.trimEndM);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [message, setMessage] = useState("");

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
          hidden,
          trimStartM: trimStart,
          trimEndM: trimEnd,
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

      <label className="font-sans text-gray text-sm flex items-center" style={{ gap: "8px" }}>
        <input type="checkbox" checked={hidden} onChange={(e) => setHidden(e.target.checked)} style={{ accentColor: "var(--theme-text-primary)" }} />
        hidden from site
      </label>

      <button
        onClick={save}
        disabled={status === "saving"}
        className="card-bg rounded-lg font-sans text-off-white text-lg"
        style={{ padding: "12px", width: "100%" }}
      >
        {status === "saving" ? "saving…" : "save"}
      </button>
      {message && <p className="font-sans text-gray text-sm italic">{message}</p>}

      <div className="flex items-center justify-between" style={{ marginTop: "0.5rem" }}>
        <Link href={`/activities/${id}`} className="font-sans text-gray text-sm link-highlight">
          view public page →
        </Link>
        <button onClick={remove} className="font-sans text-gray text-sm link-highlight">
          hide activity
        </button>
      </div>
    </div>
  );
}
