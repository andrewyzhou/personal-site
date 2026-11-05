"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import RouteMap from "@/components/RouteMap";
import ReplayPlayer from "@/components/replay/ReplayPlayer";
import { useTheme } from "@/context/ThemeContext";
import { decodeMultiPolyline } from "@/lib/polyline";
import { chaikin } from "@/lib/route-smooth";
import type { ReplayData } from "@/lib/replay/build";
import {
  METRIC_LABELS,
  ROUTE_SOLID,
  availableMetrics,
  buildReplayView,
  formatMetric,
  indexAtTime,
  legendGradient,
  metricDomain,
  metricSeries,
  nearestIndex,
  publishedEndpoints,
  routePieces,
  type MapMetric,
  type ReplayView,
} from "@/lib/replay/metrics-view";
import MapSkeleton from "./MapSkeleton";
import { OVERLAY, buildMapStyle, buildSky, themePaintUpdates, TERRAIN_EXAGGERATION, type MapTheme } from "./style";

export interface ActivityMapPhoto {
  url: string;
  width: number | null;
  height: number | null;
  pin: [number, number] | null; // [lat, lng]
}

export interface ActivityMap3DProps {
  polyline: string; // published multi-segment polyline (fallback + no-replay route)
  bounds: { minLat: number; minLng: number; maxLat: number; maxLng: number };
  fogShapes?: number[][][][] | null;
  replay: ReplayData | null; // null → polyline-only map, no hover, no replay
  sportType: string;
  photos?: ActivityMapPhoto[];
  hoverT: number | null; // replay seconds of the hovered point (from charts or the replay)
  onHoverT?: (t: number | null) => void;
  onMapReady?: (map: maplibregl.Map) => void;
  children?: ReactNode; // overlay slot: absolutely positioned over the map, pointer-events off (opt in per child)
}

const PITCH_3D = 45;
const PADDING = 40;
const LOAD_TIMEOUT_MS = 8000;
const CONTEXT_RESTORE_MS = 4000;
const HOVER_PX = 24;
const REVEAL_MAX_MS = 2500;

function hasWebgl(): boolean {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function isSmallDevice(): boolean {
  return window.matchMedia("(pointer: coarse)").matches || window.innerWidth < 768;
}

type LineFC = {
  type: "FeatureCollection";
  features: { type: "Feature"; properties: { color: string }; geometry: { type: "LineString"; coordinates: [number, number][] } }[];
};

function routeData(view: ReplayView | null, metric: MapMetric, polyline: string): LineFC {
  if (view) {
    const values = metricSeries(view, metric);
    const pieces = routePieces(view, values, metricDomain(values, metric));
    return {
      type: "FeatureCollection",
      features: pieces.map((p) => ({
        type: "Feature",
        properties: { color: p.color },
        geometry: { type: "LineString", coordinates: p.coords },
      })),
    };
  }
  // polyline only: one color, chaikin-smoothed like RouteMap, segments apart
  return {
    type: "FeatureCollection",
    features: decodeMultiPolyline(polyline)
      .filter((s) => s.length > 1)
      .map((s) => ({
        type: "Feature",
        properties: { color: ROUTE_SOLID },
        geometry: { type: "LineString", coordinates: chaikin(s).map(([lat, lng]) => [lng, lat] as [number, number]) },
      })),
  };
}

function endsData(view: ReplayView | null, polyline: string) {
  const ends = publishedEndpoints(view, polyline);
  return {
    type: "FeatureCollection" as const,
    features: ends
      ? (["end", "start"] as const).map((kind) => ({
          type: "Feature" as const,
          properties: { kind },
          geometry: { type: "Point" as const, coordinates: ends[kind] },
        }))
      : [],
  };
}

function setGeojson(map: maplibregl.Map, id: string, data: unknown) {
  const src = map.getSource(id) as maplibregl.GeoJSONSource | undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  src?.setData(data as any);
}

const btn: React.CSSProperties = {
  pointerEvents: "auto",
  background: "var(--theme-bg)",
  color: "var(--theme-text)",
  border: "1px solid var(--theme-divider)",
  borderRadius: 6,
  padding: "0.2rem 0.55rem",
  fontSize: "0.75rem",
  lineHeight: 1.4,
  cursor: "pointer",
  opacity: 0.92,
};

// 3d activity map: grayscale terrain basemap, the route colored by a metric,
// hover sync with the charts, and the replay mounted on demand. falls back to
// the flat RouteMap (which itself falls back to svg) when webgl or tiles fail.
export default function ActivityMap3D({
  polyline,
  bounds,
  fogShapes,
  replay,
  sportType,
  photos = [],
  hoverT,
  onHoverT,
  onMapReady,
  children,
}: ActivityMap3DProps) {
  const { theme } = useTheme();
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markerRef = useRef<maplibregl.Marker | null>(null);
  const markerElRef = useRef<HTMLDivElement | null>(null);
  const [map, setMap] = useState<maplibregl.Map | null>(null);
  const [failed, setFailed] = useState(false);
  const [contextLost, setContextLost] = useState(false);
  const [is3d, setIs3d] = useState(true);
  const [replayOn, setReplayOn] = useState(false);
  const [shown, setShown] = useState(false);

  const view = useMemo(() => (replay ? buildReplayView(replay) : null), [replay]);
  const metrics = useMemo(() => (view ? availableMetrics(view, sportType) : []), [view, sportType]);
  const [metricPick, setMetric] = useState<MapMetric | null>(null);
  const metric: MapMetric = metricPick && metrics.includes(metricPick) ? metricPick : (metrics[0] ?? "pace");

  // latest values for the map's event handlers (bound once at load)
  const viewRef = useRef(view);
  viewRef.current = view;
  const onHoverRef = useRef(onHoverT);
  onHoverRef.current = onHoverT;
  const replayOnRef = useRef(replayOn);
  replayOnRef.current = replayOn;
  const themeRef = useRef<MapTheme>(theme);
  themeRef.current = theme;
  const onReadyRef = useRef(onMapReady);
  onReadyRef.current = onMapReady;
  const boundsRef = useRef(bounds);
  boundsRef.current = bounds;
  const initRef = useRef({ polyline, fogShapes, metric });
  initRef.current = { polyline, fogShapes, metric };

  useEffect(() => {
    let cancelled = false;
    let loadTimer: ReturnType<typeof setTimeout> | null = null;
    let lostTimer: ReturnType<typeof setTimeout> | null = null;
    let raf = 0;
    let revealTimer: ReturnType<typeof setTimeout> | null = null;

    async function init() {
      if (!containerRef.current) return;
      if (!hasWebgl()) {
        setFailed(true);
        return;
      }
      try {
        const ml = (await import("maplibre-gl")).default;
        if (cancelled || !containerRef.current) return;
        const reduced = prefersReducedMotion();
        const small = isSmallDevice();
        const b = boundsRef.current;

        const m = new ml.Map({
          container: containerRef.current,
          style: buildMapStyle(themeRef.current, { terrain: true, terrainMaxzoom: small ? 12 : 14 }),
          bounds: [
            [b.minLng, b.minLat],
            [b.maxLng, b.maxLat],
          ],
          fitBoundsOptions: { padding: PADDING, pitch: PITCH_3D },
          pitch: PITCH_3D,
          maxPitch: 70,
          pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
          attributionControl: { compact: true },
          // one finger scrolls the page on phones; two move the map
          cooperativeGestures: small,
          locale: {
            "CooperativeGesturesHandler.WindowsHelpText": "use ctrl + scroll to zoom the map",
            "CooperativeGesturesHandler.MacHelpText": "use ⌘ + scroll to zoom the map",
            "CooperativeGesturesHandler.MobileHelpText": "use two fingers to move the map",
          },
          fadeDuration: reduced ? 0 : 200,
          maxTileCacheSize: small ? 64 : null,
        });
        mapRef.current = m;

        loadTimer = setTimeout(() => {
          if (!m.loaded()) setFailed(true);
        }, LOAD_TIMEOUT_MS);

        m.on("error", () => {
          // style/tile failures before load → fall back; after load, ignore
          if (!m.loaded()) setFailed(true);
        });

        m.on("webglcontextlost", () => {
          setContextLost(true);
          lostTimer = setTimeout(() => setFailed(true), CONTEXT_RESTORE_MS);
        });
        m.on("webglcontextrestored", () => {
          if (lostTimer) clearTimeout(lostTimer);
          setContextLost(false);
        });

        m.on("load", () => {
          if (loadTimer) clearTimeout(loadTimer);
          const o = OVERLAY[themeRef.current];
          const { polyline: pl, fogShapes: fs, metric: mt } = initRef.current;

          const shapes = (fs ?? []).filter((p) => Array.isArray(p) && p.length > 0);
          m.addSource("am-fog", {
            type: "geojson",
            data: { type: "Feature", properties: {}, geometry: { type: "MultiPolygon", coordinates: shapes } },
          });
          m.addLayer({
            id: "am-fog",
            type: "fill",
            source: "am-fog",
            paint: { "fill-color": o.fog, "fill-opacity": 0.1 },
          });

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          m.addSource("am-route", { type: "geojson", data: routeData(viewRef.current, mt, pl) as any });
          m.addLayer({
            id: "am-route-casing",
            type: "line",
            source: "am-route",
            layout: { "line-join": "round", "line-cap": "round" },
            paint: {
              "line-color": o.casing,
              "line-opacity": o.casingOpacity,
              "line-width": ["interpolate", ["linear"], ["zoom"], 10, 4.5, 16, 8],
            },
          });
          m.addLayer({
            id: "am-route",
            type: "line",
            source: "am-route",
            layout: { "line-join": "round", "line-cap": "round" },
            paint: {
              "line-color": ["get", "color"],
              "line-width": ["interpolate", ["linear"], ["zoom"], 10, 2.5, 16, 5],
            },
          });

          // start (filled dot) + end (ring): the published endpoints only
          m.addSource("am-ends", { type: "geojson", data: endsData(viewRef.current, pl) });
          m.addLayer({
            id: "am-ends",
            type: "circle",
            source: "am-ends",
            paint: {
              "circle-radius": 5,
              "circle-color": ["match", ["get", "kind"], "start", o.marker, o.markerRing],
              "circle-stroke-color": ["match", ["get", "kind"], "start", o.markerRing, o.marker],
              "circle-stroke-width": ["match", ["get", "kind"], "start", 1.5, 2.5],
              "circle-pitch-alignment": "viewport",
            },
          });

          // hover marker themes through css variables
          const el = document.createElement("div");
          el.style.cssText =
            "width:14px;height:14px;border-radius:50%;background:var(--theme-text-primary);border:2.5px solid var(--theme-bg);box-shadow:0 0 0 1px var(--theme-divider);pointer-events:none;";
          markerElRef.current = el;
          markerRef.current = new ml.Marker({ element: el });

          // hover: nearest replay point, only when the pointer is close to it
          const pick = (e: maplibregl.MapMouseEvent, emit: boolean) => {
            const v = viewRef.current;
            if (!v || replayOnRef.current) return;
            const i = nearestIndex(v, e.lngLat.lng, e.lngLat.lat);
            if (i < 0) return;
            const p = m.project([v.lng[i], v.lat[i]]);
            const near = Math.hypot(p.x - e.point.x, p.y - e.point.y) <= HOVER_PX;
            m.getCanvas().style.cursor = near ? "pointer" : "";
            if (emit) onHoverRef.current?.(near ? v.t[i] : null);
          };
          let pending: maplibregl.MapMouseEvent | null = null;
          m.on("mousemove", (e) => {
            pending = e;
            if (raf) return;
            raf = requestAnimationFrame(() => {
              raf = 0;
              if (pending) pick(pending, true);
            });
          });
          m.on("click", (e) => pick(e, true));
          m.on("mouseout", () => {
            if (!replayOnRef.current) onHoverRef.current?.(null);
          });

          setMap(m);
          onReadyRef.current?.(m);

          // fade in once the first tiles have drawn (idle), or after a beat
          // if terrain keeps it busy
          const reveal = () => {
            if (revealTimer) clearTimeout(revealTimer);
            if (!cancelled) setShown(true);
          };
          m.once("idle", reveal);
          revealTimer = setTimeout(reveal, REVEAL_MAX_MS);
        });
      } catch {
        setFailed(true);
      }
    }

    init();
    return () => {
      cancelled = true;
      if (loadTimer) clearTimeout(loadTimer);
      if (lostTimer) clearTimeout(lostTimer);
      if (raf) cancelAnimationFrame(raf);
      if (revealTimer) clearTimeout(revealTimer);
      markerRef.current?.remove();
      markerRef.current = null;
      mapRef.current?.remove();
      mapRef.current = null;
      setMap(null);
    };
  }, []);

  // a failed map is torn down; RouteMap takes over below
  useEffect(() => {
    if (!failed) return;
    markerRef.current?.remove();
    mapRef.current?.remove();
    mapRef.current = null;
    setMap(null);
  }, [failed]);

  // route data follows the replay and the picked metric
  useEffect(() => {
    if (!map) return;
    setGeojson(map, "am-route", routeData(view, metric, polyline));
  }, [map, view, metric, polyline]);

  useEffect(() => {
    if (!map) return;
    setGeojson(map, "am-ends", endsData(view, polyline));
  }, [map, view, polyline]);

  // theme: repaint in place so the route + replay layers survive
  useEffect(() => {
    if (!map) return;
    for (const u of themePaintUpdates(theme)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (map.getLayer(u.layer)) map.setPaintProperty(u.layer, u.prop, u.value as any);
    }
    map.setSky(buildSky(theme));
    const o = OVERLAY[theme];
    map.setPaintProperty("am-route-casing", "line-color", o.casing);
    map.setPaintProperty("am-route-casing", "line-opacity", o.casingOpacity);
    map.setPaintProperty("am-fog", "fill-color", o.fog);
    map.setPaintProperty("am-ends", "circle-color", ["match", ["get", "kind"], "start", o.marker, o.markerRing]);
    map.setPaintProperty("am-ends", "circle-stroke-color", ["match", ["get", "kind"], "start", o.markerRing, o.marker]);
  }, [map, theme]);

  // hover marker follows hoverT (from the map, the charts or the replay)
  useEffect(() => {
    const marker = markerRef.current;
    if (!map || !marker) return;
    if (hoverT === null || !view || view.n === 0) {
      marker.remove();
      return;
    }
    const i = indexAtTime(view, hoverT);
    marker.setLngLat([view.lng[i], view.lat[i]]).addTo(map);
  }, [map, view, hoverT]);

  const recenter = useCallback(
    (pitch: number) => {
      const m = mapRef.current;
      if (!m) return;
      const b = boundsRef.current;
      m.fitBounds(
        [
          [b.minLng, b.minLat],
          [b.maxLng, b.maxLat],
        ],
        { padding: PADDING, pitch, bearing: 0, duration: prefersReducedMotion() ? 0 : 700 }
      );
    },
    []
  );

  const toggle3d = () => {
    const m = mapRef.current;
    if (!m) return;
    const next = !is3d;
    setIs3d(next);
    m.setTerrain(next ? { source: "terrain", exaggeration: TERRAIN_EXAGGERATION } : null);
    const opts = { pitch: next ? PITCH_3D : 0, ...(next ? {} : { bearing: 0 }) };
    if (prefersReducedMotion()) m.jumpTo(opts);
    else m.easeTo({ ...opts, duration: 500 });
  };

  const toggleReplay = () => {
    setReplayOn((on) => {
      if (on) onHoverRef.current?.(null);
      return !on;
    });
  };

  const onReplayTime = useCallback((t: number | null) => onHoverRef.current?.(t), []);

  if (failed) return <RouteMap polyline={polyline} bounds={bounds} fogShapes={fogShapes} />;

  const values = view ? metricSeries(view, metric) : null;
  const domain = values ? metricDomain(values, metric) : null;

  return (
    <div className="rounded-lg overflow-hidden" style={{ position: "relative", aspectRatio: "16/10", minHeight: 260 }}>
      {!shown && <MapSkeleton polyline={polyline} />}
      <div
        ref={containerRef}
        style={{
          position: "absolute",
          inset: 0,
          opacity: shown ? 1 : 0,
          transition: prefersReducedMotion() ? undefined : "opacity 300ms ease",
        }}
      />

      {map && shown && (
        <>
          {/* top-left: metric picker + legend */}
          {view && domain && (
            <div style={{ position: "absolute", top: 8, left: 8, display: "flex", flexDirection: "column", gap: 6, pointerEvents: "none" }}>
              {metrics.length > 1 && (
                <div role="radiogroup" aria-label="route color" style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                  {metrics.map((mt) => (
                    <button
                      key={mt}
                      type="button"
                      role="radio"
                      aria-checked={mt === metric}
                      onClick={() => setMetric(mt)}
                      className="font-sans"
                      style={{
                        ...btn,
                        background: mt === metric ? "var(--theme-text-primary)" : btn.background,
                        color: mt === metric ? "var(--theme-bg)" : btn.color,
                      }}
                    >
                      {METRIC_LABELS[mt]}
                    </button>
                  ))}
                </div>
              )}
              <div
                className="font-sans"
                style={{ ...btn, cursor: "default", pointerEvents: "none", display: "flex", alignItems: "center", gap: 6, width: "fit-content" }}
              >
                <span>{formatMetric(domain[0], metric)}</span>
                <span aria-hidden style={{ width: 56, height: 6, borderRadius: 3, background: legendGradient() }} />
                <span>{formatMetric(domain[1], metric)}</span>
              </div>
            </div>
          )}

          {/* top-right: 2d/3d, recenter, replay */}
          <div style={{ position: "absolute", top: 8, right: 8, display: "flex", gap: 4, pointerEvents: "none" }}>
            <button type="button" className="font-sans" style={btn} onClick={toggle3d} aria-label={is3d ? "switch to 2d" : "switch to 3d"}>
              {is3d ? "2d" : "3d"}
            </button>
            <button type="button" className="font-sans" style={btn} onClick={() => recenter(is3d ? PITCH_3D : 0)} aria-label="recenter">
              recenter
            </button>
            {replay && (
              <button type="button" className="font-sans" style={btn} onClick={toggleReplay} aria-pressed={replayOn}>
                {replayOn ? "exit replay" : "replay"}
              </button>
            )}
          </div>

          {replayOn && replay && (
            <div style={{ position: "absolute", left: 0, right: 0, bottom: 0 }}>
              <ReplayPlayer map={map} replay={replay} photos={photos} sportType={sportType} onTime={onReplayTime} />
            </div>
          )}
        </>
      )}

      {children && <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>{children}</div>}

      {contextLost && (
        <div
          className="font-sans text-gray text-sm"
          style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "var(--theme-bg)" }}
        >
          map paused
        </div>
      )}
    </div>
  );
}
