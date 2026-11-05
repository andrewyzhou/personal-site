// grayscale maplibre style for the activity map, built in code so light and
// dark are real palettes (no css invert). sources: openfreemap vector tiles
// and the free aws/mapzen terrarium dem (terrain + hillshade). the route is
// added by the component and is the only color on the map.

import type { LayerSpecification, SkySpecification, StyleSpecification } from "maplibre-gl";

export type MapTheme = "light" | "dark";

export const OPENFREEMAP_TILEJSON = "https://tiles.openfreemap.org/planet";
export const OPENFREEMAP_GLYPHS = "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf";
export const TERRARIUM_TILES = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";
export const TERRAIN_ATTRIBUTION =
  '<a href="https://github.com/tilezen/joerd/blob/master/docs/attribution.md" target="_blank" rel="noopener">terrain: mapzen, aws terrain tiles</a>';
export const TERRAIN_EXAGGERATION = 1.2;
export const BUILDINGS_MINZOOM = 14;

const FONT = ["Noto Sans Regular"];

// achromatic oklch lightness → srgb hex, so the map uses the exact css tokens
export function oklchGray(l: number): string {
  const y = Math.max(0, Math.min(1, l)) ** 3;
  const c = y <= 0.0031308 ? 12.92 * y : 1.055 * y ** (1 / 2.4) - 0.055;
  const v = Math.round(Math.max(0, Math.min(1, c)) * 255);
  const h = v.toString(16).padStart(2, "0");
  return `#${h}${h}${h}`;
}

export interface MapPalette {
  background: string;
  water: string;
  park: string;
  wood: string;
  residential: string;
  building: string;
  buildingFlat: string;
  path: string;
  minor: string;
  major: string;
  motorway: string;
  casing: string;
  rail: string;
  boundary: string;
  label: string;
  labelStrong: string;
  halo: string;
  shadow: string;
  highlight: string;
  accent: string;
  hillshadeExaggeration: number;
  buildingOpacity: number;
}

// lightness values in oklch %, anchored on the globals.css tokens:
// light bg 94.9 / text 17.3 / muted 45.0; dark bg 17.3 / text 94.9 / muted 73.8
const L = (p: number) => oklchGray(p / 100);

export const PALETTES: Record<MapTheme, MapPalette> = {
  light: {
    background: L(94.9),
    water: L(86.5),
    park: L(91.5),
    wood: L(90.5),
    residential: L(93.5),
    building: L(88),
    buildingFlat: L(90),
    path: L(82),
    minor: L(99),
    major: L(100),
    motorway: L(100),
    casing: L(87),
    rail: L(84),
    boundary: L(75),
    label: L(45),
    labelStrong: L(32.1),
    halo: L(94.9),
    shadow: L(30),
    highlight: L(100),
    accent: L(60),
    hillshadeExaggeration: 0.35,
    buildingOpacity: 0.75,
  },
  dark: {
    background: L(17.3),
    water: L(13),
    park: L(19.5),
    wood: L(20.5),
    residential: L(18.3),
    building: L(25),
    buildingFlat: L(22),
    path: L(33),
    minor: L(26),
    major: L(30.9),
    motorway: L(34),
    casing: L(21),
    rail: L(28),
    boundary: L(36),
    label: L(73.8),
    labelStrong: L(84.5),
    halo: L(17.3),
    shadow: L(5),
    highlight: L(40),
    accent: L(12),
    hillshadeExaggeration: 0.4,
    buildingOpacity: 0.8,
  },
};

const lineGeom = ["match", ["geometry-type"], ["LineString", "MultiLineString"], true, false];
const polyGeom = ["match", ["geometry-type"], ["MultiPolygon", "Polygon"], true, false];
const nameField = ["coalesce", ["get", "name:latin"], ["get", "name_en"], ["get", "name"]];

export interface MapStyleOptions {
  terrain?: boolean; // 3d terrain on load (false: flat, hillshade only)
  terrainMaxzoom?: number; // dem source maxzoom (lower on phones)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const layer = (l: any) => l as LayerSpecification;

export function buildMapLayers(theme: MapTheme): LayerSpecification[] {
  const p = PALETTES[theme];
  const roadWidth = (base: number, top: number) => ["interpolate", ["exponential", 1.4], ["zoom"], 10, base, 18, top];
  return [
    layer({ id: "background", type: "background", paint: { "background-color": p.background } }),
    layer({
      id: "landuse-residential",
      type: "fill",
      source: "openmaptiles",
      "source-layer": "landuse",
      filter: ["all", polyGeom, ["==", ["get", "class"], "residential"]],
      paint: { "fill-color": p.residential },
    }),
    layer({
      id: "landcover-wood",
      type: "fill",
      source: "openmaptiles",
      "source-layer": "landcover",
      filter: ["all", polyGeom, ["match", ["get", "class"], ["wood", "grass"], true, false]],
      paint: { "fill-color": p.wood, "fill-opacity": 0.7 },
    }),
    layer({
      id: "park",
      type: "fill",
      source: "openmaptiles",
      "source-layer": "park",
      filter: polyGeom,
      paint: { "fill-color": p.park },
    }),
    layer({
      id: "hillshade",
      type: "hillshade",
      source: "hillshade",
      paint: {
        "hillshade-shadow-color": p.shadow,
        "hillshade-highlight-color": p.highlight,
        "hillshade-accent-color": p.accent,
        "hillshade-exaggeration": p.hillshadeExaggeration,
      },
    }),
    layer({
      id: "water",
      type: "fill",
      source: "openmaptiles",
      "source-layer": "water",
      filter: ["all", polyGeom, ["!=", ["get", "brunnel"], "tunnel"]],
      paint: { "fill-color": p.water },
    }),
    layer({
      id: "waterway",
      type: "line",
      source: "openmaptiles",
      "source-layer": "waterway",
      filter: lineGeom,
      paint: { "line-color": p.water, "line-width": ["interpolate", ["linear"], ["zoom"], 10, 0.5, 16, 3] },
    }),
    layer({
      id: "building-flat",
      type: "fill",
      source: "openmaptiles",
      "source-layer": "building",
      minzoom: 13,
      maxzoom: BUILDINGS_MINZOOM,
      paint: { "fill-color": p.buildingFlat },
    }),
    layer({
      id: "highway-path",
      type: "line",
      source: "openmaptiles",
      "source-layer": "transportation",
      minzoom: 12,
      filter: ["all", lineGeom, ["match", ["get", "class"], ["path", "track"], true, false]],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": p.path,
        "line-width": ["interpolate", ["linear"], ["zoom"], 13, 0.6, 18, 2],
        "line-dasharray": [2, 1.5],
      },
    }),
    layer({
      id: "highway-minor-casing",
      type: "line",
      source: "openmaptiles",
      "source-layer": "transportation",
      minzoom: 13,
      filter: ["all", lineGeom, ["match", ["get", "class"], ["minor", "service"], true, false]],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": p.casing, "line-width": roadWidth(1, 14) },
    }),
    layer({
      id: "highway-minor",
      type: "line",
      source: "openmaptiles",
      "source-layer": "transportation",
      minzoom: 11,
      filter: ["all", lineGeom, ["match", ["get", "class"], ["minor", "service"], true, false]],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": p.minor, "line-width": roadWidth(0.5, 11) },
    }),
    layer({
      id: "highway-major",
      type: "line",
      source: "openmaptiles",
      "source-layer": "transportation",
      minzoom: 8,
      filter: ["all", lineGeom, ["match", ["get", "class"], ["primary", "secondary", "tertiary", "trunk"], true, false]],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": p.major, "line-width": roadWidth(1, 16) },
    }),
    layer({
      id: "highway-motorway",
      type: "line",
      source: "openmaptiles",
      "source-layer": "transportation",
      minzoom: 5,
      filter: ["all", lineGeom, ["==", ["get", "class"], "motorway"]],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": p.motorway, "line-width": roadWidth(1.2, 18) },
    }),
    layer({
      id: "railway",
      type: "line",
      source: "openmaptiles",
      "source-layer": "transportation",
      minzoom: 12,
      filter: ["all", lineGeom, ["match", ["get", "class"], ["rail", "transit"], true, false]],
      paint: { "line-color": p.rail, "line-width": 1 },
    }),
    layer({
      id: "boundary",
      type: "line",
      source: "openmaptiles",
      "source-layer": "boundary",
      filter: ["all", ["<=", ["get", "admin_level"], 4], ["!=", ["get", "maritime"], 1]],
      paint: { "line-color": p.boundary, "line-width": 0.8, "line-dasharray": [3, 2] },
    }),
    layer({
      id: "building-3d",
      type: "fill-extrusion",
      source: "openmaptiles",
      "source-layer": "building",
      minzoom: BUILDINGS_MINZOOM,
      paint: {
        "fill-extrusion-color": p.building,
        "fill-extrusion-height": ["coalesce", ["get", "render_height"], 0],
        "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], 0],
        // fade in so they don't pop at the minzoom
        "fill-extrusion-opacity": ["interpolate", ["linear"], ["zoom"], BUILDINGS_MINZOOM, 0, BUILDINGS_MINZOOM + 0.8, p.buildingOpacity],
      },
    }),
    // labels: water, road names (close in), places. no pois, no shields.
    layer({
      id: "label-water",
      type: "symbol",
      source: "openmaptiles",
      "source-layer": "water_name",
      minzoom: 10,
      layout: { "text-field": nameField, "text-font": FONT, "text-size": 11, "text-max-width": 6 },
      paint: { "text-color": p.label, "text-halo-color": p.halo, "text-halo-width": 1 },
    }),
    layer({
      id: "label-road",
      type: "symbol",
      source: "openmaptiles",
      "source-layer": "transportation_name",
      minzoom: 14,
      filter: ["match", ["get", "class"], ["primary", "secondary", "tertiary", "trunk", "minor"], true, false],
      layout: {
        "symbol-placement": "line",
        "text-field": nameField,
        "text-font": FONT,
        "text-size": 10.5,
        "text-rotation-alignment": "map",
      },
      paint: { "text-color": p.label, "text-halo-color": p.halo, "text-halo-width": 1.2 },
    }),
    layer({
      id: "label-place-minor",
      type: "symbol",
      source: "openmaptiles",
      "source-layer": "place",
      minzoom: 11,
      filter: ["match", ["get", "class"], ["suburb", "neighbourhood", "hamlet", "quarter"], true, false],
      layout: {
        "text-field": nameField,
        "text-font": FONT,
        "text-size": 11,
        "text-max-width": 8,
        "text-transform": "lowercase",
      },
      paint: { "text-color": p.label, "text-halo-color": p.halo, "text-halo-width": 1.2 },
    }),
    layer({
      id: "label-place",
      type: "symbol",
      source: "openmaptiles",
      "source-layer": "place",
      minzoom: 4,
      filter: ["match", ["get", "class"], ["city", "town", "village"], true, false],
      layout: {
        "text-field": nameField,
        "text-font": FONT,
        "text-size": ["interpolate", ["linear"], ["zoom"], 6, 11, 12, 14],
        "text-max-width": 8,
        "text-transform": "lowercase",
      },
      paint: { "text-color": p.labelStrong, "text-halo-color": p.halo, "text-halo-width": 1.4 },
    }),
  ];
}

export function buildSky(theme: MapTheme): SkySpecification {
  const p = PALETTES[theme];
  return {
    "sky-color": p.background,
    "horizon-color": p.background,
    "fog-color": p.background,
    "sky-horizon-blend": 0.6,
    "horizon-fog-blend": 0.6,
    "fog-ground-blend": 0.8,
    "atmosphere-blend": 0,
  };
}

export function buildMapStyle(theme: MapTheme, opts: MapStyleOptions = {}): StyleSpecification {
  const maxzoom = opts.terrainMaxzoom ?? 14;
  const dem = {
    type: "raster-dem" as const,
    tiles: [TERRARIUM_TILES],
    encoding: "terrarium" as const,
    tileSize: 256,
    maxzoom,
  };
  return {
    version: 8,
    glyphs: OPENFREEMAP_GLYPHS,
    sources: {
      openmaptiles: { type: "vector", url: OPENFREEMAP_TILEJSON },
      // separate dem sources for terrain and hillshade (maplibre renders both
      // better that way); same tiles, so the browser cache shares them
      terrain: { ...dem, attribution: TERRAIN_ATTRIBUTION },
      hillshade: dem,
    },
    layers: buildMapLayers(theme),
    sky: buildSky(theme),
    ...(opts.terrain === false ? {} : { terrain: { source: "terrain", exaggeration: TERRAIN_EXAGGERATION } }),
  };
}

export interface PaintUpdate {
  layer: string;
  prop: string;
  value: unknown;
}

// paint changes that turn one theme into the other, applied in place so the
// route and replay layers survive a theme switch (setStyle would drop them)
export function themePaintUpdates(to: MapTheme): PaintUpdate[] {
  const out: PaintUpdate[] = [];
  for (const l of buildMapLayers(to)) {
    const paint = (l as { paint?: Record<string, unknown> }).paint ?? {};
    for (const [prop, value] of Object.entries(paint)) out.push({ layer: l.id, prop, value });
  }
  return out;
}

// overlay grays the component draws (route casing, fog, hover marker)
export const OVERLAY: Record<MapTheme, { casing: string; casingOpacity: number; fog: string; marker: string; markerRing: string }> = {
  light: { casing: "#000000", casingOpacity: 0.22, fog: "#000000", marker: L(17.3), markerRing: L(100) },
  dark: { casing: "#000000", casingOpacity: 0.55, fog: "#ffffff", marker: L(94.9), markerRing: L(17.3) },
};
