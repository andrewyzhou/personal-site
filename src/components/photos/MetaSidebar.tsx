"use client";

import dynamic from "next/dynamic";
import type { EssayImage } from "@/lib/photos";

const MiniMap = dynamic(() => import("./MiniMap"), {
  ssr: false,
  loading: () => <div className="card-bg rounded-lg" style={{ height: 160 }} />,
});

// collapsible metadata panel: exif + coordinates + minimap. desktop = overlay
// on the right of the stage; mobile = bottom sheet. every field optional.
export default function MetaSidebar({
  image,
  onClose,
  mobile,
}: {
  image: EssayImage;
  onClose: () => void;
  mobile: boolean;
}) {
  const rows: { label: string; value: string }[] = [];
  const e = image.exif;
  if (e?.camera) rows.push({ label: "camera", value: e.camera });
  if (e?.lens) rows.push({ label: "lens", value: e.lens });
  if (e?.aperture) rows.push({ label: "aperture", value: e.aperture });
  if (e?.shutter) rows.push({ label: "shutter", value: e.shutter });
  if (e?.iso) rows.push({ label: "iso", value: String(e.iso) });
  if (e?.focalLength) rows.push({ label: "focal", value: e.focalLength });
  if (image.width && image.height) rows.push({ label: "size", value: `${image.width} × ${image.height}` });
  if (image.takenAt) {
    const d = new Date(image.takenAt);
    if (!Number.isNaN(d.getTime())) {
      rows.push({ label: "taken", value: d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }).toLowerCase() });
    }
  }

  const panelStyle: React.CSSProperties = mobile
    ? {
        position: "fixed", left: 0, right: 0, bottom: 0, maxHeight: "60vh", overflowY: "auto", zIndex: 40,
        backgroundColor: "var(--theme-bg)", borderTop: "2px solid var(--theme-divider)", padding: "1rem 1.25rem",
      }
    : {
        position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", width: 280, maxHeight: "90%",
        overflowY: "auto", zIndex: 10, backgroundColor: "var(--theme-bg)",
        border: "1px solid var(--theme-divider)", borderRadius: 8, padding: "1rem",
      };

  return (
    <>
      {mobile && (
        <div style={{ position: "fixed", inset: 0, background: "oklch(17.3% 0 0 / 0.5)", zIndex: 39 }} onClick={onClose} />
      )}
      <div style={panelStyle} className="animate-content-enter">
        <div className="flex items-center justify-between" style={{ marginBottom: "0.75rem" }}>
          <span className="font-sans text-off-white text-sm font-bold">info</span>
          <button onClick={onClose} className="font-sans text-gray text-sm link-highlight" aria-label="close info">
            ✕
          </button>
        </div>

        {rows.length > 0 && (
          <div className="flex flex-col" style={{ gap: "6px", marginBottom: image.gps ? "0.75rem" : 0 }}>
            {rows.map((r) => (
              <div key={r.label} className="flex items-baseline justify-between" style={{ gap: "12px" }}>
                <span className="font-sans text-gray text-xs">{r.label}</span>
                <span className="font-sans text-secondary text-sm" style={{ textAlign: "right" }}>{r.value}</span>
              </div>
            ))}
          </div>
        )}

        {image.gps && (
          <div style={{ borderTop: rows.length > 0 ? "1px solid var(--theme-divider)" : "none", paddingTop: rows.length > 0 ? "0.75rem" : 0 }}>
            <p className="font-sans text-gray text-xs" style={{ marginBottom: "6px" }}>
              {image.gps.lat.toFixed(2)}, {image.gps.lon.toFixed(2)} (approx)
            </p>
            <MiniMap lat={image.gps.lat} lon={image.gps.lon} />
            <a
              href={`https://www.openstreetmap.org/?mlat=${image.gps.lat}&mlon=${image.gps.lon}#map=12/${image.gps.lat}/${image.gps.lon}`}
              target="_blank"
              rel="noopener noreferrer"
              className="font-sans text-gray text-xs link-highlight"
              style={{ display: "inline-block", marginTop: "6px" }}
            >
              open in openstreetmap →
            </a>
          </div>
        )}

        {rows.length === 0 && !image.gps && (
          <p className="font-sans text-gray text-xs italic">no metadata for this photo</p>
        )}
      </div>
    </>
  );
}
