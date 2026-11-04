"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";
import { decodeMultiPolyline } from "@/lib/polyline";
import type { Bounds } from "@/lib/cleaning/ui-format";
import "maplibre-gl/dist/maplibre-gl.css";

interface Props {
  // untouched track, [lat, lng] runs
  before: [number, number][][];
  // published (or preview) multi-segment polyline
  after: string | null;
  selection: [number, number][][];
  hover: [number, number][][];
  cursor: [number, number] | null;
  showBefore: boolean;
  showAfter: boolean;
  bounds: Bounds | null;
}

const STYLE = "https://tiles.openfreemap.org/styles/positron";
// monochrome like the public map: the dark-theme invert filter flips both
const INK = "#1a1a1a";
const NEUTRAL = "#8c8c8c";
const LOAD_TIMEOUT_MS = 8000;

type Fc = GeoJSON.FeatureCollection;
const fc = (features: GeoJSON.Feature[]): Fc => ({ type: "FeatureCollection", features });

function lines(segments: [number, number][][]): Fc {
  const coords = segments.filter((s) => s.length > 1).map((s) => s.map(([la, ln]) => [ln, la]));
  return fc(coords.length ? [{ type: "Feature", properties: {}, geometry: { type: "MultiLineString", coordinates: coords } }] : []);
}

const point = (p: [number, number] | null): Fc =>
  fc(p ? [{ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [p[1], p[0]] } }] : []);

// before/after overlay for the clean page: neutral thin raw track, ink result,
// a soft wide band for the scrubber selection and a cursor dot
export default function CleanMap({ before, after, selection, hover, cursor, showBefore, showAfter, bounds }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const boundsRef = useRef(bounds);
  boundsRef.current = bounds;

  useEffect(() => {
    let cancelled = false;
    let map: MapLibreMap | null = null;
    let timeout: ReturnType<typeof setTimeout> | null = null;

    async function init() {
      if (!containerRef.current) return;
      try {
        const maplibregl = (await import("maplibre-gl")).default;
        if (cancelled || !containerRef.current) return;
        const b = boundsRef.current;
        map = new maplibregl.Map({
          container: containerRef.current,
          style: STYLE,
          ...(b
            ? { bounds: [[b.minLng, b.minLat], [b.maxLng, b.maxLat]] as [[number, number], [number, number]], fitBoundsOptions: { padding: 40 } }
            : { center: [0, 20] as [number, number], zoom: 1 }),
          attributionControl: { compact: true },
          dragRotate: false,
          pitchWithRotate: false,
        });
        mapRef.current = map;
        map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
        timeout = setTimeout(() => {
          if (map && !map.loaded()) setFailed(true);
        }, LOAD_TIMEOUT_MS);
        map.on("error", () => {
          if (!map?.loaded()) setFailed(true);
        });
        map.on("load", () => {
          if (timeout) clearTimeout(timeout);
          const m = map!;
          for (const id of ["selection", "hover", "before", "after", "cursor"]) m.addSource(id, { type: "geojson", data: fc([]) });
          const round = { "line-join": "round", "line-cap": "round" } as const;
          m.addLayer({ id: "selection", type: "line", source: "selection", layout: round, paint: { "line-color": INK, "line-width": 10, "line-opacity": 0.18 } });
          m.addLayer({ id: "hover", type: "line", source: "hover", layout: round, paint: { "line-color": INK, "line-width": 8, "line-opacity": 0.12 } });
          m.addLayer({ id: "before", type: "line", source: "before", layout: round, paint: { "line-color": NEUTRAL, "line-width": 1.5, "line-opacity": 0.8 } });
          m.addLayer({ id: "after", type: "line", source: "after", layout: round, paint: { "line-color": INK, "line-width": 3 } });
          m.addLayer({
            id: "cursor",
            type: "circle",
            source: "cursor",
            paint: { "circle-radius": 5, "circle-color": INK, "circle-stroke-color": "#ffffff", "circle-stroke-width": 2 },
          });
          setReady(true);
        });
      } catch {
        setFailed(true);
      }
    }

    init();
    return () => {
      cancelled = true;
      if (timeout) clearTimeout(timeout);
      map?.remove();
      mapRef.current = null;
    };
  }, []);

  const afterSegments = useMemo(() => (after ? decodeMultiPolyline(after) : []), [after]);

  useEffect(() => {
    const m = mapRef.current;
    if (!m || !ready) return;
    (m.getSource("before") as GeoJSONSource | undefined)?.setData(showBefore ? lines(before) : fc([]));
    (m.getSource("after") as GeoJSONSource | undefined)?.setData(showAfter ? lines(afterSegments) : fc([]));
  }, [ready, before, afterSegments, showBefore, showAfter]);

  useEffect(() => {
    const m = mapRef.current;
    if (!m || !ready) return;
    (m.getSource("selection") as GeoJSONSource | undefined)?.setData(lines(selection));
    (m.getSource("hover") as GeoJSONSource | undefined)?.setData(lines(hover));
  }, [ready, selection, hover]);

  useEffect(() => {
    const m = mapRef.current;
    if (!m || !ready) return;
    (m.getSource("cursor") as GeoJSONSource | undefined)?.setData(point(cursor));
  }, [ready, cursor]);

  // reframe when the track's extent changes (first load, after a merge)
  const boundsKey = bounds ? `${bounds.minLat},${bounds.minLng},${bounds.maxLat},${bounds.maxLng}` : "";
  useEffect(() => {
    const m = mapRef.current;
    const b = boundsRef.current;
    if (!m || !ready || !b) return;
    m.fitBounds([[b.minLng, b.minLat], [b.maxLng, b.maxLat]], { padding: 40, duration: 0 });
  }, [ready, boundsKey]);

  if (failed) {
    return <p className="font-sans text-gray text-sm italic">map unavailable — tiles or webgl failed to load</p>;
  }
  return (
    <div className="rounded-lg overflow-hidden card-bg route-map-container" style={{ aspectRatio: "16 / 10", width: "100%" }}>
      <div ref={containerRef} style={{ width: "100%", height: "100%" }} />
    </div>
  );
}
