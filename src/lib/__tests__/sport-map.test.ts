import fs from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { Profile } from "@garmin/fitsdk";
import {
  FIT_SPORT_RULES,
  INTERVALS_TYPES,
  fitSportType,
  freeTextSportType,
  intervalsSportType,
  isKnownFitSport,
} from "../sport-map";
import {
  FAMILIES,
  GENERIC_ICON,
  SPORT_TYPES,
  SPORT_TYPE_KEYS,
  isSportType,
  sportFamily,
  sportMetric,
  sportNoun,
  sportTypeIcon,
  sportTypeLabel,
  typesInFamily,
} from "../sport-types";
import { sportGroup } from "@/content/training";

const ICON_DIR = path.join(__dirname, "../../../public/icons/activities");
const iconExists = (icon: string) => fs.existsSync(path.join(ICON_DIR, `${icon}.svg`));

// the full garmin fit profile, straight from the sdk this repo decodes with
const FIT_SPORTS = Object.values(Profile.types.sport as Record<string, string>);
const FIT_SUB_SPORTS = Object.values(Profile.types.subSport as Record<string, string>);
const snake = (s: string) => s.replace(/([A-Z])/g, "_$1").toLowerCase();

describe("sport-type table", () => {
  it.each(SPORT_TYPE_KEYS)("%s has a label, a noun, a known family and an icon file", (key) => {
    const info = SPORT_TYPES[key];
    expect(info.label).toMatch(/^[a-z][a-z +-]*$/);
    expect(sportNoun(key)).toMatch(/^[a-z][a-z +-]*$/);
    expect(FAMILIES[info.family]).toBeDefined();
    expect(iconExists(sportTypeIcon(key))).toBe(true);
  });

  it.each(Object.entries(FAMILIES))("family %s falls back to an existing icon", (_family, info) => {
    expect(iconExists(info.icon)).toBe(true);
  });

  it("unknown types get the generic icon and family, never a blank", () => {
    for (const t of ["", "Quidditch", "run", "undefined"]) {
      expect(sportTypeIcon(t)).toBe(GENERIC_ICON);
      expect(sportFamily(t)).toBe("other");
      expect(sportMetric(t)).toBe("duration");
    }
    expect(iconExists(GENERIC_ICON)).toBe(true);
    expect(sportTypeLabel("SomethingNew")).toBe("something new");
  });

  it("labels, nouns and icons for the common types", () => {
    const expected: Record<string, [string, string, string]> = {
      Run: ["run", "run", "running-shoe"],
      TrailRun: ["trail run", "trail run", "sport-shoe"],
      VirtualRun: ["virtual run", "run", "treadmill-alt"],
      Ride: ["ride", "bike ride", "bicycle"],
      VirtualRide: ["virtual ride", "bike ride", "bike-rider"],
      MountainBikeRide: ["mountain bike ride", "bike ride", "bicycle-alt"],
      GravelRide: ["gravel ride", "bike ride", "bicycle-alt"],
      Swim: ["swim", "swim", "pool-ladder"],
      Walk: ["walk", "walk", "shoe"],
      Hike: ["hike", "hike", "hiking-boot"],
      WeightTraining: ["weight training", "lift", "dumbbell"],
      Workout: ["workout", "workout", "activity"],
      Yoga: ["yoga", "yoga", "yoga-mat"],
      Tennis: ["tennis", "tennis", "tennis-racket"],
      Soccer: ["soccer", "soccer", "pitch"],
      RockClimbing: ["rock climbing", "climb", "stone"],
      Crossfit: ["crossfit", "crossfit", "kettlebell"],
      Golf: ["golf", "golf", "golf-flag"],
    };
    for (const [type, [label, noun, icon]] of Object.entries(expected)) {
      expect([sportTypeLabel(type), sportNoun(type), sportTypeIcon(type)]).toEqual([label, noun, icon]);
    }
  });

  it("every family's types share the family icon unless they name their own", () => {
    for (const key of SPORT_TYPE_KEYS) {
      const info = SPORT_TYPES[key] as { family: keyof typeof FAMILIES; icon?: string };
      expect(sportTypeIcon(key)).toBe(info.icon ?? FAMILIES[info.family].icon);
    }
  });
});

describe("fit sport + sub_sport → sport type", () => {
  it("the profile has the size we expect (a newer sdk adds sports: map them)", () => {
    expect(FIT_SPORTS.length).toBeGreaterThanOrEqual(80);
  });

  it.each(FIT_SPORTS)("sport %s has an explicit rule", (sport) => {
    expect(isKnownFitSport(sport)).toBe(true);
    expect(isKnownFitSport(snake(sport))).toBe(true);
    expect(isSportType(fitSportType(sport))).toBe(true);
  });

  it("rules only name real fit sports and sub_sports", () => {
    const norm = (s: string) => s.toLowerCase().replace(/_/g, "");
    const sports = new Set(FIT_SPORTS.map(norm));
    const subs = new Set(FIT_SUB_SPORTS.map(norm));
    for (const [sport, rule] of Object.entries(FIT_SPORT_RULES)) {
      expect(sports.has(sport), sport).toBe(true);
      for (const sub of Object.keys(rule.sub ?? {})) expect(subs.has(sub), `${sport}/${sub}`).toBe(true);
    }
  });

  it("every sport × sub_sport pair maps to a site type with an icon", () => {
    for (const sport of FIT_SPORTS) {
      for (const sub of FIT_SUB_SPORTS) {
        const type = fitSportType(sport, sub);
        expect(isSportType(type), `${sport}/${sub}`).toBe(true);
        expect(iconExists(sportTypeIcon(type))).toBe(true);
      }
    }
  });

  // [sport, sub_sport, type, family]
  it.each([
    ["running", "generic", "Run", "run"],
    ["running", "trail", "TrailRun", "run"],
    ["running", "treadmill", "TreadmillRun", "run"],
    ["running", "indoorRunning", "TreadmillRun", "run"],
    ["running", "virtualActivity", "VirtualRun", "run"],
    ["running", "track", "Run", "run"],
    ["cycling", "road", "Ride", "ride"],
    ["cycling", "mountain", "MountainBikeRide", "ride"],
    ["cycling", "gravelCycling", "GravelRide", "ride"],
    ["cycling", "cyclocross", "Cyclocross", "ride"],
    ["cycling", "indoorCycling", "IndoorRide", "ride"],
    ["cycling", "spin", "IndoorRide", "ride"],
    ["cycling", "virtualActivity", "VirtualRide", "ride"],
    ["cycling", "trackCycling", "TrackRide", "ride"],
    ["cycling", "handCycling", "Handcycle", "ride"],
    ["eBiking", "generic", "EBikeRide", "ride"],
    ["eBiking", "eBikeMountain", "EMountainBikeRide", "ride"],
    ["swimming", "lapSwimming", "Swim", "swim"],
    ["swimming", "openWater", "OpenWaterSwim", "swim"],
    ["training", "strengthTraining", "WeightTraining", "strength"],
    ["training", "cardioTraining", "Workout", "cardio"],
    ["training", "hiit", "HighIntensityIntervalTraining", "cardio"],
    ["training", "yoga", "Yoga", "mind"],
    ["training", "pilates", "Pilates", "mind"],
    ["training", "flexibilityTraining", "Mobility", "mind"],
    ["training", "breathing", "Breathwork", "mind"],
    ["fitnessEquipment", "treadmill", "TreadmillRun", "run"],
    ["fitnessEquipment", "indoorRowing", "VirtualRow", "water"],
    ["fitnessEquipment", "elliptical", "Elliptical", "cardio"],
    ["fitnessEquipment", "stairClimbing", "StairStepper", "cardio"],
    ["fitnessEquipment", "indoorSkiing", "VirtualSki", "snow"],
    ["rockClimbing", "generic", "RockClimbing", "climb"],
    ["rockClimbing", "indoorClimbing", "IndoorClimbing", "climb"],
    ["rockClimbing", "bouldering", "Bouldering", "climb"],
    ["alpineSkiing", "resort", "AlpineSki", "snow"],
    ["alpineSkiing", "backcountry", "BackcountrySki", "snow"],
    ["crossCountrySkiing", "skateSkiing", "NordicSki", "snow"],
    ["crossCountrySkiing", "backcountry", "BackcountrySki", "snow"],
    ["snowboarding", "generic", "Snowboard", "snow"],
    ["snowshoeing", "generic", "Snowshoe", "hike"],
    ["hiking", "generic", "Hike", "hike"],
    ["mountaineering", "generic", "Mountaineering", "hike"],
    ["walking", "casualWalking", "Walk", "walk"],
    ["rowing", "generic", "Rowing", "water"],
    ["rowing", "indoorRowing", "VirtualRow", "water"],
    ["kayaking", "generic", "Kayaking", "water"],
    ["standUpPaddleboarding", "generic", "StandUpPaddling", "water"],
    ["racket", "pickleball", "Pickleball", "racket"],
    ["racket", "padel", "Padel", "racket"],
    ["racket", "tableTennis", "TableTennis", "racket"],
    ["tennis", "generic", "Tennis", "racket"],
    ["soccer", "generic", "Soccer", "team"],
    ["hockey", "ice", "Hockey", "team"],
    ["golf", "generic", "Golf", "golf"],
    ["inlineSkating", "generic", "InlineSkate", "skate"],
    ["iceSkating", "generic", "IceSkate", "skate"],
    ["multisport", "triathlon", "Multisport", "multisport"],
    ["driving", "generic", "Driving", "other"],
  ])("%s / %s → %s (%s)", (sport, sub, type, family) => {
    expect(fitSportType(sport, sub)).toBe(type);
    expect(sportFamily(type)).toBe(family);
    // the fit profile's snake_case names map the same
    expect(fitSportType(snake(sport), snake(sub))).toBe(type);
  });

  it("an unknown sub_sport keeps the sport's type; unknown sports are generic workouts", () => {
    expect(fitSportType("running", "somethingNew")).toBe("Run");
    expect(fitSportType("paddleboarding")).toBe("Workout");
    expect(fitSportType(254)).toBe("Workout");
    expect(fitSportType(undefined, undefined)).toBe("Workout");
    expect(fitSportType("yoga")).toBe("Yoga"); // a sub_sport name in the sport field
  });
});

describe("intervals.icu type → sport type", () => {
  it.each(INTERVALS_TYPES)("%s maps to a site type with an icon (itself, but Other is a workout)", (type) => {
    const mapped = intervalsSportType(type);
    expect(mapped).toBe(type === "Other" ? "Workout" : type);
    expect(isSportType(mapped)).toBe(true);
    expect(iconExists(sportTypeIcon(mapped))).toBe(true);
  });

  it("the trainer flag refines runs and rides", () => {
    expect(intervalsSportType("Run", true)).toBe("TreadmillRun");
    expect(intervalsSportType("Ride", true)).toBe("IndoorRide");
    expect(intervalsSportType("VirtualRide", true)).toBe("VirtualRide");
    expect(intervalsSportType("Run", false)).toBe("Run");
  });

  it("unknown or missing types are generic workouts", () => {
    expect(intervalsSportType("NewThing")).toBe("Workout");
    expect(intervalsSportType(null)).toBe("Workout");
  });
});

describe("free-text types (gpx/tcx)", () => {
  it.each([
    ["running", "Run"],
    ["Run", "Run"],
    ["trail running", "TrailRun"],
    ["Biking", "Ride"],
    ["cycling", "Ride"],
    ["9", "Run"],
    ["1", "Ride"],
    ["hiking", "Hike"],
    ["walking", "Walk"],
    ["swim", "Swim"],
    ["", "Workout"],
    ["Other", "Other"],
  ])("%s → %s", (raw, type) => {
    expect(freeTextSportType(raw)).toBe(type);
  });
});

describe("grouping on every surface", () => {
  it("ride variants are rides, run variants runs, everywhere", () => {
    for (const t of typesInFamily("ride")) expect(sportGroup(t)).toBe("rides");
    for (const t of typesInFamily("run")) expect(sportGroup(t)).toBe("runs");
    expect(sportGroup("WeightTraining")).toBe("lifts");
    expect(sportGroup("Snowshoe")).toBe("hikes");
    expect(sportGroup("Golf")).toBe("other");
    expect(sportGroup("Quidditch")).toBe("other");
  });

  it("stat styles: foot sports show pace, wheels speed, gym and courts duration", () => {
    expect(sportMetric("TreadmillRun")).toBe("pace");
    expect(sportMetric("Hike")).toBe("pace");
    expect(sportMetric("IndoorRide")).toBe("speed");
    expect(sportMetric("EMountainBikeRide")).toBe("speed");
    expect(sportMetric("OpenWaterSwim")).toBe("distance");
    expect(sportMetric("AlpineSki")).toBe("distance");
    expect(sportMetric("Bouldering")).toBe("duration");
    expect(sportMetric("Pickleball")).toBe("duration");
    expect(sportMetric("HighIntensityIntervalTraining")).toBe("duration");
  });
});
