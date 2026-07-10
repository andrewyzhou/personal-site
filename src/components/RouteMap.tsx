"use client";

import { useEffect, useRef, useState } from "react";
import RouteThumb from "./RouteThumb";
import { encodePolyline, decodePolyline } from "@/lib/polyline";
import { chaikin } from "@/lib/route-smooth";
import "maplibre-gl/dist/maplibre-gl.css";

interface RouteMapProps {
  // detail mode: a single published route
  polyline?: string;
  // trim-preview mode: full original track (muted) + kept segment (solid)
  fullTrack?: [number, number][];
  keptTrack?: [number, number][];
  bounds: { minLat: number; minLng: number; maxLat: number; maxLng: number };
  height?: number | string;
}

const OPENFREEMAP_STYLE = "https://tiles.openfreemap.org/styles/positron";
const LOAD_TIMEOUT_MS = 6000;

// maplibre + openfreemap route map with a quiet svg fallback when tiles/webgl
// fail. the invert filter keeps the light basemap monochrome and on-theme in
// dark mode.
export default function RouteMap({ polyline, fullTrack, keptTrack, bounds, height = "auto" }: RouteMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapRef = useRef<any>(null);
  const keptRef = useRef(keptTrack);
  keptRef.current = keptTrack;

  useEffect(() => {
    let cancelled = false;
    let timeout: ReturnType<typeof setTimeout> | null = null;

    async function init() {
      if (!containerRef.current) return;
      try {
        const maplibregl = (await import("maplibre-gl")).default;
        if (cancelled || !containerRef.current) return;

        const map = new maplibregl.Map({
          container: containerRef.current,
          style: OPENFREEMAP_STYLE,
          bounds: [
            [bounds.minLng, bounds.minLat],
            [bounds.maxLng, bounds.maxLat],
          ],
          fitBoundsOptions: { padding: 40 },
          attributionControl: { compact: true },
          dragRotate: false,
          pitchWithRotate: false,
        });
        mapRef.current = map;

        timeout = setTimeout(() => {
          if (!map.loaded()) {
            setFailed(true);
            map.remove();
          }
        }, LOAD_TIMEOUT_MS);

        map.on("error", () => {
          // tile/style failures before load → fall back; after load, ignore
          if (!map.loaded()) {
            setFailed(true);
          }
        });

        map.on("load", () => {
          if (timeout) clearTimeout(timeout);
          // maplibre draws straight chords between vertices, and smart
          // recording spaces gps points ~20m apart — chaikin subdivision
          // rounds the corners in geometry (line-join only rounds the caps)
          const toGeojson = (pts: [number, number][]) => ({
            type: "Feature" as const,
            properties: {},
            geometry: {
              type: "LineString" as const,
              coordinates: chaikin(pts).map(([lat, lng]) => [lng, lat]),
            },
          });

          if (fullTrack && fullTrack.length > 1) {
            map.addSource("full", { type: "geojson", data: toGeojson(fullTrack) });
            map.addLayer({
              id: "full",
              type: "line",
              source: "full",
              paint: { "line-color": "#1a1a1a", "line-width": 3, "line-opacity": 0.3 },
              layout: { "line-join": "round", "line-cap": "round" },
            });
          }

          const kept = keptRef.current ?? [];
          const mainPts = kept.length > 1 ? kept : polyline ? null : [];
          map.addSource("route", {
            type: "geojson",
            data: mainPts
              ? toGeojson(mainPts)
              : toGeojson(decodePolyline(polyline!)),
          });
          map.addLayer({
            id: "route",
            type: "line",
            source: "route",
            paint: { "line-color": "#1a1a1a", "line-width": 3 },
            layout: { "line-join": "round", "line-cap": "round" },
          });
        });
      } catch {
        setFailed(true);
      }
    }

    init();
    return () => {
      cancelled = true;
      if (timeout) clearTimeout(timeout);
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // live-update the kept segment while trim sliders move
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !keptTrack) return;
    const src = map.getSource?.("route");
    if (src && "setData" in src) {
      src.setData({
        type: "Feature",
        properties: {},
        geometry: { type: "LineString", coordinates: chaikin(keptTrack).map(([lat, lng]) => [lng, lat]) },
      });
    }
  }, [keptTrack]);

  const fallbackPolyline =
    polyline ?? (keptTrack && keptTrack.length > 1 ? encodePolyline(keptTrack) : null);

  if (failed) {
    return fallbackPolyline ? (
      <div className="card-bg rounded-lg" style={{ padding: "1rem", display: "flex", justifyContent: "center" }}>
        <RouteThumb polyline={fallbackPolyline} height={200} />
      </div>
    ) : null;
  }

  return (
    <div
      className="rounded-lg overflow-hidden card-bg route-map-container"
      style={{ aspectRatio: "16/10", height }}
    >
      <div ref={containerRef} style={{ width: "100%", height: "100%" }} />
    </div>
  );
}

