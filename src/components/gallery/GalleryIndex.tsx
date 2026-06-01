"use client";

import { useEffect, useState } from "react";
import type { Gallery } from "@/lib/gallery";
import MasonryLayout from "./layouts/MasonryLayout";
import FixedGridLayout from "./layouts/FixedGridLayout";
import JustifiedLayout from "./layouts/JustifiedLayout";

type LayoutKey = "masonry" | "grid" | "justified";
const LAYOUTS: { key: LayoutKey; label: string }[] = [
  { key: "masonry", label: "masonry" },
  { key: "grid", label: "grid" },
  { key: "justified", label: "justified" },
];

interface Props {
  galleries: Gallery[];
}

export default function GalleryIndex({ galleries }: Props) {
  const [layout, setLayout] = useState<LayoutKey>("masonry");
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setHydrated(true);
    const params = new URLSearchParams(window.location.search);
    const param = params.get("layout") as LayoutKey | null;
    if (param && LAYOUTS.some((l) => l.key === param)) setLayout(param);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const params = new URLSearchParams(window.location.search);
    if (layout === "masonry") params.delete("layout");
    else params.set("layout", layout);
    const qs = params.toString();
    const url = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
    window.history.replaceState(null, "", url);
  }, [layout, hydrated]);

  return (
    <div>
      <div className="flex flex-wrap gap-2" style={{ marginBottom: "2rem" }}>
        <span className="font-sans text-gray text-base self-center" style={{ marginRight: "0.25rem" }}>
          layout:
        </span>
        {LAYOUTS.map((l) => (
          <button
            key={l.key}
            onClick={() => setLayout(l.key)}
            className={`font-sans text-base transition-colors ${
              layout === l.key
                ? "text-off-white link-highlight-active"
                : "text-gray link-highlight"
            }`}
          >
            {l.label}
          </button>
        ))}
      </div>

      {galleries.length === 0 ? (
        <p className="font-sans text-gray text-lg italic">no galleries yet.</p>
      ) : layout === "masonry" ? (
        <MasonryLayout galleries={galleries} />
      ) : layout === "grid" ? (
        <FixedGridLayout galleries={galleries} />
      ) : (
        <JustifiedLayout galleries={galleries} />
      )}
    </div>
  );
}
