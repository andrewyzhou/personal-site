// the site's sport-type vocabulary. one place for every type's label, icon,
// family and stat style; everything else (calendar, training feed, records,
// metrics, cleaning, admin pickers) derives from this table.
//
// keys are the pascal-case names already stored in activities.sport_type
// (Run, Ride, WeightTraining…). they are also exactly intervals.icu's activity
// `type` enum, so activities arriving from intervals need no translation and
// no stored row has to be migrated. a few keys intervals doesn't have fill
// gaps the garmin fit profile does have (TreadmillRun, IndoorRide,
// IndoorClimbing, Bouldering, team and combat sports…).
//
// pure data + helpers, safe for client components.

import type { ActivityIcon } from "./activity-icons";

export type SportFamily =
  | "run"
  | "ride"
  | "swim"
  | "walk"
  | "hike"
  | "strength"
  | "cardio"
  | "mind"
  | "climb"
  | "racket"
  | "team"
  | "snow"
  | "skate"
  | "water"
  | "golf"
  | "multisport"
  | "other";

// the headline stat style: pace (foot), speed (wheels), distance only (swim,
// paddle, ski), or duration only (gym, courts, mats)
export type SportMetric = "pace" | "speed" | "distance" | "duration";

export interface FamilyInfo {
  label: string; // plural, for filters and stat groups ("runs")
  icon: ActivityIcon; // fallback icon file under /icons/activities
  metric: SportMetric;
}

export const FAMILIES: Record<SportFamily, FamilyInfo> = {
  run: { label: "runs", icon: "running-shoe", metric: "pace" },
  ride: { label: "rides", icon: "bicycle", metric: "speed" },
  swim: { label: "swims", icon: "pool-ladder", metric: "distance" },
  walk: { label: "walks", icon: "shoe", metric: "pace" },
  hike: { label: "hikes", icon: "hiking-boot", metric: "pace" },
  strength: { label: "lifts", icon: "dumbbell", metric: "duration" },
  cardio: { label: "workouts", icon: "activity", metric: "duration" },
  mind: { label: "yoga + mobility", icon: "yoga-mat", metric: "duration" },
  climb: { label: "climbs", icon: "stone", metric: "duration" },
  racket: { label: "racket sports", icon: "tennis-racket", metric: "duration" },
  team: { label: "team sports", icon: "whistle", metric: "duration" },
  snow: { label: "snow", icon: "snowflake", metric: "distance" },
  skate: { label: "skating", icon: "ice-skate", metric: "distance" },
  water: { label: "paddling + water", icon: "waves", metric: "distance" },
  golf: { label: "golf", icon: "golf-flag", metric: "duration" },
  multisport: { label: "multisport", icon: "medal", metric: "duration" },
  other: { label: "other", icon: "activity", metric: "duration" },
};

export interface SportTypeInfo {
  label: string; // display label ("mountain bike ride")
  noun: string; // casual noun for names and sentences ("bike ride", "lift")
  family: SportFamily;
  icon?: ActivityIcon; // overrides the family icon
  metric?: SportMetric; // overrides the family metric
  indoor?: boolean; // no gps track expected
}

const t = (label: string, family: SportFamily, extra: Partial<SportTypeInfo> = {}): SportTypeInfo => ({
  label,
  noun: extra.noun ?? label,
  family,
  ...extra,
});

export const SPORT_TYPES = {
  // foot
  Run: t("run", "run"),
  TrailRun: t("trail run", "run", { icon: "sport-shoe" }),
  TreadmillRun: t("treadmill run", "run", { noun: "run", indoor: true, icon: "treadmill" }),
  VirtualRun: t("virtual run", "run", { noun: "run", indoor: true, icon: "treadmill-alt" }),
  Walk: t("walk", "walk"),
  Hike: t("hike", "hike"),
  Mountaineering: t("mountaineering", "hike", { noun: "climb", icon: "mountain" }),
  Snowshoe: t("snowshoe", "hike", { icon: "snowflake" }),
  Wheelchair: t("wheelchair", "other", { metric: "pace", icon: "wheelchair" }),

  // wheels
  Ride: t("ride", "ride", { noun: "bike ride" }),
  MountainBikeRide: t("mountain bike ride", "ride", { noun: "bike ride", icon: "bicycle-alt" }),
  GravelRide: t("gravel ride", "ride", { noun: "bike ride", icon: "bicycle-alt" }),
  Cyclocross: t("cyclocross", "ride", { noun: "bike ride", icon: "bicycle-alt" }),
  TrackRide: t("track ride", "ride", { noun: "bike ride" }),
  IndoorRide: t("indoor ride", "ride", { noun: "bike ride", indoor: true, icon: "bike-rider" }),
  VirtualRide: t("virtual ride", "ride", { noun: "bike ride", indoor: true, icon: "bike-rider" }),
  EBikeRide: t("e-bike ride", "ride", { noun: "bike ride", icon: "bicycle-alt" }),
  EMountainBikeRide: t("e-mountain bike ride", "ride", { noun: "bike ride", icon: "bicycle-alt" }),
  Handcycle: t("handcycle", "ride"),
  Velomobile: t("velomobile", "ride"),
  Motorcycling: t("motorcycling", "other", { metric: "speed", icon: "motorbike" }),
  Driving: t("drive", "other", { metric: "speed", icon: "car" }),

  // water
  Swim: t("swim", "swim"),
  OpenWaterSwim: t("open water swim", "swim", { noun: "swim", icon: "waves" }),
  Diving: t("dive", "swim", { metric: "duration", icon: "swimmer" }),
  Rowing: t("row", "water", { icon: "kayak" }),
  VirtualRow: t("indoor row", "water", { noun: "row", indoor: true, icon: "kayak" }),
  Kayaking: t("kayak", "water", { icon: "kayak" }),
  Canoeing: t("canoe", "water", { icon: "kayak" }),
  StandUpPaddling: t("stand up paddle", "water", { noun: "paddle", icon: "surfboard" }),
  Surfing: t("surf", "water", { metric: "duration", icon: "surfboard" }),
  Windsurf: t("windsurf", "water", { icon: "windsurf" }),
  Kitesurf: t("kitesurf", "water", { icon: "kite" }),
  Sail: t("sail", "water", { icon: "sailboat" }),
  Boating: t("boating", "water", { icon: "anchor" }),
  Fishing: t("fishing", "water", { metric: "duration", icon: "fish" }),
  WaterSport: t("water sport", "water", { metric: "duration" }),

  // snow + ice
  AlpineSki: t("ski", "snow", { icon: "ski" }),
  BackcountrySki: t("backcountry ski", "snow", { icon: "mountain-snow" }),
  NordicSki: t("nordic ski", "snow", { icon: "ski" }),
  RollerSki: t("roller ski", "snow", { icon: "ski" }),
  VirtualSki: t("indoor ski", "snow", { noun: "ski", indoor: true, metric: "duration", icon: "ski" }),
  Snowboard: t("snowboard", "snow", { icon: "ski" }),
  Snowmobile: t("snowmobile", "snow"),
  WinterSport: t("winter sport", "snow", { metric: "duration" }),
  IceSkate: t("ice skate", "skate"),
  InlineSkate: t("inline skate", "skate", { icon: "roller-skate" }),
  Skateboard: t("skateboard", "skate", { icon: "roller-skate" }),

  // gym
  WeightTraining: t("weight training", "strength", { noun: "lift" }),
  Crossfit: t("crossfit", "strength", { icon: "kettlebell" }),
  Workout: t("workout", "cardio"),
  HighIntensityIntervalTraining: t("hiit", "cardio", { indoor: true, icon: "timer" }),
  Elliptical: t("elliptical", "cardio", { indoor: true, icon: "treadmill" }),
  StairStepper: t("stair stepper", "cardio", { indoor: true, icon: "stairs" }),
  JumpRope: t("jump rope", "cardio", { indoor: true, icon: "jump-rope" }),
  Boxing: t("boxing", "cardio", { icon: "boxing-glove" }),
  MartialArts: t("martial arts", "cardio", { icon: "kick" }),
  Dance: t("dance", "cardio", { icon: "music-note" }),
  Yoga: t("yoga", "mind", { indoor: true }),
  Pilates: t("pilates", "mind", { indoor: true, icon: "yoga-ball" }),
  Mobility: t("mobility", "mind", { indoor: true, icon: "stretching" }),
  Meditation: t("meditation", "mind", { indoor: true, icon: "lotus" }),
  Breathwork: t("breathwork", "mind", { indoor: true, icon: "wind" }),

  // climbing
  RockClimbing: t("rock climbing", "climb", { noun: "climb" }),
  IndoorClimbing: t("indoor climbing", "climb", { noun: "climb", indoor: true }),
  Bouldering: t("bouldering", "climb", { noun: "boulder session" }),

  // courts + fields
  Tennis: t("tennis", "racket"),
  Pickleball: t("pickleball", "racket", { icon: "paddle" }),
  Padel: t("padel", "racket", { icon: "paddle" }),
  Squash: t("squash", "racket"),
  Badminton: t("badminton", "racket", { icon: "shuttlecock" }),
  Racquetball: t("racquetball", "racket"),
  TableTennis: t("table tennis", "racket", { icon: "paddle" }),
  RacketSport: t("racket sport", "racket"),
  Soccer: t("soccer", "team", { icon: "pitch" }),
  Basketball: t("basketball", "team", { icon: "basketball" }),
  Volleyball: t("volleyball", "team", { icon: "volleyball" }),
  AmericanFootball: t("football", "team", { icon: "american-football" }),
  Rugby: t("rugby", "team", { icon: "american-football" }),
  Hockey: t("hockey", "team", { icon: "hockey-stick" }),
  Lacrosse: t("lacrosse", "team", { icon: "hockey-stick" }),
  Baseball: t("baseball", "team", { icon: "baseball" }),
  Cricket: t("cricket", "team", { icon: "cricket-bat" }),
  TeamSport: t("team sport", "team"),
  Golf: t("golf", "golf"),
  DiscGolf: t("disc golf", "golf", { icon: "frisbee" }),

  // outdoors + everything else
  HorsebackRiding: t("horseback ride", "other", { metric: "distance", icon: "horse" }),
  Archery: t("archery", "other", { icon: "bow-arrow" }),
  Hunting: t("hunting", "other", { icon: "target" }),
  Shooting: t("shooting", "other", { icon: "target" }),
  Flying: t("flight", "other", { metric: "speed", icon: "plane" }),
  HangGliding: t("hang gliding", "other", { metric: "distance", icon: "paraglider" }),
  Skydiving: t("skydive", "other", { icon: "paraglider" }),
  VideoGaming: t("video gaming", "other", { indoor: true, icon: "gamepad" }),

  // multi
  Multisport: t("multisport", "multisport"),
  Transition: t("transition", "multisport", { icon: "swap" }),
  Other: t("activity", "other"),
} satisfies Record<string, SportTypeInfo>;

export type SportType = keyof typeof SPORT_TYPES;

const TABLE: Record<string, SportTypeInfo> = SPORT_TYPES;

// the generic type for anything unrecognized (and the fit/intervals fallback)
export const GENERIC_SPORT_TYPE: SportType = "Workout";
export const GENERIC_ICON: ActivityIcon = "activity";

export const SPORT_TYPE_KEYS = Object.keys(SPORT_TYPES) as SportType[];

export function isSportType(type: string): type is SportType {
  return Object.prototype.hasOwnProperty.call(TABLE, type);
}

export function sportInfo(type: string): SportTypeInfo | null {
  return isSportType(type) ? TABLE[type] : null;
}

// unknown stored values fall back to the generic family, never to nothing
export function sportFamily(type: string): SportFamily {
  return sportInfo(type)?.family ?? "other";
}

export function sportTypeIcon(type: string): ActivityIcon {
  const info = sportInfo(type);
  if (!info) return GENERIC_ICON;
  return info.icon ?? FAMILIES[info.family].icon;
}

export function sportTypeLabel(type: string): string {
  return sportInfo(type)?.label ?? type.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
}

export function sportNoun(type: string): string {
  return sportInfo(type)?.noun ?? type.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
}

export function sportMetric(type: string): SportMetric {
  const info = sportInfo(type);
  if (!info) return "duration";
  return info.metric ?? FAMILIES[info.family].metric;
}

export function isIndoorSport(type: string): boolean {
  return sportInfo(type)?.indoor === true;
}

export function typesInFamily(...families: SportFamily[]): SportType[] {
  return SPORT_TYPE_KEYS.filter((k) => families.includes(TABLE[k].family));
}

export function typesWithMetric(metric: SportMetric): SportType[] {
  return SPORT_TYPE_KEYS.filter((k) => sportMetric(k) === metric);
}

// the families every stat/filter surface groups by
export const isRunType = (type: string) => sportFamily(type) === "run";
export const isRideType = (type: string) => sportFamily(type) === "ride";
export const isFootType = (type: string) => ["run", "walk", "hike"].includes(sportFamily(type));
