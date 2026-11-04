"use client";

import { useEffect, useRef, useState } from "react";
import RouteThumb from "./RouteThumb";
import { encodePolyline, decodeMultiPolyline } from "@/lib/polyline";
import { chaikin } from "@/lib/route-smooth";
import "maplibre-gl/dist/maplibre-gl.css";

interface RouteMapProps {
  // detail mode: a published route (multi-segment: space-separated segments)
  polyline?: string;
  // detail mode: public shapes of the privacy zones the route passes through
  // (geojson polygon coordinates, outer ring only), drawn as a soft fill
  fogShapes?: number[][][][] | null;
  // trim-preview mode: full original track (muted) + kept segment (solid)
  fullTrack?: [number, number][];
  keptTrack?: [number, number][];
  bounds: { minLat: number; minLng: number; maxLat: number; maxLng: number };
  height?: number | string;
}

const OPENFREEMAP_STYLE = "https://tiles.openfreemap.org/styles/positron";
const LOAD_TIMEOUT_MS = 6000;
// same ink as the route; the dark-theme invert filter on the container turns
// both light, so the fill stays a neutral tint of the line in either theme
const ROUTE_COLOR = "#1a1a1a";

// maplibre draws straight chords between vertices, and smart recording spaces
// gps points ~20m apart — chaikin subdivision rounds the corners in geometry
// (line-join only rounds the caps). each segment is its own line, so nothing
// is ever drawn across a fogged gap.
function linesGeojson(segments: [number, number][][]) {
  return {
    type: "Feature" as const,
    properties: {},
    geometry: {
      type: "MultiLineString" as const,
      coordinates: segments
        .filter((s) => s.length > 1)
        .map((s) => chaikin(s).map(([lat, lng]) => [lng, lat])),
    },
  };
}

// maplibre + openfreemap route map with a quiet svg fallback when tiles/webgl
// fail. the invert filter keeps the light basemap monochrome and on-theme in
// dark mode.
export default function RouteMap({ polyline, fogShapes, fullTrack, keptTrack, bounds, height = "auto" }: RouteMapProps) {
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

          // fog: soft neutral fill under the route, no outline, no labels
          const shapes = (fogShapes ?? []).filter((p) => Array.isArray(p) && p.length > 0);
          if (shapes.length > 0) {
            map.addSource("fog", {
              type: "geojson",
              data: {
                type: "Feature",
                properties: {},
                geometry: { type: "MultiPolygon", coordinates: shapes },
              },
            });
            map.addLayer({
              id: "fog",
              type: "fill",
              source: "fog",
              paint: { "fill-color": ROUTE_COLOR, "fill-opacity": 0.12, "fill-antialias": true },
            });
          }

          if (fullTrack && fullTrack.length > 1) {
            map.addSource("full", { type: "geojson", data: linesGeojson([fullTrack]) });
            map.addLayer({
              id: "full",
              type: "line",
              source: "full",
              paint: { "line-color": ROUTE_COLOR, "line-width": 3, "line-opacity": 0.3 },
              layout: { "line-join": "round", "line-cap": "round" },
            });
          }

          const kept = keptRef.current ?? [];
          const segments = kept.length > 1 ? [kept] : polyline ? decodeMultiPolyline(polyline) : [];
          map.addSource("route", { type: "geojson", data: linesGeojson(segments) });
          map.addLayer({
            id: "route",
            type: "line",
            source: "route",
            paint: { "line-color": ROUTE_COLOR, "line-width": 3 },
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
      src.setData(linesGeojson([keptTrack]));
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
