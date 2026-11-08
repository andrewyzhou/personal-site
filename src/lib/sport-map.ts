// upstream sport identifiers → the site's sport types (src/lib/sport-types.ts).
//
//   fitSportType(sport, subSport)   garmin fit profile `sport` + `sub_sport`
//                                    enums: the ground truth when we have the
//                                    device file
//   intervalsSportType(type, trainer) intervals.icu's activity `type` enum,
//                                    used when there is no file
//
// both accept either the fit sdk's camelCase strings ("strengthTraining") or
// the profile's snake_case names ("strength_training"), any case.

import { GENERIC_SPORT_TYPE, isSportType, type SportType } from "./sport-types";

const norm = (s: string | number | null | undefined) => String(s ?? "").toLowerCase().replace(/[_\s-]/g, "");

// fit `sport` → default type, plus sub_sport refinements. keys are normalized
// (lowercase, no underscores). every value of the fit profile's sport enum is
// listed so none of them falls through to the generic fallback.
interface FitRule {
  type: SportType;
  sub?: Record<string, SportType>;
}

const VIRTUAL = "virtualactivity";

export const FIT_SPORT_RULES: Record<string, FitRule> = {
  generic: {
    type: "Workout",
    sub: {
      treadmill: "TreadmillRun", indoorrunning: "TreadmillRun", trail: "TrailRun",
      indoorcycling: "IndoorRide", spin: "IndoorRide", mountain: "MountainBikeRide", gravelcycling: "GravelRide",
      lapswimming: "Swim", openwater: "OpenWaterSwim",
      strengthtraining: "WeightTraining", yoga: "Yoga", pilates: "Pilates", hiit: "HighIntensityIntervalTraining",
      elliptical: "Elliptical", stairclimbing: "StairStepper", indoorrowing: "VirtualRow",
      indoorclimbing: "IndoorClimbing", bouldering: "Bouldering", breathing: "Meditation",
      flexibilitytraining: "Mobility",
    },
  },
  running: {
    type: "Run",
    sub: {
      trail: "TrailRun", treadmill: "TreadmillRun", indoorrunning: "TreadmillRun",
      [VIRTUAL]: "VirtualRun", street: "Run", track: "Run", ultra: "Run", obstacle: "Run",
    },
  },
  cycling: {
    type: "Ride",
    sub: {
      road: "Ride", street: "Ride", commuting: "Ride", recumbent: "Ride", bmx: "Ride",
      mountain: "MountainBikeRide", downhill: "MountainBikeRide", enduro: "MountainBikeRide",
      gravelcycling: "GravelRide", mixedsurface: "GravelRide",
      cyclocross: "Cyclocross", trackcycling: "TrackRide",
      indoorcycling: "IndoorRide", spin: "IndoorRide", [VIRTUAL]: "VirtualRide",
      handcycling: "Handcycle", indoorhandcycling: "Handcycle",
      ebikemountain: "EMountainBikeRide", ebikeenduro: "EMountainBikeRide", ebikefitness: "EBikeRide",
    },
  },
  ebiking: {
    type: "EBikeRide",
    sub: { ebikemountain: "EMountainBikeRide", ebikeenduro: "EMountainBikeRide", mountain: "EMountainBikeRide" },
  },
  transition: { type: "Transition" },
  fitnessequipment: {
    type: "Workout",
    sub: {
      treadmill: "TreadmillRun", indoorrunning: "TreadmillRun",
      indoorcycling: "IndoorRide", spin: "IndoorRide", [VIRTUAL]: "VirtualRide",
      indoorrowing: "VirtualRow", elliptical: "Elliptical", stairclimbing: "StairStepper",
      indoorskiing: "VirtualSki", indoorwalking: "Walk", strengthtraining: "WeightTraining",
      cardiotraining: "Workout", hiit: "HighIntensityIntervalTraining", yoga: "Yoga", pilates: "Pilates",
      indoorclimbing: "IndoorClimbing", bouldering: "Bouldering",
      indoorwheelchairwalk: "Wheelchair", indoorwheelchairrun: "Wheelchair", indoorhandcycling: "Handcycle",
      indoorgrinding: "Workout",
    },
  },
  swimming: { type: "Swim", sub: { lapswimming: "Swim", openwater: "OpenWaterSwim" } },
  basketball: { type: "Basketball" },
  soccer: { type: "Soccer" },
  tennis: { type: "Tennis" },
  americanfootball: { type: "AmericanFootball" },
  training: {
    type: "Workout",
    sub: {
      strengthtraining: "WeightTraining", cardiotraining: "Workout",
      hiit: "HighIntensityIntervalTraining", amrap: "HighIntensityIntervalTraining",
      emom: "HighIntensityIntervalTraining", tabata: "HighIntensityIntervalTraining",
      yoga: "Yoga", pilates: "Pilates", flexibilitytraining: "Mobility", breathing: "Meditation",
      elliptical: "Elliptical", stairclimbing: "StairStepper", indoorrowing: "VirtualRow",
      indoorclimbing: "IndoorClimbing", bouldering: "Bouldering", obstacle: "Workout",
    },
  },
  walking: {
    type: "Walk",
    sub: { casualwalking: "Walk", speedwalking: "Walk", indoorwalking: "Walk", rucking: "Walk" },
  },
  crosscountryskiing: {
    type: "NordicSki",
    sub: { skateskiing: "NordicSki", backcountry: "BackcountrySki", indoorskiing: "VirtualSki" },
  },
  alpineskiing: {
    type: "AlpineSki",
    sub: { backcountry: "BackcountrySki", resort: "AlpineSki", downhill: "AlpineSki", indoorskiing: "VirtualSki" },
  },
  snowboarding: { type: "Snowboard" },
  rowing: { type: "Rowing", sub: { indoorrowing: "VirtualRow", [VIRTUAL]: "VirtualRow" } },
  mountaineering: { type: "Hike" },
  hiking: { type: "Hike" },
  multisport: { type: "Multisport" },
  paddling: { type: "Kayaking", sub: { whitewater: "Kayaking" } },
  flying: { type: "Other" },
  hanggliding: { type: "Other" },
  horsebackriding: { type: "Other" },
  hunting: { type: "Other" },
  fishing: { type: "Other" },
  inlineskating: { type: "InlineSkate" },
  rockclimbing: {
    type: "RockClimbing",
    sub: { indoorclimbing: "IndoorClimbing", bouldering: "Bouldering" },
  },
  sailing: { type: "Sail" },
  iceskating: { type: "IceSkate" },
  skydiving: { type: "Other" },
  snowshoeing: { type: "Snowshoe" },
  snowmobiling: { type: "Other" },
  standuppaddleboarding: { type: "StandUpPaddling" },
  surfing: { type: "Surfing" },
  wakeboarding: { type: "WaterSport" },
  waterskiing: { type: "WaterSport" },
  kayaking: { type: "Kayaking" },
  rafting: { type: "WaterSport" },
  windsurfing: { type: "Windsurf" },
  kitesurfing: { type: "Kitesurf" },
  tactical: { type: "Other" },
  jumpmaster: { type: "Other" },
  boxing: { type: "Boxing" },
  floorclimbing: { type: "StairStepper" },
  baseball: { type: "Baseball" },
  diving: { type: "Diving" },
  shooting: { type: "Other" },
  wintersport: { type: "WinterSport" },
  grinding: { type: "Workout" },
  hiit: { type: "HighIntensityIntervalTraining" },
  videogaming: { type: "Other" },
  racket: {
    type: "RacketSport",
    sub: {
      pickleball: "Pickleball", padel: "Padel", squash: "Squash", badminton: "Badminton",
      racquetball: "Racquetball", tabletennis: "TableTennis",
    },
  },
  wheelchairpushwalk: { type: "Wheelchair" },
  wheelchairpushrun: { type: "Wheelchair" },
  meditation: { type: "Meditation", sub: { breathing: "Meditation" } },
  parasport: { type: "Workout" },
  discgolf: { type: "DiscGolf" },
  teamsport: { type: "TeamSport", sub: { ultimate: "TeamSport" } },
  cricket: { type: "Cricket" },
  rugby: { type: "Rugby" },
  hockey: { type: "Hockey", sub: { ice: "Hockey", field: "Hockey" } },
  lacrosse: { type: "Lacrosse" },
  volleyball: { type: "Volleyball" },
  watertubing: { type: "WaterSport" },
  wakesurfing: { type: "Surfing" },
  watersport: { type: "WaterSport" },
  archery: { type: "Other" },
  mixedmartialarts: { type: "MartialArts" },
  motorsports: { type: "Other" },
  snorkeling: { type: "WaterSport" },
  dance: { type: "Dance" },
  jumprope: { type: "JumpRope" },
  poolapnea: { type: "Diving" },
  mobility: { type: "Mobility" },
  geocaching: { type: "Walk" },
  canoeing: { type: "Canoeing" },
  // motorized travel and catch-alls
  motorcycling: { type: "Other" },
  boating: { type: "Other" },
  driving: { type: "Other" },
  all: { type: "Workout" },
  golf: { type: "Golf" },
};

export function isKnownFitSport(sport: string | number | null | undefined): boolean {
  return Object.prototype.hasOwnProperty.call(FIT_SPORT_RULES, norm(sport));
}

// unknown sports (a newer fit profile than ours, or a raw number) are generic
// workouts; an unknown sub_sport keeps the sport's own type
export function fitSportType(sport?: string | number | null, subSport?: string | number | null): SportType {
  const rule = FIT_SPORT_RULES[norm(sport)];
  // some writers put a sub_sport name in the sport field ("yoga")
  if (!rule) return FIT_SPORT_RULES.generic.sub?.[norm(sport)] ?? GENERIC_SPORT_TYPE;
  return rule.sub?.[norm(subSport)] ?? rule.type;
}

// intervals.icu activity `type` values (its openapi spec, the
// strava_sync_activity_types enum). all are site types verbatim; Other (garmin's
// generic recordings) reads as a workout.
export const INTERVALS_TYPES = [
  "Ride", "Run", "Swim", "WeightTraining", "Hike", "Walk", "AlpineSki", "BackcountrySki", "Badminton",
  "Canoeing", "Crossfit", "EBikeRide", "EMountainBikeRide", "Elliptical", "Golf", "GravelRide", "TrackRide",
  "Handcycle", "HighIntensityIntervalTraining", "Hockey", "IceSkate", "InlineSkate", "Kayaking", "Kitesurf",
  "MountainBikeRide", "Cyclocross", "NordicSki", "OpenWaterSwim", "Padel", "Pilates", "Pickleball",
  "Racquetball", "Rugby", "RockClimbing", "RollerSki", "Rowing", "Sail", "Skateboard", "Snowboard",
  "Snowshoe", "Soccer", "Squash", "StairStepper", "StandUpPaddling", "Surfing", "TableTennis", "Tennis",
  "TrailRun", "Transition", "Velomobile", "VirtualRide", "VirtualRow", "VirtualRun", "VirtualSki",
  "WaterSport", "Wheelchair", "Windsurf", "Workout", "Yoga", "Other",
] as const;

// trainer = intervals' indoor flag: a run on a treadmill or a ride on a
// trainer without a virtual world
export function intervalsSportType(type: string | null | undefined, trainer?: boolean | null): SportType {
  // garmin's "other" recordings (fit sport generic) arrive typed Other: they
  // are workouts of no particular sport, same as their fit files say
  if (!type || type === "Other") return GENERIC_SPORT_TYPE;
  if (trainer && type === "Run") return "TreadmillRun";
  if (trainer && type === "Ride") return "IndoorRide";
  return isSportType(type) ? type : GENERIC_SPORT_TYPE;
}

// free-text types from gpx/tcx files (`<type>running</type>`, strava-exported
// gpx numeric codes, "Biking" in tcx). best effort, never blank.
export function freeTextSportType(raw: string | null | undefined): SportType {
  const s = (raw ?? "").trim();
  if (isSportType(s)) return s;
  const n = norm(s);
  if (isKnownFitSport(n)) return fitSportType(n);
  if (n === "9") return "Run";
  if (n === "1") return "Ride";
  if (n.includes("trail")) return "TrailRun";
  if (n.includes("run")) return "Run";
  if (n.includes("rid") || n.includes("bik") || n.includes("cycl")) return "Ride";
  if (n.includes("swim")) return "Swim";
  if (n.includes("hik")) return "Hike";
  if (n.includes("walk")) return "Walk";
  if (n.includes("ski")) return "AlpineSki";
  if (n.includes("row")) return "Rowing";
  if (n.includes("paddl") || n.includes("kayak")) return "Kayaking";
  return GENERIC_SPORT_TYPE;
}

// garmin connect activity typeKeys (the personal api's activityType.typeKey,
// the same keys garmin connect's own pages use). keys normalized like the fit
// table; a "_ws"/"_v2" suffix is dropped. anything unlisted falls back to the
// free-text rules, then a generic workout.
const GARMIN_TYPE_KEYS: Record<string, SportType> = {
  running: "Run", streetrunning: "Run", trackrunning: "Run", ultrarun: "Run", obstaclerun: "Run",
  trailrunning: "TrailRun", treadmillrunning: "TreadmillRun", indoorrunning: "TreadmillRun", virtualrun: "VirtualRun",
  cycling: "Ride", roadbiking: "Ride", bmx: "Ride", recumbentcycling: "Ride", gravelcycling: "GravelRide",
  mountainbiking: "MountainBikeRide", cyclocross: "Cyclocross", trackcycling: "TrackRide", indoorcycling: "IndoorRide",
  virtualride: "VirtualRide", ebikefitness: "EBikeRide", ebikemountain: "EMountainBikeRide", handcycling: "Handcycle",
  swimming: "Swim", lapswimming: "Swim", openwaterswimming: "OpenWaterSwim",
  walking: "Walk", casualwalking: "Walk", speedwalking: "Walk", hiking: "Hike", snowshoe: "Snowshoe",
  strengthtraining: "WeightTraining", indoorcardio: "Workout", fitnessequipment: "Workout", hiit: "HighIntensityIntervalTraining",
  elliptical: "Elliptical", stairclimbing: "StairStepper", floorclimbing: "StairStepper", rowing: "Rowing", indoorrowing: "Rowing",
  yoga: "Yoga", pilates: "Pilates", breathwork: "Meditation", meditation: "Meditation", mobility: "Mobility",
  rockclimbing: "RockClimbing", indoorclimbing: "IndoorClimbing", bouldering: "Bouldering",
  resortskiingsnowboarding: "AlpineSki", resortskiing: "AlpineSki", resortsnowboarding: "Snowboard",
  backcountryskiing: "BackcountrySki", backcountryskiingsnowboarding: "BackcountrySki",
  crosscountryskiing: "NordicSki", skateskiing: "NordicSki",
  kayaking: "Kayaking", standuppaddleboarding: "StandUpPaddling", surfing: "Surfing", sailing: "Sail",
  kiteboarding: "Kitesurf", windsurfing: "Windsurf",
  tennis: "Tennis", pickleball: "Pickleball", padel: "Padel", squash: "Squash", badminton: "Badminton",
  tabletennis: "TableTennis", racquetball: "Racquetball",
  soccer: "Soccer", basketball: "Basketball", golf: "Golf", discgolf: "DiscGolf", boxing: "Boxing",
  jumprope: "JumpRope", dance: "Dance", inlineskating: "InlineSkate", iceskating: "IceSkate",
  multisport: "Multisport", transition: "Transition", other: GENERIC_SPORT_TYPE,
};

export function garminSportType(typeKey: string | null | undefined): SportType {
  const key = norm(String(typeKey ?? "").replace(/_(ws|v\d+)$/i, ""));
  if (!key) return GENERIC_SPORT_TYPE;
  return GARMIN_TYPE_KEYS[key] ?? freeTextSportType(key);
}
