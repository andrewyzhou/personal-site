"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import RouteMap from "@/components/RouteMap";
import { prepareImage } from "@/lib/client/image";
import {
  DURATION_ONLY_TYPES,
  PACE_TYPES,
  SPEED_TYPES,
  SPORT_LABELS,
  formatClockDuration,
  formatFeet,
  formatMiles,
  formatMph,
  formatPace,
} from "@/lib/activity-format";

// [lat, lng, cumDistM, tOffsetS, eleM|null, hr|null]
type PreviewPoint = [number, number, number, number, number | null, number | null];

interface Draft {
  fitBlobUrl: string;
  fitBlobPathname: string;
  fitSha256: string;
  fileType: string;
  sportType: string;
  suggestedName: string;
  startDateUtc: string;
  localDate: string;
  localTime: string;
  utcOffsetMin: number;
  hasLocalTime: boolean;
  stats: {
    distanceM: number;
    movingTimeS: number;
    elapsedTimeS: number;
    elevGainM: number;
    avgSpeedMs: number;
    maxSpeedMs: number;
    avgHr: number | null;
    maxHr: number | null;
  };
  track: PreviewPoint[] | null;
  duplicate: { id: number; name: string; date: string } | null;
}

interface PhotoItem {
  key: string;
  status: "converting" | "uploading" | "done" | "error";
  previewUrl: string;
  url?: string;
  pathname?: string;
  width?: number;
  height?: number;
}

type Phase =
  | { type: "pick" }
  | { type: "parsing" }
  | { type: "preview"; draft: Draft }
  | { type: "publishing"; draft: Draft }
  | { type: "done"; id: number }
  | { type: "error"; message: string };

const PRIVACY_TRIM_M = 200;
const MAX_PHOTOS = 10;

const inputStyle: React.CSSProperties = {
  padding: "8px 12px",
  border: "1px solid var(--theme-highlight-bg)",
  backgroundColor: "var(--theme-card-bg)",
  borderRadius: "8px",
  width: "100%",
};

export default function UploadFlow() {
  const [phase, setPhase] = useState<Phase>({ type: "pick" });
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(0);
  const [name, setName] = useState("");
  const [sportType, setSportType] = useState("Run");
  const [gear, setGear] = useState("");
  const [description, setDescription] = useState("");
  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);

  // ---------------------------------------------------------------- parsing

  async function handleFile(file: File) {
    setPhase({ type: "parsing" });
    try {
      if (file.size > 4 * 1024 * 1024) {
        setPhase({ type: "error", message: "file is over 4 mb — export the original .fit/.zip instead of a verbose gpx" });
        return;
      }
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/admin/activities/parse", { method: "POST", body: form });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.ok) {
        setPhase({ type: "error", message: body?.error ?? `parse failed (${res.status})` });
        return;
      }
      const draft: Draft = body.draft;
      setName(draft.suggestedName);
      setSportType(draft.sportType);
      setTrimStart(0);
      setTrimEnd(0);
      setPhotos([]);
      setPhase({ type: "preview", draft });
    } catch {
      setPhase({ type: "error", message: "upload failed — check your connection and retry" });
    }
  }

  // ---------------------------------------------------------- trim + stats

  const draft = phase.type === "preview" || phase.type === "publishing" ? phase.draft : null;
  const totalDist = draft?.track ? draft.track[draft.track.length - 1][2] : 0;
  const maxTrim = Math.min(5000, totalDist * 0.45);

  const kept = useMemo(() => {
    if (!draft?.track) return null;
    const lo = trimStart;
    const hi = totalDist - trimEnd;
    return draft.track.filter((p) => p[2] >= lo && p[2] <= hi);
  }, [draft, trimStart, trimEnd, totalDist]);

  const liveStats = useMemo(() => {
    if (!draft) return null;
    if (!kept || kept.length < 2 || (trimStart === 0 && trimEnd === 0)) return draft.stats;
    const dist = kept[kept.length - 1][2] - kept[0][2];
    const elapsed = kept[kept.length - 1][3] - kept[0][3];
    const hrs = kept.map((p) => p[5]).filter((v): v is number => v !== null);
    let gain = 0;
    for (let i = 1; i < kept.length; i++) {
      const a = kept[i - 1][4];
      const b = kept[i][4];
      if (a !== null && b !== null && b > a) gain += b - a;
    }
    return {
      ...draft.stats,
      distanceM: dist,
      elapsedTimeS: elapsed,
      movingTimeS: Math.round(draft.stats.movingTimeS * (elapsed / Math.max(1, draft.stats.elapsedTimeS))),
      avgSpeedMs: elapsed > 0 ? dist / elapsed : 0,
      elevGainM: gain,
      avgHr: hrs.length > 0 ? hrs.reduce((x, y) => x + y, 0) / hrs.length : null,
    };
  }, [draft, kept, trimStart, trimEnd]);

  const keptLatLng = useMemo(
    () => (kept ? kept.map((p) => [p[0], p[1]] as [number, number]) : null),
    [kept]
  );
  const fullLatLng = useMemo(
    () => (draft?.track ? draft.track.map((p) => [p[0], p[1]] as [number, number]) : null),
    [draft]
  );
  const previewBounds = useMemo(() => {
    if (!fullLatLng || fullLatLng.length < 2) return null;
    let minLat = Infinity, minLng = Infinity, maxLat = -Infinity, maxLng = -Infinity;
    for (const [lat, lng] of fullLatLng) {
      minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat);
      minLng = Math.min(minLng, lng); maxLng = Math.max(maxLng, lng);
    }
    return { minLat, minLng, maxLat, maxLng };
  }, [fullLatLng]);

  // --------------------------------------------------------------- photos

  async function addPhotos(files: FileList) {
    const slots = MAX_PHOTOS - photos.length;
    const list = Array.from(files).slice(0, slots);
    for (const file of list) {
      const key = `${file.name}-${Date.now()}-${Math.random()}`;
      const previewUrl = URL.createObjectURL(file);
      setPhotos((prev) => [...prev, { key, status: "converting", previewUrl }]);
      try {
        const prepared = await prepareImage(file);
        setPhotos((prev) => prev.map((p) => (p.key === key ? { ...p, status: "uploading" } : p)));
        const form = new FormData();
        form.append("file", prepared.blob, "photo.jpg");
        form.append("width", String(prepared.width));
        form.append("height", String(prepared.height));
        const res = await fetch("/api/admin/photos", { method: "POST", body: form });
        const body = await res.json().catch(() => null);
        if (!res.ok || !body?.ok) throw new Error(body?.error ?? "upload failed");
        setPhotos((prev) =>
          prev.map((p) =>
            p.key === key
              ? { ...p, status: "done", url: body.url, pathname: body.pathname, width: body.width, height: body.height }
              : p
          )
        );
      } catch {
        setPhotos((prev) => prev.map((p) => (p.key === key ? { ...p, status: "error" } : p)));
      }
    }
  }

  // --------------------------------------------------------------- publish

  async function publish() {
    if (!draft) return;
    setPhase({ type: "publishing", draft });
    try {
      const res = await fetch("/api/admin/activities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fitBlobPathname: draft.fitBlobPathname,
          name,
          description: description || null,
          sportType,
          gear: gear || null,
          trimStartM: trimStart,
          trimEndM: trimEnd,
          utcOffsetMinFallback: draft.hasLocalTime ? undefined : -new Date().getTimezoneOffset(),
          photos: photos
            .filter((p) => p.status === "done")
            .map((p) => ({ pathname: p.pathname!, url: p.url!, width: p.width, height: p.height })),
        }),
      });
      const body = await res.json().catch(() => null);
      if (res.status === 409) {
        setPhase({ type: "error", message: "already published — this activity is a duplicate" });
        return;
      }
      if (!res.ok || !body?.ok) {
        setPhase({ type: "preview", draft });
        alert(body?.error ?? "publish failed — retry in a minute");
        return;
      }
      setPhase({ type: "done", id: body.id });
    } catch {
      setPhase({ type: "preview", draft });
      alert("publish failed — check your connection and retry");
    }
  }

  // ---------------------------------------------------------------- render

  if (phase.type === "pick" || phase.type === "error") {
    return (
      <div className="flex flex-col" style={{ gap: "12px" }}>
        <button
          onClick={() => fileInputRef.current?.click()}
          className="card-bg rounded-lg font-sans text-off-white text-lg"
          style={{ padding: "48px 24px", textAlign: "center", width: "100%" }}
        >
          tap to select a file
          <span className="block font-sans text-gray text-xs" style={{ marginTop: "0.5rem" }}>
            .fit · .zip (garmin export original) · .gpx · .tcx
          </span>
        </button>
        {phase.type === "error" && (
          <p className="font-sans text-gray text-sm italic">{phase.message}</p>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept=".fit,.zip,.gpx,.tcx,.gz"
          hidden
          onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
        />
      </div>
    );
  }

  if (phase.type === "parsing") {
    return (
      <div className="card-bg animate-pulse rounded-lg font-sans text-gray text-lg" style={{ padding: "48px 24px", textAlign: "center" }}>
        parsing…
      </div>
    );
  }

  if (phase.type === "done") {
    return (
      <div className="flex flex-col" style={{ gap: "12px", textAlign: "center" }}>
        <p className="font-sans text-off-white text-lg">published</p>
        <Link href={`/activities/${phase.id}`} className="font-sans text-gray text-lg link-highlight">
          view activity →
        </Link>
        <button
          onClick={() => {
            setPhase({ type: "pick" });
            setPhotos([]);
          }}
          className="font-sans text-gray text-sm link-highlight"
        >
          upload another
        </button>
      </div>
    );
  }

  // preview / publishing
  const d = draft!;
  const paceOrSpeed = PACE_TYPES.has(sportType)
    ? { label: "avg pace", value: formatPace(liveStats?.avgSpeedMs ?? 0) }
    : SPEED_TYPES.has(sportType)
      ? { label: "avg speed", value: formatMph(liveStats?.avgSpeedMs ?? 0) }
      : null;
  const durationOnly = DURATION_ONLY_TYPES.has(sportType);

  return (
    <div className="flex flex-col" style={{ gap: "16px" }}>
      {previewBounds && fullLatLng && keptLatLng && (
        <>
          <RouteMap fullTrack={fullLatLng} keptTrack={keptLatLng} bounds={previewBounds} />
          <div className="flex flex-col" style={{ gap: "8px" }}>
            <label className="font-sans text-gray text-sm">
              trim start — {formatMiles(trimStart)}
              <input
                type="range"
                min={0}
                max={maxTrim}
                step={10}
                value={trimStart}
                onChange={(e) => setTrimStart(Number(e.target.value))}
                style={{ width: "100%", accentColor: "var(--theme-text-primary)" }}
              />
            </label>
            <label className="font-sans text-gray text-sm">
              trim end — {formatMiles(trimEnd)}
              <input
                type="range"
                min={0}
                max={maxTrim}
                step={10}
                value={trimEnd}
                onChange={(e) => setTrimEnd(Number(e.target.value))}
                style={{ width: "100%", accentColor: "var(--theme-text-primary)" }}
              />
            </label>
            <button
              onClick={() => {
                setTrimStart(Math.min(PRIVACY_TRIM_M, maxTrim));
                setTrimEnd(Math.min(PRIVACY_TRIM_M, maxTrim));
              }}
              className="font-sans text-gray text-sm link-highlight rounded-lg"
              style={{ alignSelf: "flex-start", padding: "4px 8px" }}
            >
              privacy trim ({PRIVACY_TRIM_M} m each end)
            </button>
          </div>
        </>
      )}

      <div className="grid grid-cols-3 gap-3">
        <Stat label="time" value={formatClockDuration(liveStats?.elapsedTimeS ?? 0)} />
        {!durationOnly && <Stat label="distance" value={formatMiles(liveStats?.distanceM ?? 0)} />}
        {!durationOnly && paceOrSpeed && <Stat label={paceOrSpeed.label} value={paceOrSpeed.value} />}
        {!durationOnly && (liveStats?.elevGainM ?? 0) > 1 && (
          <Stat label="elevation" value={formatFeet(liveStats!.elevGainM)} />
        )}
        {liveStats?.avgHr != null && <Stat label="avg hr" value={`${Math.round(liveStats.avgHr)} bpm`} />}
        {liveStats?.maxHr != null && <Stat label="max hr" value={`${Math.round(liveStats.maxHr)} bpm`} />}
      </div>

      <p className="font-sans text-gray text-xs">
        {d.localDate} · {d.localTime}
        {d.hasLocalTime ? "" : " (device time zone unknown — using your browser's)"}
      </p>

      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="name"
        className="font-sans text-off-white text-sm"
        style={inputStyle}
      />
      <select
        value={sportType}
        onChange={(e) => setSportType(e.target.value)}
        className="font-sans text-off-white text-sm"
        style={inputStyle}
      >
        {Object.entries(SPORT_LABELS).map(([key, label]) => (
          <option key={key} value={key}>
            {label}
          </option>
        ))}
      </select>
      <input
        value={gear}
        onChange={(e) => setGear(e.target.value)}
        placeholder="gear notes"
        className="font-sans text-off-white text-sm"
        style={inputStyle}
      />
      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="description"
        rows={3}
        className="font-sans text-off-white text-sm"
        style={inputStyle}
      />

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
          onChange={(e) => e.target.files && addPhotos(e.target.files)}
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
                  onClick={() => setPhotos((prev) => prev.filter((x) => x.key !== p.key))}
                  aria-label="remove photo"
                  className="font-sans text-off-white text-xs"
                  style={{ position: "absolute", top: 2, right: 2, background: "oklch(17.3% 0 0 / 0.7)", borderRadius: 4, padding: "0 4px" }}
                >
                  ×
                </button>
                {p.status !== "done" && (
                  <span className="font-sans text-gray text-xs" style={{ position: "absolute", bottom: 2, left: 4 }}>
                    {p.status === "error" ? "failed" : `${p.status}…`}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {d.duplicate && (
        <p className="font-sans text-gray text-sm italic">
          already published —{" "}
          <Link href={`/activities/${d.duplicate.id}`} className="link-highlight">
            view activity →
          </Link>
        </p>
      )}

      <button
        onClick={publish}
        disabled={phase.type === "publishing" || !!d.duplicate || !name.trim()}
        className="card-bg rounded-lg font-sans text-off-white text-lg"
        style={{ padding: "14px", width: "100%", opacity: phase.type === "publishing" || d.duplicate ? 0.5 : 1 }}
      >
        {phase.type === "publishing" ? "publishing…" : "publish"}
      </button>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="font-sans text-off-white text-sm font-medium">{value}</p>
      <p className="font-sans text-gray text-xs">{label}</p>
    </div>
  );
}
