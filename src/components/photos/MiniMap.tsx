"use client";

import { useEffect, useRef, useState } from "react";
import "maplibre-gl/dist/maplibre-gl.css";

// small pin map for photo locations. non-interactive; quietly renders nothing
// on failure (the sidebar always shows coordinates + an osm link regardless).
export default function MiniMap({ lat, lon, height = 160 }: { lat: number; lon: number; height?: number }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let map: any = null;

    (async () => {
      try {
        const maplibregl = (await import("maplibre-gl")).default;
        if (cancelled || !containerRef.current) return;
        map = new maplibregl.Map({
          container: containerRef.current,
          style: "https://tiles.openfreemap.org/styles/positron",
          center: [lon, lat],
          zoom: 11,
          interactive: false,
          attributionControl: { compact: true },
        });
        new maplibregl.Marker({ color: "#1a1a1a" }).setLngLat([lon, lat]).addTo(map);
        map.on("error", () => {
          if (!map.loaded()) setFailed(true);
        });
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();

    return () => {
      cancelled = true;
      if (map) map.remove();
    };
  }, [lat, lon]);

  if (failed) return null;

  return (
    <div className="rounded-lg overflow-hidden card-bg route-map-container" style={{ height }}>
      <div ref={containerRef} style={{ width: "100%", height: "100%" }} />
    </div>
  );
}
