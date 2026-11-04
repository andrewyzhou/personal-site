"use client";

import { useEffect, useRef, useState } from "react";
import type { GeoJSONSource, Map as MapLibreMap, MapMouseEvent, MapTouchEvent } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

export interface MapZone {
  id: number;
  name: string;
  enabled: boolean;
  polygon: number[][][];
}

export type DraftMode = "draw" | "edit" | null;

interface Props {
  zones: MapZone[];
  selectedId: number | null;
  // open ring of [lng, lat] (no closing vertex) being drawn or edited
  draft: number[][] | null;
  draftMode: DraftMode;
  onDraftChange(ring: number[][]): void;
  onFinish(): void; // first vertex clicked while drawing
  onSelect(id: number | null): void;
}

const STYLE = "https://tiles.openfreemap.org/styles/positron";
const INK = "#1a1a1a";
const round6 = (v: number) => Math.round(v * 1e6) / 1e6;

type Fc = GeoJSON.FeatureCollection;
const fc = (features: GeoJSON.Feature[]): Fc => ({ type: "FeatureCollection", features });

function zonesData(zones: MapZone[], selectedId: number | null): Fc {
  return fc(
    zones.map((z) => ({
      type: "Feature",
      properties: { id: z.id, enabled: z.enabled, selected: z.id === selectedId },
      geometry: { type: "Polygon", coordinates: z.polygon },
    }))
  );
}

function draftData(ring: number[][] | null, mode: DraftMode): { shape: Fc; points: Fc; mids: Fc } {
  if (!ring || !mode) return { shape: fc([]), points: fc([]), mids: fc([]) };
  const shape: GeoJSON.Feature[] = [];
  if (ring.length >= 3) {
    shape.push({ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [[...ring, ring[0]]] } });
  }
  if (ring.length >= 2) {
    const line = mode === "edit" && ring.length >= 3 ? [...ring, ring[0]] : ring;
    shape.push({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: line } });
  }
  const points = ring.map((p, idx) => ({
    type: "Feature" as const,
    properties: { idx, first: idx === 0 },
    geometry: { type: "Point" as const, coordinates: p },
  }));
  // edge midpoints: drag one to add a vertex there (edit mode only)
  const mids =
    mode === "edit"
      ? ring.map((p, idx) => {
          const q = ring[(idx + 1) % ring.length];
          return {
            type: "Feature" as const,
            properties: { idx },
            geometry: { type: "Point" as const, coordinates: [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2] },
          };
        })
      : [];
  return { shape: fc(shape), points: fc(points), mids: fc(mids) };
}

function boundsOf(polygons: number[][][][]): [[number, number], [number, number]] | null {
  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
  for (const poly of polygons) {
    for (const [lng, lat] of poly[0] ?? []) {
      minLng = Math.min(minLng, lng);
      maxLng = Math.max(maxLng, lng);
      minLat = Math.min(minLat, lat);
      maxLat = Math.max(maxLat, lat);
    }
  }
  return Number.isFinite(minLng) ? [[minLng, minLat], [maxLng, maxLat]] : null;
}

// maplibre editor for privacy zones: draw by clicking vertices, drag vertices
// (and edge midpoints) to reshape, right-click a vertex to remove it
export default function PrivacyZoneMap(props: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const propsRef = useRef(props);
  propsRef.current = props;

  useEffect(() => {
    let cancelled = false;
    let map: MapLibreMap | null = null;

    async function init() {
      if (!containerRef.current) return;
      try {
        const maplibregl = (await import("maplibre-gl")).default;
        if (cancelled || !containerRef.current) return;
        const initial = boundsOf(propsRef.current.zones.map((z) => z.polygon));
        map = new maplibregl.Map({
          container: containerRef.current,
          style: STYLE,
          ...(initial ? { bounds: initial, fitBoundsOptions: { padding: 40, maxZoom: 15 } } : { center: [0, 20], zoom: 1 }),
          attributionControl: { compact: true },
          dragRotate: false,
          pitchWithRotate: false,
          doubleClickZoom: false,
        });
        mapRef.current = map;
        map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
        map.on("error", () => {
          if (!map?.loaded()) setFailed(true);
        });
        map.on("load", () => {
          const m = map!;
          for (const id of ["zones", "draft", "draft-points", "draft-mids"]) m.addSource(id, { type: "geojson", data: fc([]) });
          m.addLayer({
            id: "zones-fill",
            type: "fill",
            source: "zones",
            paint: {
              "fill-color": INK,
              "fill-opacity": ["case", ["get", "selected"], 0.3, ["get", "enabled"], 0.18, 0.06],
            },
          });
          m.addLayer({
            id: "zones-line",
            type: "line",
            source: "zones",
            paint: { "line-color": INK, "line-width": ["case", ["get", "selected"], 2.5, 1.5] },
          });
          m.addLayer({ id: "draft-fill", type: "fill", source: "draft", filter: ["==", ["geometry-type"], "Polygon"], paint: { "fill-color": INK, "fill-opacity": 0.12 } });
          m.addLayer({ id: "draft-line", type: "line", source: "draft", filter: ["==", ["geometry-type"], "LineString"], paint: { "line-color": INK, "line-width": 2, "line-dasharray": [2, 1] } });
          m.addLayer({ id: "draft-mids", type: "circle", source: "draft-mids", paint: { "circle-radius": 4, "circle-color": "#ffffff", "circle-opacity": 0.8, "circle-stroke-color": INK, "circle-stroke-width": 1 } });
          m.addLayer({
            id: "draft-points",
            type: "circle",
            source: "draft-points",
            paint: {
              "circle-radius": ["case", ["get", "first"], 7, 6],
              "circle-color": ["case", ["get", "first"], INK, "#ffffff"],
              "circle-stroke-color": INK,
              "circle-stroke-width": 2,
            },
          });
          wireInteractions(m);
          setReady(true);
        });
      } catch {
        setFailed(true);
      }
    }

    function wireInteractions(m: MapLibreMap) {
      let dragging: number | null = null;
      let moved = false;

      const startDrag = (idx: number) => {
        dragging = idx;
        moved = false;
        m.dragPan.disable();
      };
      const moveDrag = (e: MapMouseEvent | MapTouchEvent) => {
        if (dragging === null) return;
        const p = propsRef.current;
        if (!p.draft) return;
        moved = true;
        const next = p.draft.slice();
        next[dragging] = [round6(e.lngLat.lng), round6(e.lngLat.lat)];
        p.onDraftChange(next);
      };
      const endDrag = () => {
        if (dragging === null) return;
        dragging = null;
        m.dragPan.enable();
      };
      const pointIdx = (e: MapMouseEvent | MapTouchEvent, layer: string): number | null => {
        if (!m.getLayer(layer)) return null;
        const f = m.queryRenderedFeatures(e.point, { layers: [layer] })[0];
        return f ? Number(f.properties?.idx) : null;
      };
      const begin = (e: MapMouseEvent | MapTouchEvent) => {
        moved = false;
        const p = propsRef.current;
        if (!p.draftMode || !p.draft) return;
        const idx = pointIdx(e, "draft-points");
        if (idx !== null) {
          e.preventDefault();
          startDrag(idx);
          return;
        }
        if (p.draftMode === "edit") {
          const mid = pointIdx(e, "draft-mids");
          if (mid !== null) {
            e.preventDefault();
            const next = p.draft.slice();
            next.splice(mid + 1, 0, [round6(e.lngLat.lng), round6(e.lngLat.lat)]);
            p.onDraftChange(next);
            startDrag(mid + 1);
          }
        }
      };

      m.on("mousedown", begin);
      m.on("touchstart", (e) => {
        if (e.points.length === 1) begin(e);
      });
      m.on("mousemove", (e) => {
        moveDrag(e);
        const p = propsRef.current;
        if (dragging !== null) return;
        const overPoint = p.draftMode && pointIdx(e, "draft-points") !== null;
        const overMid = p.draftMode === "edit" && pointIdx(e, "draft-mids") !== null;
        m.getCanvas().style.cursor = overPoint || overMid ? "move" : p.draftMode === "draw" ? "crosshair" : "";
      });
      m.on("touchmove", moveDrag);
      m.on("mouseup", endDrag);
      m.on("touchend", endDrag);

      m.on("click", (e) => {
        if (moved) {
          moved = false;
          return;
        }
        const p = propsRef.current;
        if (p.draftMode === "draw") {
          const ring = p.draft ?? [];
          if (pointIdx(e, "draft-points") === 0 && ring.length >= 3) {
            p.onFinish();
            return;
          }
          if (pointIdx(e, "draft-points") !== null) return;
          p.onDraftChange([...ring, [round6(e.lngLat.lng), round6(e.lngLat.lat)]]);
          return;
        }
        if (p.draftMode === "edit") return;
        const f = m.queryRenderedFeatures(e.point, { layers: ["zones-fill"] })[0];
        p.onSelect(f ? Number(f.properties?.id) : null);
      });

      m.on("contextmenu", (e) => {
        const p = propsRef.current;
        if (!p.draftMode || !p.draft) return;
        const idx = pointIdx(e, "draft-points");
        if (idx === null || (p.draftMode === "edit" && p.draft.length <= 3)) return;
        e.preventDefault();
        p.onDraftChange(p.draft.filter((_, i) => i !== idx));
      });
    }

    init();
    return () => {
      cancelled = true;
      map?.remove();
      mapRef.current = null;
    };
  }, []);

  // push zone/draft state into the map sources
  const { zones, selectedId, draft, draftMode } = props;
  useEffect(() => {
    const m = mapRef.current;
    if (!m || !ready) return;
    (m.getSource("zones") as GeoJSONSource | undefined)?.setData(zonesData(zones, selectedId));
    const d = draftData(draft, draftMode);
    (m.getSource("draft") as GeoJSONSource | undefined)?.setData(d.shape);
    (m.getSource("draft-points") as GeoJSONSource | undefined)?.setData(d.points);
    (m.getSource("draft-mids") as GeoJSONSource | undefined)?.setData(d.mids);
  }, [ready, zones, selectedId, draft, draftMode]);

  // frame the selected zone
  useEffect(() => {
    const m = mapRef.current;
    if (!m || !ready || selectedId === null) return;
    const z = zones.find((x) => x.id === selectedId);
    const b = z ? boundsOf([z.polygon]) : null;
    if (b) m.fitBounds(b, { padding: 60, maxZoom: 16, duration: 400 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, selectedId]);

  if (failed) {
    return <p className="font-sans text-gray text-sm italic">map unavailable — tiles or webgl failed to load</p>;
  }
  return (
    <div className="rounded-lg overflow-hidden card-bg route-map-container" style={{ aspectRatio: "1 / 1", width: "100%" }}>
      <div ref={containerRef} style={{ width: "100%", height: "100%" }} />
    </div>
  );
}
