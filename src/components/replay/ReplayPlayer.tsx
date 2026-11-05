"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import type maplibregl from "maplibre-gl";
import type { ReplayData } from "@/lib/replay/build";
import {
  activeEvents,
  avatarFogAlpha,
  buildEvents,
  buildTimeline,
  chaseStep,
  defaultSpeed,
  photoMoments,
  photoOpacity,
  playMap,
  positionAt,
  replayToWall,
  trailUpTo,
  wallToReplay,
  SPEED_CHOICES,
  type ChaseState,
  type DistanceUnit,
  type PlayMap,
  type ReplayEvent,
} from "@/lib/replay/engine";
import { fogPuffs, decoySeed } from "@/lib/replay/decoy";
import { chipKey, chipLabel, formatClock, formatSpeedChoice } from "@/lib/replay/labels";

export interface ReplayPhoto {
  url: string;
  width: number | null;
  height: number | null;
  pin: [number, number] | null; // [lat, lng]
}

export interface ReplayPlayerProps {
  map: maplibregl.Map;
  replay: ReplayData;
  photos: ReplayPhoto[];
  sportType: string;
  onTime?: (t: number | null) => void;
  // optional extras, safe to leave out
  unit?: DistanceUnit; // split markers (default km)
  showMaxSpeed?: boolean;
  activityId?: string | number; // seeds the fog decoys (public endpoints otherwise)
  onClose?: () => void; // when given, close hands control back to the parent
}

const P = "replay-"; // source/layer id prefix
const FOG_SRC = `${P}fog`;
const TRAIL_SRC = `${P}trail`;
const ENDS_SRC = `${P}ends`;
const LAYERS = [`${P}fog-0`, `${P}fog-1`, `${P}trail-casing`, `${P}trail`, `${P}start`, `${P}end`];
// the static map's own endpoint markers, hidden while the replay draws its own
const STATIC_END_LAYERS = ["am-ends", "route-start", "route-end"]; // the 3d map's start/end layer (am-ends), plus legacy ids
const TICK_MS = 100; // ui, trail and onTime refresh
const MAX_FRAME_S = 0.25; // longer frames are clamped (a hidden tab pauses instead)
const NO_PADDING = { top: 0, right: 0, bottom: 0, left: 0 };
const FOG_PERIOD_S = 7;
const SCRUB_STEP_S = 2; // wall seconds per arrow press
const PHOTO_PX = 64;

// site theme, read from the class ThemeProvider puts on <html>
function subscribeTheme(cb: () => void) {
  const mo = new MutationObserver(cb);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => mo.disconnect();
}
const darkSnapshot = () => !document.documentElement.classList.contains("theme-light");
const darkServer = () => true;

// the route map inverts the light basemap in dark mode with a css filter;
// anything drawn inside it gets inverted too, so colours flip to match
function hasInvertedAncestor(el: HTMLElement | null): boolean {
  for (let e = el; e && e !== document.body; e = e.parentElement) {
    const f = getComputedStyle(e).filter;
    if (f && f !== "none" && f.includes("invert")) return true;
  }
  return false;
}

interface Palette {
  ink: string; // trail, avatar
  paper: string; // casing, avatar ring
  fog: string;
}

function palette(drawDark: boolean): Palette {
  return drawDark ? { ink: "#eeeeee", paper: "#1a1a1a", fog: "#cfcfcf" } : { ink: "#1a1a1a", paper: "#ffffff", fog: "#7a7a7a" };
}

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function avatarElement(): { root: HTMLDivElement; solid: HTMLDivElement; ghost: HTMLDivElement } {
  const root = document.createElement("div");
  root.style.cssText = "width:44px;height:44px;position:relative;pointer-events:none;";
  const solid = document.createElement("div");
  solid.style.cssText = "position:absolute;inset:0;transition:none;";
  solid.innerHTML =
    '<svg width="44" height="44" viewBox="0 0 44 44" aria-hidden="true">' +
    '<defs><linearGradient id="replay-cone" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="currentColor" stop-opacity="0.55"/><stop offset="1" stop-color="currentColor" stop-opacity="0"/></linearGradient></defs>' +
    '<path d="M22 22 L11 2 Q22 -2 33 2 Z" fill="url(#replay-cone)"/>' +
    '<circle cx="22" cy="22" r="7" fill="currentColor" stroke="var(--replay-paper)" stroke-width="2.5"/></svg>';
  const ghost = document.createElement("div");
  ghost.style.cssText =
    "position:absolute;left:12px;top:12px;width:20px;height:20px;border-radius:50%;background:currentColor;filter:blur(3px);opacity:0;";
  root.append(ghost, solid);
  return { root, solid, ghost };
}

type MarkerCtor = typeof maplibregl.Marker;

export default function ReplayPlayer({
  map,
  replay,
  photos,
  sportType,
  onTime,
  unit = "km",
  showMaxSpeed = false,
  activityId,
  onClose,
}: ReplayPlayerProps) {
  const tl = useMemo(() => buildTimeline({ ...replay, sportType: sportType || replay.sportType }, { activityId }), [replay, sportType, activityId]);
  const events = useMemo(() => buildEvents(tl, { unit, maxSpeed: showMaxSpeed }), [tl, unit, showMaxSpeed]);
  // by content, so a fresh array each parent render doesn't rebuild the layers
  const photosKey = JSON.stringify(photos.map((p) => [p.url, p.width, p.height, p.pin]));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stablePhotos = useMemo(() => photos, [photosKey]);
  const moments = useMemo(() => photoMoments(tl, stablePhotos.map((p) => p.pin)), [tl, stablePhotos]);

  const dark = useSyncExternalStore(subscribeTheme, darkSnapshot, darkServer);
  const container = map.getContainer();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const inverted = useMemo(() => hasInvertedAncestor(container), [container, dark]);
  const pal = useMemo(() => palette(dark !== inverted), [dark, inverted]);

  const [open, setOpen] = useState(true);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState<number>(() => defaultSpeed(tl));
  const [chase, setChase] = useState(() => !reducedMotion());
  const [ui, setUi] = useState({ wall: 0, t: 0 });

  const pm = useMemo(() => playMap(tl, speed), [tl, speed]);

  // the frame loop reads everything through refs
  const wallRef = useRef(0);
  const playingRef = useRef(playing);
  const chaseRef = useRef(chase);
  const pmRef = useRef<PlayMap>(pm);
  const palRef = useRef(pal);
  const dirtyRef = useRef(true);
  const onTimeRef = useRef(onTime);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    onTimeRef.current = onTime;
  }, [onTime]);
  useEffect(() => {
    playingRef.current = playing;
    dirtyRef.current = true;
  }, [playing]);
  useEffect(() => {
    chaseRef.current = chase;
    dirtyRef.current = true;
  }, [chase]);
  useEffect(() => {
    // keep the same replay moment when the speed changes
    const t = wallToReplay(pmRef.current, wallRef.current);
    pmRef.current = pm;
    wallRef.current = replayToWall(pm, t);
    dirtyRef.current = true;
  }, [pm]);

  // theme: repaint layers and the avatar
  useEffect(() => {
    palRef.current = pal;
    dirtyRef.current = true;
    if (!open) return;
    try {
      if (map.getLayer(`${P}trail`)) map.setPaintProperty(`${P}trail`, "line-color", pal.ink);
      if (map.getLayer(`${P}trail-casing`)) map.setPaintProperty(`${P}trail-casing`, "line-color", pal.paper);
      for (const id of [`${P}fog-0`, `${P}fog-1`]) if (map.getLayer(id)) map.setPaintProperty(id, "circle-color", pal.fog);
      if (map.getLayer(`${P}start`)) {
        map.setPaintProperty(`${P}start`, "circle-color", pal.ink);
        map.setPaintProperty(`${P}start`, "circle-stroke-color", pal.paper);
      }
      if (map.getLayer(`${P}end`)) {
        map.setPaintProperty(`${P}end`, "circle-color", pal.paper);
        map.setPaintProperty(`${P}end`, "circle-stroke-color", pal.ink);
      }
    } catch {
      // style mid-reload; the styledata handler re-adds with fresh colours
    }
  }, [pal, map, open]);

  const seekWall = useCallback((w: number) => {
    const pmNow = pmRef.current;
    wallRef.current = Math.max(0, Math.min(pmNow.wallS, w));
    dirtyRef.current = true;
    setUi({ wall: wallRef.current, t: wallToReplay(pmNow, wallRef.current) });
  }, []);

  const togglePlay = useCallback(() => {
    setPlaying((p) => {
      if (!p && wallRef.current >= pmRef.current.wallS - 1e-6) wallRef.current = 0; // replay from the start
      return !p;
    });
  }, []);

  // map layers, markers and the frame loop
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    let raf = 0;
    let Marker: MarkerCtor | null = null;
    let avatar: maplibregl.Marker | null = null;
    let avatarEl: ReturnType<typeof avatarElement> | null = null;
    const photoMarkers = new Map<number, { marker: maplibregl.Marker; el: HTMLDivElement }>();
    const reduce = reducedMotion();
    let chaseState: ChaseState | null = null;
    let last = 0;
    let lastTick = 0;
    let lastFog = 0;
    let lastT = -1;
    let lastTrailIdx = -2;
    let lastOnTime = -1;
    let lastFollow = 0;

    const fogData = {
      type: "FeatureCollection" as const,
      features: tl.gaps.flatMap((g) =>
        g.blob
          ? fogPuffs(g.blob, decoySeed(g.index, g.from, g.to, activityId)).map((p) => ({
              type: "Feature" as const,
              properties: {
                // pixels at zoom 0 (512-px tiles); doubles per zoom level
                px0: p.radiusM / ((40075016.686 * Math.cos((p.lat * Math.PI) / 180)) / 512),
                phase: p.phase,
              },
              geometry: { type: "Point" as const, coordinates: [p.lng, p.lat] },
            }))
          : []
      ),
    };
    const endPoint = (i: number, end: number) => ({
      type: "Feature" as const,
      properties: { end },
      geometry: { type: "Point" as const, coordinates: [tl.lng[i], tl.lat[i]] },
    });
    const endsData = { type: "FeatureCollection" as const, features: tl.n > 0 ? [endPoint(0, 0), endPoint(tl.n - 1, 1)] : [] };
    const hidden = new Map<string, unknown>(); // static layers we hid â†’ their visibility
    const emptyTrail = { type: "Feature" as const, properties: {}, geometry: { type: "MultiLineString" as const, coordinates: [] as number[][][] } };

    function addLayers() {
      const c = palRef.current;
      if (!map.getSource(FOG_SRC)) map.addSource(FOG_SRC, { type: "geojson", data: fogData });
      if (!map.getSource(TRAIL_SRC)) {
        map.addSource(TRAIL_SRC, { type: "geojson", data: emptyTrail });
        lastTrailIdx = -2;
        dirtyRef.current = true;
      }
      for (const phase of [0, 1]) {
        const id = `${P}fog-${phase}`;
        if (map.getLayer(id)) continue;
        map.addLayer({
          id,
          type: "circle",
          source: FOG_SRC,
          filter: ["==", ["get", "phase"], phase],
          paint: {
            "circle-radius": ["interpolate", ["exponential", 2], ["zoom"], 0, ["get", "px0"], 24, ["*", ["get", "px0"], 16777216]],
            "circle-blur": 1,
            "circle-color": c.fog,
            "circle-opacity": 0.3,
            "circle-pitch-alignment": "map",
            "circle-pitch-scale": "map",
          },
        });
      }
      if (!map.getLayer(`${P}trail-casing`)) {
        map.addLayer({
          id: `${P}trail-casing`,
          type: "line",
          source: TRAIL_SRC,
          paint: { "line-color": c.paper, "line-width": 7, "line-opacity": 0.55 },
          layout: { "line-join": "round", "line-cap": "round" },
        });
      }
      if (!map.getLayer(`${P}trail`)) {
        map.addLayer({
          id: `${P}trail`,
          type: "line",
          source: TRAIL_SRC,
          paint: { "line-color": c.ink, "line-width": 4 },
          layout: { "line-join": "round", "line-cap": "round" },
        });
      }
      // start: filled dot, end: ring. published endpoints only
      if (!map.getSource(ENDS_SRC)) map.addSource(ENDS_SRC, { type: "geojson", data: endsData });
      if (!map.getLayer(`${P}start`)) {
        map.addLayer({
          id: `${P}start`,
          type: "circle",
          source: ENDS_SRC,
          filter: ["==", ["get", "end"], 0],
          paint: { "circle-radius": 6, "circle-color": c.ink, "circle-stroke-color": c.paper, "circle-stroke-width": 2, "circle-pitch-alignment": "map" },
        });
      }
      if (!map.getLayer(`${P}end`)) {
        map.addLayer({
          id: `${P}end`,
          type: "circle",
          source: ENDS_SRC,
          filter: ["==", ["get", "end"], 1],
          paint: { "circle-radius": 6, "circle-color": c.paper, "circle-stroke-color": c.ink, "circle-stroke-width": 3, "circle-pitch-alignment": "map" },
        });
      }
      for (const id of STATIC_END_LAYERS) {
        if (map.getLayer(id) && map.getLayoutProperty(id, "visibility") !== "none") {
          if (!hidden.has(id)) hidden.set(id, map.getLayoutProperty(id, "visibility") ?? "visible");
          map.setLayoutProperty(id, "visibility", "none");
        }
      }
    }

    // idempotent: also re-adds after a style swap and hides static endpoint
    // layers that show up after the replay opened
    function tryAddLayers() {
      try {
        addLayers();
      } catch {
        // style not ready yet; styledata will call again
      }
    }

    // a user drag/rotate/zoom takes the camera back from the chase cam
    function onUserMove(e: { originalEvent?: unknown }) {
      if (e.originalEvent && chaseRef.current) setChase(false);
    }

    function onVisibility() {
      if (document.hidden) setPlaying(false);
    }

    function photoAt(i: number, opacity: number) {
      const m = moments[i];
      let entry = photoMarkers.get(i);
      if (opacity <= 0) {
        if (entry) {
          entry.marker.remove();
          photoMarkers.delete(i);
        }
        return;
      }
      if (!entry && Marker) {
        const ph = stablePhotos[m.photo];
        const el = document.createElement("div");
        const ar = ph.width && ph.height ? ph.width / ph.height : 1;
        const w = ar >= 1 ? PHOTO_PX : Math.round(PHOTO_PX * ar);
        const h = ar >= 1 ? Math.round(PHOTO_PX / ar) : PHOTO_PX;
        el.style.cssText = `width:${w}px;height:${h}px;border-radius:6px;overflow:hidden;pointer-events:none;box-shadow:0 2px 8px rgba(0,0,0,.35);border:2px solid var(--replay-paper);`;
        const img = document.createElement("img");
        img.src = ph.url;
        img.alt = "";
        img.decoding = "async";
        img.style.cssText = `width:100%;height:100%;object-fit:cover;display:block;${inverted ? "filter:invert(1) hue-rotate(180deg);" : ""}`;
        el.appendChild(img);
        el.style.setProperty("--replay-paper", palRef.current.paper);
        const marker = new Marker({ element: el, anchor: "bottom", offset: [0, -14] }).setLngLat([m.lng, m.lat]).addTo(map);
        entry = { marker, el };
        photoMarkers.set(i, entry);
      }
      if (entry) {
        entry.el.style.opacity = String(opacity);
        entry.el.style.transform = `${entry.el.style.transform.replace(/ ?scale\([^)]*\)/, "")} scale(${0.85 + 0.15 * Math.min(1, opacity)})`;
      }
    }

    function frame(now: number) {
      raf = requestAnimationFrame(frame);
      const dt = last ? Math.min(MAX_FRAME_S, (now - last) / 1000) : 0;
      last = now;
      const pmNow = pmRef.current;

      if (playingRef.current) {
        wallRef.current += dt;
        if (wallRef.current >= pmNow.wallS) {
          wallRef.current = pmNow.wallS;
          setPlaying(false);
        }
      }
      const t = wallToReplay(pmNow, wallRef.current);
      const moved = t !== lastT || dirtyRef.current;
      const pos = positionAt(tl, t);

      if (moved && avatar && avatarEl) {
        avatar.setLngLat([pos.lng, pos.lat]);
        avatar.setRotation(pos.bearing);
        const a = pos.gap ? avatarFogAlpha(pos.gap.progress) : 1;
        avatarEl.solid.style.opacity = String(a);
        avatarEl.ghost.style.opacity = String((1 - a) * 0.75);
        avatarEl.root.style.color = palRef.current.ink;
        avatarEl.root.style.setProperty("--replay-paper", palRef.current.paper);
      }

      // trail: only when the drawn part changes, at most every tick
      const trailKey = pos.gap ? -1 - pos.index : pos.index;
      if ((moved && now - lastTick >= TICK_MS) || dirtyRef.current) {
        if (trailKey !== lastTrailIdx || !pos.gap) {
          const src = map.getSource(TRAIL_SRC) as maplibregl.GeoJSONSource | undefined;
          if (src) {
            src.setData({ ...emptyTrail, geometry: { type: "MultiLineString", coordinates: trailUpTo(tl, pos) } });
            lastTrailIdx = trailKey;
          }
        }
      }

      // camera
      if (chaseRef.current && (moved || chaseState === null || playingRef.current || dt > 0)) {
        const step = chaseStep(tl, chaseState, t, dt, pmNow.speed);
        const changed =
          !chaseState ||
          moved ||
          Math.abs(step.state.heading - chaseState.heading) > 0.02 ||
          Math.abs(step.state.zoom - chaseState.zoom) > 0.002;
        chaseState = step.state;
        // pad the bottom so the avatar sits in the part of the map the controls don't cover
        if (changed) map.jumpTo({ ...step.camera, padding: { ...NO_PADDING, bottom: rootRef.current?.offsetHeight ?? 0 } });
      } else if (!chaseRef.current) {
        chaseState = null;
        // keep the avatar in view without taking over the camera
        if (playingRef.current && now - lastFollow > 500) {
          lastFollow = now;
          if (!map.getBounds().contains([pos.lng, pos.lat])) map.easeTo({ center: [pos.lng, pos.lat], duration: reduce ? 0 : 500 });
        }
      }

      // photos
      if (moved) for (let i = 0; i < moments.length; i++) photoAt(i, photoOpacity(pmNow, moments[i], t));

      // fog breathing: two puff layers in opposite phase, ~10 fps
      if (!reduce && fogData.features.length > 0 && now - lastFog > 100) {
        lastFog = now;
        const s = Math.sin(((now / 1000) * 2 * Math.PI) / FOG_PERIOD_S);
        try {
          if (map.getLayer(`${P}fog-0`)) map.setPaintProperty(`${P}fog-0`, "circle-opacity", 0.3 + 0.08 * s);
          if (map.getLayer(`${P}fog-1`)) map.setPaintProperty(`${P}fog-1`, "circle-opacity", 0.3 - 0.08 * s);
        } catch {
          // style swapping
        }
      }

      if (now - lastTick >= TICK_MS || dirtyRef.current) {
        lastTick = now;
        if (moved) setUi({ wall: wallRef.current, t });
        if (t !== lastOnTime) {
          lastOnTime = t;
          onTimeRef.current?.(t);
        }
      }
      lastT = t;
      dirtyRef.current = false;
    }

    (async () => {
      const mod = (await import("maplibre-gl")).default;
      if (cancelled) return;
      Marker = mod.Marker;
      avatarEl = avatarElement();
      const start = positionAt(tl, 0);
      avatar = new Marker({ element: avatarEl.root, rotationAlignment: "map", pitchAlignment: "map" })
        .setLngLat([start.lng, start.lat])
        .addTo(map);
      tryAddLayers();
      map.on("styledata", tryAddLayers);
      map.on("dragstart", onUserMove);
      map.on("rotatestart", onUserMove);
      map.on("zoomstart", onUserMove);
      map.on("pitchstart", onUserMove);
      document.addEventListener("visibilitychange", onVisibility);
      dirtyRef.current = true;
      raf = requestAnimationFrame(frame);
    })();

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      map.off("styledata", tryAddLayers);
      map.off("dragstart", onUserMove);
      map.off("rotatestart", onUserMove);
      map.off("zoomstart", onUserMove);
      map.off("pitchstart", onUserMove);
      document.removeEventListener("visibilitychange", onVisibility);
      avatar?.remove();
      for (const { marker } of photoMarkers.values()) marker.remove();
      photoMarkers.clear();
      try {
        for (const id of LAYERS) if (map.getLayer(id)) map.removeLayer(id);
        for (const id of [FOG_SRC, TRAIL_SRC, ENDS_SRC]) if (map.getSource(id)) map.removeSource(id);
        for (const [id, vis] of hidden) if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", vis as "visible" | "none");
      } catch {
        // map already removed
      }
    };
    // the camera restore lives in close(), from cameraRef
  }, [open, map, tl, moments, stablePhotos, activityId, inverted]);

  // camera at open time, restored on close
  const cameraRef = useRef<{ center: maplibregl.LngLat; zoom: number; bearing: number; pitch: number } | null>(null);
  useEffect(() => {
    if (!open) return;
    cameraRef.current = { center: map.getCenter(), zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch() };
  }, [open, map]);

  const close = useCallback(() => {
    setPlaying(false);
    setOpen(false);
    const cam = cameraRef.current;
    if (cam) {
      try {
        map.easeTo({ ...cam, padding: NO_PADDING, duration: reducedMotion() ? 0 : 700 });
      } catch {
        // map gone
      }
    }
    onTimeRef.current?.(null);
    onClose?.();
  }, [map, onClose]);

  const reopen = useCallback(() => {
    wallRef.current = 0;
    setUi({ wall: 0, t: 0 });
    setPlaying(true);
    setOpen(true);
  }, []);

  // onTime(null) when the player goes away while still open
  const openRef = useRef(open);
  useEffect(() => {
    openRef.current = open;
  }, [open]);
  useEffect(
    () => () => {
      if (!openRef.current) return;
      // unmounted by the parent while open: give the camera back too
      const cam = cameraRef.current;
      if (cam) {
        try {
          map.easeTo({ ...cam, padding: NO_PADDING, duration: reducedMotion() ? 0 : 700 });
        } catch {
          // map gone
        }
      }
      onTimeRef.current?.(null);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  // keyboard: space plays/pauses, left/right scrub (shift for bigger steps).
  // only while focus is on the page body or inside the map, never in fields
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      const active = document.activeElement;
      const inScope = !active || active === document.body || container.contains(active);
      if (!inScope) return;
      const tag = target?.tagName;
      if (tag === "TEXTAREA" || tag === "SELECT" || target?.isContentEditable) return;
      if (tag === "INPUT" && (target as HTMLInputElement).type !== "range") return;
      if (e.key === " " || e.code === "Space") {
        if (tag === "BUTTON") return; // the button's own click handles it
        e.preventDefault();
        e.stopPropagation();
        togglePlay();
      } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        e.stopPropagation();
        const step = (e.shiftKey ? 5 : 1) * SCRUB_STEP_S * (e.key === "ArrowLeft" ? -1 : 1);
        seekWall(wallRef.current + step);
      }
    }
    // capture: runs before the map's own keyboard panning
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, container, togglePlay, seekWall]);

  // keep pointer and wheel input on the controls away from the map
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const stop = (e: Event) => e.stopPropagation();
    const kinds = ["pointerdown", "mousedown", "touchstart", "wheel", "dblclick", "contextmenu"];
    for (const k of kinds) el.addEventListener(k, stop, { passive: true });
    return () => {
      for (const k of kinds) el.removeEventListener(k, stop);
    };
  }, [open]);

  const chips = useMemo(() => activeEvents(events, pm, ui.t).slice(-3), [events, pm, ui.t]);
  const wallS = pm.wallS || 1;
  // when drawn inside an inverted map, use the opposite tokens so the filter
  // turns them back into the site's own
  const themeClass = inverted ? (dark ? "theme-light" : "theme-dark") : "";

  const body = !open ? (
    onClose ? null : (
      <div ref={rootRef} className={`replay-ui ${themeClass}`}>
        <button type="button" className="replay-reopen" onClick={reopen} aria-label="play the replay again">
          <PlayIcon /> replay
        </button>
      </div>
    )
  ) : (
    <div ref={rootRef} className={`replay-ui ${themeClass}`} role="region" aria-label="route replay">
      <div className="replay-chips" aria-live="polite">
        {chips.map((e) => (
          <span key={chipKey(e)} className={`replay-chip replay-chip-${e.kind}`}>
            {chipLabel(e, tl.sportType, unit)}
          </span>
        ))}
      </div>
      <div className="replay-panel">
        <div className="replay-timeline">
          <span className="replay-time">{formatClock(ui.t)}</span>
          <div className="replay-track">
            <Ticks events={events} pm={pm} />
            <input
              type="range"
              className="replay-range"
              min={0}
              max={wallS}
              step={0.01}
              value={Math.min(ui.wall, wallS)}
              onChange={(e) => seekWall(Number(e.target.value))}
              aria-label="replay position"
              aria-valuetext={formatClock(ui.t)}
            />
          </div>
          <span className="replay-time replay-time-total">{formatClock(tl.totalS)}</span>
        </div>
        <div className="replay-buttons">
          <button type="button" className="replay-btn" onClick={togglePlay} aria-label={playing ? "pause" : "play"}>
            {playing ? <PauseIcon /> : <PlayIcon />}
          </button>
          <label className="replay-speed">
            <span className="sr-only">speed</span>
            <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))} aria-label="replay speed">
              {SPEED_CHOICES.map((s) => (
                <option key={s} value={s}>
                  {formatSpeedChoice(s)}
                </option>
              ))}
            </select>
          </label>
          <span style={{ flex: 1 }} />
          <button
            type="button"
            className={`replay-btn ${chase ? "replay-btn-on" : ""}`}
            onClick={() => setChase((c) => !c)}
            aria-pressed={chase}
            aria-label="follow camera"
            title="follow camera"
          >
            <ChaseIcon />
          </button>
          <button type="button" className="replay-btn" onClick={close} aria-label="close replay" title="close">
            <CloseIcon />
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(
    <>
      <style>{CSS}</style>
      {body}
    </>,
    container
  );
}

// chips as marks on the timeline: fog and pauses as bands, the rest as ticks
function Ticks({ events, pm }: { events: ReplayEvent[]; pm: PlayMap }) {
  const W = pm.wallS || 1;
  return (
    <div className="replay-ticks" aria-hidden="true">
      {events.map((e) => {
        const a = (replayToWall(pm, e.t) / W) * 100;
        const b = (replayToWall(pm, e.endT) / W) * 100;
        if (e.kind === "fog" || e.kind === "pause") {
          return <span key={chipKey(e)} className={`replay-band replay-band-${e.kind}`} style={{ left: `${a}%`, width: `max(3px, ${b - a}%)` }} />;
        }
        return <span key={chipKey(e)} className={`replay-tick replay-tick-${e.kind}`} style={{ left: `${a}%` }} />;
      })}
    </div>
  );
}

function PlayIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path d="M5 3.2v11.6a.6.6 0 0 0 .9.5l9.3-5.8a.6.6 0 0 0 0-1L5.9 2.7a.6.6 0 0 0-.9.5Z" fill="currentColor" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <rect x="4" y="3" width="3.5" height="12" rx="1" fill="currentColor" />
      <rect x="10.5" y="3" width="3.5" height="12" rx="1" fill="currentColor" />
    </svg>
  );
}

function ChaseIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path d="M9 1.8 15 16l-6-3.2L3 16 9 1.8Z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path d="M4 4l10 10M14 4 4 14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

// scoped styles; colours come from the site's theme tokens
const CSS = `
.replay-ui{position:absolute;left:0;right:0;bottom:0;z-index:3;padding:8px;display:flex;flex-direction:column;gap:6px;pointer-events:none;font-family:inherit;color:var(--theme-text-primary);-webkit-tap-highlight-color:transparent}
.replay-chips{display:flex;flex-wrap:wrap;justify-content:center;gap:6px;min-height:26px;align-items:flex-end}
.replay-chip{font-size:12px;line-height:1;padding:7px 10px;border-radius:999px;background:color-mix(in oklch,var(--theme-bg) 86%,transparent);color:var(--theme-text-primary);border:1px solid var(--theme-divider);white-space:nowrap}
.replay-chip-fog{font-style:italic}
.replay-panel{pointer-events:auto;border-radius:10px;padding:4px 8px 6px;background:color-mix(in oklch,var(--theme-bg) 88%,transparent);border:1px solid var(--theme-divider)}
.replay-timeline{display:flex;align-items:center;gap:8px}
.replay-time{font-size:12px;font-variant-numeric:tabular-nums;color:var(--theme-text);min-width:3.2em}
.replay-time-total{text-align:right;color:var(--theme-text-muted)}
.replay-track{position:relative;flex:1;height:44px}
.replay-ticks{position:absolute;left:9px;right:9px;top:50%;height:12px;transform:translateY(-50%);pointer-events:none}
.replay-band,.replay-tick{position:absolute;top:0;bottom:0}
.replay-band{border-radius:2px}
.replay-band-fog{background:var(--theme-text-muted);opacity:.35}
.replay-band-pause{background:var(--theme-text-muted);opacity:.2}
.replay-tick{width:1px;background:var(--theme-text-muted);opacity:.55;top:3px;bottom:3px}
.replay-tick-cut{width:2px;top:0;bottom:0;opacity:.8}
.replay-tick-maxSpeed{width:5px;height:5px;border-radius:50%;top:-6px;bottom:auto;margin-left:-2px;opacity:.9;background:var(--theme-text-primary)}
.replay-range{position:absolute;inset:0;width:100%;height:44px;margin:0;background:transparent;-webkit-appearance:none;appearance:none;cursor:pointer;touch-action:none}
.replay-range:focus-visible{outline:2px solid var(--theme-text-primary);outline-offset:-2px;border-radius:6px}
.replay-range::-webkit-slider-runnable-track{height:4px;border-radius:2px;background:var(--theme-divider)}
.replay-range::-moz-range-track{height:4px;border-radius:2px;background:var(--theme-divider)}
.replay-range::-webkit-slider-thumb{-webkit-appearance:none;width:18px;height:18px;margin-top:-7px;border-radius:50%;background:var(--theme-text-primary);border:2px solid var(--theme-bg)}
.replay-range::-moz-range-thumb{width:14px;height:14px;border-radius:50%;background:var(--theme-text-primary);border:2px solid var(--theme-bg)}
.replay-buttons{display:flex;align-items:center;gap:6px}
.replay-btn,.replay-reopen{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-width:44px;height:44px;border-radius:8px;border:1px solid transparent;background:transparent;color:var(--theme-text-primary);cursor:pointer;font:inherit;font-size:14px}
.replay-btn:hover{background:var(--theme-highlight-bg-hover)}
.replay-btn:focus-visible,.replay-reopen:focus-visible,.replay-speed select:focus-visible{outline:2px solid var(--theme-text-primary);outline-offset:1px}
.replay-btn-on{background:var(--theme-highlight-bg-active);border-color:var(--theme-divider)}
.replay-speed select{height:44px;min-width:64px;padding:0 10px;border-radius:8px;border:1px solid var(--theme-divider);background:transparent;color:var(--theme-text-primary);font:inherit;font-size:14px;font-variant-numeric:tabular-nums;cursor:pointer}
.replay-speed option{background:var(--theme-bg);color:var(--theme-text-primary)}
.replay-reopen{pointer-events:auto;align-self:flex-start;padding:0 14px;background:color-mix(in oklch,var(--theme-bg) 88%,transparent);border-color:var(--theme-divider)}
.replay-ui .sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
`;
