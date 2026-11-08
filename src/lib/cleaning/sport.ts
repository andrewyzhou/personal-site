// per-sport speed limits used by cleaning stats and detection (m/s)
//   idle:    below this the athlete counts as stopped
//   maxHuman: sustained speeds above this aren't the sport (vehicle)
//   teleport: an instantaneous jump faster than this is a gps spike

import { isSportType, sportFamily, type SportFamily } from "../sport-types";

export interface SportLimits {
  idle: number;
  maxHuman: number;
  teleport: number;
}

const FOOT: SportLimits = { idle: 0.5, maxHuman: 7, teleport: 30 }; // 7 m/s ≈ 2:23/km
const RIDE: SportLimits = { idle: 1.0, maxHuman: 22, teleport: 60 }; // 22 m/s ≈ 80 km/h
const SWIM: SportLimits = { idle: 0.15, maxHuman: 3, teleport: 20 };
const OTHER: SportLimits = { idle: 0.3, maxHuman: 10, teleport: 40 };

// by sport family (src/lib/sport-types.ts)
const BY_FAMILY: Partial<Record<SportFamily, SportLimits>> = {
  run: FOOT, walk: FOOT, hike: FOOT,
  ride: RIDE,
  swim: SWIM,
};

export function sportLimits(sportType: string): SportLimits {
  return (isSportType(sportType) && BY_FAMILY[sportFamily(sportType)]) || OTHER;
}

// sports with real limits (foot, ride, swim); everything else gets the
// generic fallback, which is too loose to act on automatically
export function isKnownSport(sportType: string): boolean {
  return isSportType(sportType) && BY_FAMILY[sportFamily(sportType)] !== undefined;
}

// lifts, chairs and gravity: fast stretches here are the sport, not a car
export const SNOW_SPORTS: ReadonlySet<string> = new Set(["AlpineSki", "BackcountrySki", "Snowboard", "NordicSki"]);
