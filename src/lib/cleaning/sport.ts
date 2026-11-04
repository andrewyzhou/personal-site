// per-sport speed limits used by cleaning stats and detection (m/s)
//   idle:    below this the athlete counts as stopped
//   maxHuman: sustained speeds above this aren't the sport (vehicle)
//   teleport: an instantaneous jump faster than this is a gps spike

export interface SportLimits {
  idle: number;
  maxHuman: number;
  teleport: number;
}

const FOOT: SportLimits = { idle: 0.5, maxHuman: 7, teleport: 30 }; // 7 m/s ≈ 2:23/km
const RIDE: SportLimits = { idle: 1.0, maxHuman: 22, teleport: 60 }; // 22 m/s ≈ 80 km/h
const SWIM: SportLimits = { idle: 0.15, maxHuman: 3, teleport: 20 };
const OTHER: SportLimits = { idle: 0.3, maxHuman: 10, teleport: 40 };

const BY_SPORT: Record<string, SportLimits> = {
  Run: FOOT, TrailRun: FOOT, VirtualRun: FOOT, Walk: FOOT, Hike: FOOT,
  Ride: RIDE, VirtualRide: RIDE, MountainBikeRide: RIDE, GravelRide: RIDE, EBikeRide: RIDE,
  Swim: SWIM,
};

export function sportLimits(sportType: string): SportLimits {
  return BY_SPORT[sportType] ?? OTHER;
}

// sports with real limits (foot, ride, swim); everything else gets the
// generic fallback, which is too loose to act on automatically
export function isKnownSport(sportType: string): boolean {
  return Object.prototype.hasOwnProperty.call(BY_SPORT, sportType);
}

// lifts, chairs and gravity: fast stretches here are the sport, not a car
export const SNOW_SPORTS: ReadonlySet<string> = new Set(["AlpineSki", "BackcountrySki", "Snowboard", "NordicSki"]);
