// track-file parsing: container unwrap (zip/gzip) + fit decode via the official
// garmin sdk + gpx/tcx via togeojson. produces one normalized shape that the
// parse route, publish pipeline, import script, and future intervals.icu pull share.

import { Decoder, Stream } from "@garmin/fitsdk";
import { gunzipSync, unzipSync } from "fflate";
import { DOMParser } from "@xmldom/xmldom";
import { gpx as gpxToGeojson, tcx as tcxToGeojson } from "@tmcw/togeojson";
import { cumulativeDistances, type ComputedStats, type TrackRecord } from "./geo";

export type TrackFileType = "fit" | "gpx" | "tcx";

export interface ParsedTrackFile {
  fileType: TrackFileType;
  sportType: string; // strava-style key, matches ACTIVITY_ICONS in ActivityCalendar
  startDateUtc: Date;
  utcOffsetMin: number; // 0 when the file carries no local-time info
  hasLocalTime: boolean;
  records: TrackRecord[];
  cumDist: number[]; // device-reported cumulative distance when available, else haversine
  sessionStats: ComputedStats | null; // used verbatim at zero trim (no recompute drift)
  kilojoules: number | null;
  suggestedName: string;
}

const SEMICIRCLE = 180 / 2 ** 31;
// seconds between unix epoch and the garmin epoch (1989-12-31T00:00:00Z)
const GARMIN_EPOCH_OFFSET_S = 631065600;

// ---------------------------------------------------------------------------
// container handling

function isGzip(b: Uint8Array): boolean {
  return b.length > 2 && b[0] === 0x1f && b[1] === 0x8b;
}

function isZip(b: Uint8Array): boolean {
  return b.length > 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;
}

function isFitBytes(b: Uint8Array): boolean {
  // fit header carries ".FIT" at offset 8
  return (
    b.length > 12 &&
    b[8] === 0x2e && b[9] === 0x46 && b[10] === 0x49 && b[11] === 0x54
  );
}

function sniffXmlType(b: Uint8Array): TrackFileType | null {
  const head = new TextDecoder().decode(b.slice(0, 2000));
  if (head.includes("<gpx")) return "gpx";
  if (head.includes("<TrainingCenterDatabase")) return "tcx";
  return null;
}

export interface UnwrappedTrack {
  bytes: Uint8Array;
  fileType: TrackFileType;
}

// unwrap zip (garmin "export original") and gzip (strava archive) containers and
// identify the inner track file. throws with a specific message on anything odd.
export function unwrapTrackFile(bytes: Uint8Array, filename: string): UnwrappedTrack {
  if (isGzip(bytes)) {
    return unwrapTrackFile(gunzipSync(bytes), filename.replace(/\.gz$/i, ""));
  }
  if (isZip(bytes)) {
    const entries = unzipSync(bytes, {
      filter: (f) => /\.(fit|gpx|tcx)(\.gz)?$/i.test(f.name) && !f.name.startsWith("__MACOSX"),
    });
    const names = Object.keys(entries);
    if (names.length === 0) {
      throw new Error("zip contains no .fit/.gpx/.tcx file");
    }
    if (names.length > 1) {
      throw new Error(`zip contains ${names.length} track files (${names.join(", ")}) — upload one at a time`);
    }
    return unwrapTrackFile(entries[names[0]], names[0]);
  }
  if (isFitBytes(bytes)) {
    return { bytes, fileType: "fit" };
  }
  const xml = sniffXmlType(bytes);
  if (xml) {
    return { bytes, fileType: xml };
  }
  // fall back to the filename extension for content we failed to sniff
  const ext = filename.toLowerCase().match(/\.(fit|gpx|tcx)$/)?.[1] as TrackFileType | undefined;
  if (ext) {
    return { bytes, fileType: ext };
  }
  throw new Error("unsupported file — expected .fit, .zip (garmin export original), .gpx, or .tcx");
}

// ---------------------------------------------------------------------------
// sport mapping (fit sport/subSport → strava-style keys the calendar already handles)

export function mapSport(sport?: string, subSport?: string): string {
  const s = (sport || "").toLowerCase();
  const ss = (subSport || "").toLowerCase();
  switch (s) {
    case "running":
      if (ss === "trail") return "TrailRun";
      if (ss === "virtual_activity") return "VirtualRun";
      return "Run";
    case "cycling":
      if (ss === "virtual_activity") return "VirtualRide";
      if (ss === "mountain") return "MountainBikeRide";
      if (ss === "gravel_cycling") return "GravelRide";
      return "Ride";
    case "swimming":
      return "Swim";
    case "walking":
      return "Walk";
    case "hiking":
      return "Hike";
    case "training":
      return ss === "strength_training" ? "WeightTraining" : "Workout";
    case "fitness_equipment":
      return "Workout";
    case "yoga":
      return "Yoga";
    case "tennis":
      return "Tennis";
    case "soccer":
      return "Soccer";
    case "rock_climbing":
      return "RockClimbing";
    default:
      return "Workout";
  }
}

const NAME_NOUNS: Record<string, string> = {
  Run: "run", TrailRun: "trail run", VirtualRun: "run",
  Ride: "ride", VirtualRide: "ride", MountainBikeRide: "mountain bike ride", GravelRide: "gravel ride",
  Swim: "swim", Walk: "walk", Hike: "hike",
  WeightTraining: "lift", Workout: "workout", Yoga: "yoga",
  Tennis: "tennis", Soccer: "soccer", RockClimbing: "climb",
};

export function suggestedName(sportType: string, localHour: number): string {
  const noun = NAME_NOUNS[sportType] ?? "workout";
  const bucket =
    localHour < 4 ? "night" : localHour < 12 ? "morning" : localHour < 17 ? "afternoon" : localHour < 21 ? "evening" : "night";
  return `${bucket} ${noun}`;
}

// ---------------------------------------------------------------------------
// fit decoding

interface FitRecordMesg {
  timestamp?: Date;
  positionLat?: number;
  positionLong?: number;
  altitude?: number;
  enhancedAltitude?: number;
  speed?: number;
  enhancedSpeed?: number;
  heartRate?: number;
  cadence?: number;
  power?: number;
  distance?: number;
}

interface FitSessionMesg {
  sport?: string;
  subSport?: string;
  startTime?: Date;
  totalElapsedTime?: number;
  totalTimerTime?: number;
  totalDistance?: number;
  totalAscent?: number;
  avgHeartRate?: number;
  maxHeartRate?: number;
  avgCadence?: number;
  avgPower?: number;
  maxPower?: number;
  totalWork?: number;
  avgSpeed?: number;
  maxSpeed?: number;
  enhancedAvgSpeed?: number;
  enhancedMaxSpeed?: number;
}

function decodeFit(bytes: Uint8Array): ParsedTrackFile {
  const stream = Stream.fromByteArray(bytes);
  const decoder = new Decoder(stream);
  if (!decoder.isFIT()) {
    throw new Error("not a fit file");
  }
  const { messages, errors } = decoder.read();
  if (errors.length > 0 && !messages.recordMesgs?.length && !messages.sessionMesgs?.length) {
    throw new Error(`could not decode fit file: ${String(errors[0]).slice(0, 120)}`);
  }

  // the sdk's type defs allow raw enum/epoch values, but with default decoder
  // options (convertTypesToStrings, convertDateTimesToDates — verified against
  // real files) sports are strings and timestamps are Dates
  const session = (messages.sessionMesgs?.[0] ?? {}) as unknown as FitSessionMesg;
  const recordMesgs = (messages.recordMesgs ?? []) as unknown as FitRecordMesg[];
  const sportType = mapSport(session.sport, session.subSport);

  const withTs = recordMesgs.filter((r): r is FitRecordMesg & { timestamp: Date } => r.timestamp instanceof Date);
  const t0 = withTs.length > 0 ? withTs[0].timestamp.getTime() : session.startTime?.getTime();
  if (t0 === undefined) {
    throw new Error("fit file has no timestamps");
  }

  const records: TrackRecord[] = [];
  const deviceDist: (number | null)[] = [];
  for (const r of withTs) {
    records.push({
      lat: r.positionLat !== undefined ? r.positionLat * SEMICIRCLE : null,
      lng: r.positionLong !== undefined ? r.positionLong * SEMICIRCLE : null,
      t: (r.timestamp.getTime() - t0) / 1000,
      ele: r.enhancedAltitude ?? r.altitude ?? null,
      hr: r.heartRate ?? null,
      cadence: r.cadence ?? null,
      watts: r.power ?? null,
      speed: r.enhancedSpeed ?? r.speed ?? null,
    });
    deviceDist.push(r.distance ?? null);
  }

  // prefer the device's cumulative distance channel; fall back to haversine
  let cumDist: number[];
  if (deviceDist.length > 0 && deviceDist.every((d) => d !== null)) {
    cumDist = deviceDist as number[];
  } else {
    cumDist = cumulativeDistances(records);
  }

  const startDateUtc = session.startTime instanceof Date ? session.startTime : new Date(t0);

  // local offset from the activity message: localTimestamp is wall-clock seconds
  // in the garmin epoch; timestamp is true utc
  let utcOffsetMin = 0;
  let hasLocalTime = false;
  const activity = messages.activityMesgs?.[0];
  if (activity) {
    const ts: unknown = activity.timestamp;
    const lt: unknown = activity.localTimestamp;
    if (ts instanceof Date && typeof lt === "number") {
      const localUnixS = lt + GARMIN_EPOCH_OFFSET_S;
      utcOffsetMin = Math.round((localUnixS - ts.getTime() / 1000) / 60);
      hasLocalTime = true;
    } else if (ts instanceof Date && lt instanceof Date) {
      utcOffsetMin = Math.round((lt.getTime() - ts.getTime()) / 60000);
      hasLocalTime = true;
    }
  }

  const sessionStats: ComputedStats | null = session.totalElapsedTime !== undefined
    ? {
        distanceM: session.totalDistance ?? 0,
        movingTimeS: Math.round(session.totalTimerTime ?? session.totalElapsedTime),
        elapsedTimeS: Math.round(session.totalElapsedTime),
        elevGainM: session.totalAscent ?? 0,
        avgSpeedMs: session.enhancedAvgSpeed ?? session.avgSpeed ?? 0,
        maxSpeedMs: session.enhancedMaxSpeed ?? session.maxSpeed ?? 0,
        avgHr: session.avgHeartRate ?? null,
        maxHr: session.maxHeartRate ?? null,
        avgCadence: session.avgCadence ?? null,
        avgWatts: session.avgPower ?? null,
        maxWatts: session.maxPower ?? null,
      }
    : null;

  const localHour = (Math.floor(startDateUtc.getTime() / 1000 + utcOffsetMin * 60) % 86400 + 86400) % 86400 / 3600;

  return {
    fileType: "fit",
    sportType,
    startDateUtc,
    utcOffsetMin,
    hasLocalTime,
    records,
    cumDist,
    sessionStats,
    kilojoules: session.totalWork !== undefined ? session.totalWork / 1000 : null,
    suggestedName: suggestedName(sportType, Math.floor(localHour)),
  };
}

// ---------------------------------------------------------------------------
// gpx / tcx decoding (togeojson + xmldom)

function decodeXml(bytes: Uint8Array, fileType: "gpx" | "tcx"): ParsedTrackFile {
  const text = new TextDecoder().decode(bytes);
  const dom = new DOMParser().parseFromString(text, "text/xml");
  // togeojson types expect a browser Document; xmldom's is structurally compatible
  const geojson = fileType === "gpx"
    ? gpxToGeojson(dom as unknown as Document)
    : tcxToGeojson(dom as unknown as Document);

  const records: TrackRecord[] = [];
  let t0: number | null = null;
  let sportRaw = "";

  for (const feature of geojson.features) {
    const geom = feature.geometry;
    if (!geom || (geom.type !== "LineString" && geom.type !== "MultiLineString")) continue;
    const props = (feature.properties ?? {}) as {
      coordinateProperties?: { times?: unknown; heart?: unknown };
      type?: string;
      sport?: string;
    };
    sportRaw = sportRaw || props.type || props.sport || "";
    const lines: number[][][] = geom.type === "LineString" ? [geom.coordinates] : geom.coordinates;
    const cp = props.coordinateProperties ?? {};
    const timesRaw = cp.times as string[] | string[][] | undefined;
    const heartRaw = cp.heart as number[] | number[][] | undefined;
    const timeLines: (string[] | undefined)[] =
      geom.type === "LineString" ? [timesRaw as string[] | undefined] : (timesRaw as string[][] | undefined) ?? [];
    const heartLines: (number[] | undefined)[] =
      geom.type === "LineString" ? [heartRaw as number[] | undefined] : (heartRaw as number[][] | undefined) ?? [];

    for (let li = 0; li < lines.length; li++) {
      const coords = lines[li];
      const times = timeLines[li];
      const hearts = heartLines[li];
      for (let i = 0; i < coords.length; i++) {
        const [lng, lat, ele] = coords[i];
        const timeStr = times?.[i];
        const ms = timeStr ? Date.parse(timeStr) : NaN;
        if (Number.isNaN(ms)) continue; // records without time can't contribute stats
        if (t0 === null) t0 = ms;
        records.push({
          lat,
          lng,
          t: (ms - t0) / 1000,
          ele: typeof ele === "number" ? ele : null,
          hr: typeof hearts?.[i] === "number" ? hearts[i] : null,
          cadence: null,
          watts: null,
          speed: null,
        });
      }
    }
  }

  if (records.length === 0 || t0 === null) {
    throw new Error(`could not extract a timed track from the ${fileType} file`);
  }

  // gpx <type> is free text; map a few common strava values
  const sportType = mapGpxType(sportRaw);
  const startDateUtc = new Date(t0);
  const cumDist = cumulativeDistances(records);

  return {
    fileType,
    sportType,
    startDateUtc,
    utcOffsetMin: 0,
    hasLocalTime: false, // gpx/tcx times are utc; callers supply a tz fallback
    records,
    cumDist,
    sessionStats: null,
    kilojoules: null,
    suggestedName: suggestedName(sportType, startDateUtc.getUTCHours()),
  };
}

function mapGpxType(raw: string): string {
  const t = raw.toLowerCase();
  if (t.includes("run")) return "Run";
  if (t.includes("rid") || t.includes("bike") || t.includes("cycl")) return "Ride";
  if (t.includes("swim")) return "Swim";
  if (t.includes("hik")) return "Hike";
  if (t.includes("walk")) return "Walk";
  // strava gpx exports use numeric codes for some types; "9" is run, "1" ride
  if (t === "9") return "Run";
  if (t === "1") return "Ride";
  return "Workout";
}

// ---------------------------------------------------------------------------
// entry point

export function parseTrackFile(bytes: Uint8Array, filename: string): ParsedTrackFile {
  const { bytes: inner, fileType } = unwrapTrackFile(bytes, filename);
  return fileType === "fit" ? decodeFit(inner) : decodeXml(inner, fileType);
}
