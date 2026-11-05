// replay text: clocks, speeds and the chip labels shown above the timeline

import type { DistanceUnit, ReplayEvent } from "./engine";

const FOOT = new Set(["Run", "TrailRun", "VirtualRun", "Walk", "Hike"]);

// 75 → "1:15", 3725 → "1:02:05"
export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

export function formatSpeedChoice(speed: number): string {
  return `${speed}×`;
}

// 45 → "45 s", 300 → "5 min", 3900 → "1 h 5 min"
export function formatDurationShort(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s} s`;
  const min = Math.round(s / 60);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const rest = min % 60;
  return rest > 0 ? `${h} h ${rest} min` : `${h} h`;
}

// foot sports read as pace, everything else as speed
export function formatSpeed(ms: number, sportType: string, unit: DistanceUnit): string {
  const per = unit === "km" ? 1000 : 1609.344;
  if (FOOT.has(sportType)) {
    if (ms <= 0.1) return `–:– /${unit}`;
    const secs = Math.round(per / ms);
    return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")} /${unit}`;
  }
  const v = (ms * 3600) / per;
  return `${v.toFixed(1)} ${unit === "km" ? "km/h" : "mph"}`;
}

export function chipLabel(e: ReplayEvent, sportType: string, unit: DistanceUnit): string {
  switch (e.kind) {
    case "pause":
      return `paused · ${formatDurationShort(e.durationS)}`;
    case "fog":
      return `in the fog · ${formatDurationShort(e.durationS)}`;
    case "cut":
      return "skipped";
    case "split":
      return `${e.unit} ${e.n}`;
    case "maxSpeed":
      return FOOT.has(sportType) ? `fastest · ${formatSpeed(e.speed, sportType, unit)}` : `top speed · ${formatSpeed(e.speed, sportType, unit)}`;
  }
}

// a stable react key per chip
export function chipKey(e: ReplayEvent): string {
  return `${e.kind}:${Math.round(e.t)}`;
}
