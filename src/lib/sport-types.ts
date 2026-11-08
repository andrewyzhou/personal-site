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
  icon: string; // fallback icon file under /icons/activities
  metric: SportMetric;
}

export const FAMILIES: Record<SportFamily, FamilyInfo> = {
  run: { label: "runs", icon: "run", metric: "pace" },
  ride: { label: "rides", icon: "ride", metric: "speed" },
  swim: { label: "swims", icon: "swim", metric: "distance" },
  walk: { label: "walks", icon: "walk", metric: "pace" },
  hike: { label: "hikes", icon: "hike", metric: "pace" },
  strength: { label: "lifts", icon: "weight", metric: "duration" },
  cardio: { label: "workouts", icon: "workout", metric: "duration" },
  mind: { label: "yoga + mobility", icon: "yoga", metric: "duration" },
  climb: { label: "climbs", icon: "climb", metric: "duration" },
  racket: { label: "racket sports", icon: "tennis", metric: "duration" },
  team: { label: "team sports", icon: "team", metric: "duration" },
  snow: { label: "snow", icon: "snow", metric: "distance" },
  skate: { label: "skating", icon: "iceskate", metric: "distance" },
  water: { label: "paddling + water", icon: "water", metric: "distance" },
  golf: { label: "golf", icon: "golf", metric: "duration" },
  multisport: { label: "multisport", icon: "multisport", metric: "duration" },
  other: { label: "other", icon: "workout", metric: "duration" },
};

export interface SportTypeInfo {
  label: string; // display label ("mountain bike ride")
  noun: string; // casual noun for names and sentences ("bike ride", "lift")
  family: SportFamily;
  icon?: string; // overrides the family icon
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
  TrailRun: t("trail run", "run", { icon: "trailrun" }),
  TreadmillRun: t("treadmill run", "run", { noun: "run", indoor: true, icon: "treadmill" }),
  VirtualRun: t("virtual run", "run", { noun: "run", indoor: true, icon: "treadmill" }),
  Walk: t("walk", "walk"),
  Hike: t("hike", "hike"),
  Snowshoe: t("snowshoe", "hike", { icon: "snowshoe" }),
  Wheelchair: t("wheelchair", "other", { metric: "pace", icon: "wheelchair" }),

  // wheels
  Ride: t("ride", "ride", { noun: "bike ride" }),
  MountainBikeRide: t("mountain bike ride", "ride", { noun: "bike ride", icon: "mtb" }),
  GravelRide: t("gravel ride", "ride", { noun: "bike ride", icon: "gravel" }),
  Cyclocross: t("cyclocross", "ride", { noun: "bike ride", icon: "gravel" }),
  TrackRide: t("track ride", "ride", { noun: "bike ride" }),
  IndoorRide: t("indoor ride", "ride", { noun: "bike ride", indoor: true, icon: "indoorride" }),
  VirtualRide: t("virtual ride", "ride", { noun: "bike ride", indoor: true, icon: "indoorride" }),
  EBikeRide: t("e-bike ride", "ride", { noun: "bike ride", icon: "ebike" }),
  EMountainBikeRide: t("e-mountain bike ride", "ride", { noun: "bike ride", icon: "ebike" }),
  Handcycle: t("handcycle", "ride"),
  Velomobile: t("velomobile", "ride"),

  // water
  Swim: t("swim", "swim"),
  OpenWaterSwim: t("open water swim", "swim", { noun: "swim", icon: "openwater" }),
  Diving: t("dive", "swim", { metric: "duration", icon: "dive" }),
  Rowing: t("row", "water", { icon: "row" }),
  VirtualRow: t("indoor row", "water", { noun: "row", indoor: true, icon: "row" }),
  Kayaking: t("kayak", "water", { icon: "kayak" }),
  Canoeing: t("canoe", "water", { icon: "canoe" }),
  StandUpPaddling: t("stand up paddle", "water", { noun: "paddle", icon: "sup" }),
  Surfing: t("surf", "water", { metric: "duration", icon: "surf" }),
  Windsurf: t("windsurf", "water", { icon: "windsurf" }),
  Kitesurf: t("kitesurf", "water", { icon: "kitesurf" }),
  Sail: t("sail", "water", { icon: "sail" }),
  WaterSport: t("water sport", "water", { metric: "duration" }),

  // snow + ice
  AlpineSki: t("ski", "snow", { icon: "ski" }),
  BackcountrySki: t("backcountry ski", "snow", { icon: "ski" }),
  NordicSki: t("nordic ski", "snow", { icon: "nordic" }),
  RollerSki: t("roller ski", "snow", { icon: "nordic" }),
  VirtualSki: t("indoor ski", "snow", { noun: "ski", indoor: true, metric: "duration", icon: "ski" }),
  Snowboard: t("snowboard", "snow", { icon: "snowboard" }),
  WinterSport: t("winter sport", "snow", { metric: "duration" }),
  IceSkate: t("ice skate", "skate"),
  InlineSkate: t("inline skate", "skate", { icon: "inlineskate" }),
  Skateboard: t("skateboard", "skate", { icon: "skateboard" }),

  // gym
  WeightTraining: t("weight training", "strength", { noun: "lift" }),
  Crossfit: t("crossfit", "strength", { icon: "kettlebell" }),
  Workout: t("workout", "cardio"),
  HighIntensityIntervalTraining: t("hiit", "cardio", { indoor: true, icon: "hiit" }),
  Elliptical: t("elliptical", "cardio", { indoor: true }),
  StairStepper: t("stair stepper", "cardio", { indoor: true, icon: "stairs" }),
  JumpRope: t("jump rope", "cardio", { indoor: true, icon: "jumprope" }),
  Boxing: t("boxing", "cardio", { icon: "boxing" }),
  MartialArts: t("martial arts", "cardio", { icon: "martialarts" }),
  Dance: t("dance", "cardio"),
  Yoga: t("yoga", "mind", { indoor: true }),
  Pilates: t("pilates", "mind", { indoor: true, icon: "pilates" }),
  Mobility: t("mobility", "mind", { indoor: true, icon: "mobility" }),
  Meditation: t("meditation", "mind", { indoor: true, icon: "meditation" }),

  // climbing
  RockClimbing: t("rock climbing", "climb", { noun: "climb" }),
  IndoorClimbing: t("indoor climbing", "climb", { noun: "climb", indoor: true }),
  Bouldering: t("bouldering", "climb", { noun: "boulder session", icon: "boulder" }),

  // courts + fields
  Tennis: t("tennis", "racket"),
  Pickleball: t("pickleball", "racket", { icon: "pickleball" }),
  Padel: t("padel", "racket", { icon: "padel" }),
  Squash: t("squash", "racket"),
  Badminton: t("badminton", "racket", { icon: "badminton" }),
  Racquetball: t("racquetball", "racket"),
  TableTennis: t("table tennis", "racket", { icon: "tabletennis" }),
  RacketSport: t("racket sport", "racket"),
  Soccer: t("soccer", "team", { icon: "soccer" }),
  Basketball: t("basketball", "team", { icon: "basketball" }),
  Volleyball: t("volleyball", "team", { icon: "volleyball" }),
  AmericanFootball: t("football", "team", { icon: "football" }),
  Rugby: t("rugby", "team", { icon: "rugby" }),
  Hockey: t("hockey", "team", { icon: "hockey" }),
  Lacrosse: t("lacrosse", "team"),
  Baseball: t("baseball", "team", { icon: "baseball" }),
  Cricket: t("cricket", "team", { icon: "cricket" }),
  TeamSport: t("team sport", "team"),
  Golf: t("golf", "golf"),
  DiscGolf: t("disc golf", "golf", { icon: "discgolf" }),

  // multi
  Multisport: t("multisport", "multisport"),
  Transition: t("transition", "multisport"),
  Other: t("activity", "other"),
} satisfies Record<string, SportTypeInfo>;

export type SportType = keyof typeof SPORT_TYPES;

const TABLE: Record<string, SportTypeInfo> = SPORT_TYPES;

// the generic type for anything unrecognized (and the fit/intervals fallback)
export const GENERIC_SPORT_TYPE: SportType = "Workout";
export const GENERIC_ICON = "workout";

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

export function sportTypeIcon(type: string): string {
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
