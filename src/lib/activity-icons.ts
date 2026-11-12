// every activity icon file in public/icons/activities, named after what it
// draws. each one is either a hugeicons free icon (stroke-rounded, drawn at
// stroke width 2; license in public/icons/activities/LICENSE.md) or a file in
// scripts/icons/custom/. sport types pick a file by key in src/lib/sport-types.ts.
// pure data, safe for client components.
// after editing, run `npm run icons:build` (scripts/icons/build.mts).

export type IconSource = { hugeicons: string } | { custom: string };

export const ACTIVITY_ICONS = {
  // foot
  "running-shoe": { hugeicons: "RunningShoesIcon" },
  "sport-shoe": { hugeicons: "SportShoeIcon" },
  shoe: { hugeicons: "ShoesIcon" },
  "hiking-boot": { custom: "hiking-boot.svg" },
  mountain: { hugeicons: "MountainIcon" },
  treadmill: { hugeicons: "Treadmill01Icon" },
  "treadmill-alt": { hugeicons: "Treadmill02Icon" },
  wheelchair: { hugeicons: "WheelchairIcon" },

  // wheels
  bicycle: { hugeicons: "BicycleIcon" },
  "bicycle-alt": { hugeicons: "Bicycle01Icon" },
  "bike-rider": { hugeicons: "BikeIcon" },
  motorbike: { hugeicons: "Motorbike01Icon" },
  car: { hugeicons: "Car01Icon" },

  // water
  "pool-ladder": { hugeicons: "WavesLadderIcon" },
  waves: { hugeicons: "WavesIcon" },
  swimmer: { hugeicons: "SwimmingIcon" },
  kayak: { hugeicons: "KayakIcon" },
  surfboard: { hugeicons: "SurfboardIcon" },
  windsurf: { hugeicons: "WindSurfIcon" },
  kite: { hugeicons: "KiteIcon" },
  sailboat: { hugeicons: "SailboatIcon" },
  anchor: { hugeicons: "AnchorIcon" },
  fish: { hugeicons: "FishIcon" },

  // snow + ice
  ski: { hugeicons: "SkiIcon" },
  "mountain-snow": { hugeicons: "MountainSnowIcon" },
  snowflake: { hugeicons: "SnowflakeIcon" },
  "ice-skate": { hugeicons: "IceSkatingIcon" },
  "roller-skate": { hugeicons: "RollerSkateIcon" },

  // gym
  dumbbell: { custom: "dumbbell.svg" }, // hugeicons Dumbbell02 with a straight bar
  kettlebell: { hugeicons: "KettlebellIcon" },
  activity: { hugeicons: "Activity03Icon" },
  timer: { hugeicons: "Timer01Icon" },
  stairs: { hugeicons: "Stairs01Icon" },
  "jump-rope": { hugeicons: "SkippingRopeIcon" },
  "boxing-glove": { hugeicons: "BoxingGloveIcon" },
  kick: { hugeicons: "WorkoutKickingIcon" },
  "music-note": { hugeicons: "MusicNote01Icon" },

  // mind
  "yoga-mat": { hugeicons: "YogaMatIcon" },
  "yoga-ball": { hugeicons: "YogaBallIcon" },
  stretching: { hugeicons: "WorkoutStretchingIcon" },
  lotus: { hugeicons: "Yoga01Icon" },
  wind: { hugeicons: "WindIcon" },

  // climbing
  stone: { hugeicons: "StoneIcon" },

  // courts + fields
  "tennis-racket": { hugeicons: "TennisRacketIcon" },
  paddle: { hugeicons: "TableTennisBatIcon" },
  shuttlecock: { hugeicons: "BadmintonShuttleIcon" },
  pitch: { hugeicons: "FootballPitchIcon" },
  basketball: { hugeicons: "Basketball01Icon" },
  volleyball: { hugeicons: "VolleyballIcon" },
  "american-football": { hugeicons: "AmericanFootballIcon" },
  "hockey-stick": { hugeicons: "HockeyIcon" },
  baseball: { hugeicons: "BaseballIcon" },
  "cricket-bat": { hugeicons: "CricketBatIcon" },
  whistle: { hugeicons: "WhistleIcon" },
  "golf-flag": { hugeicons: "GolfHoleIcon" },
  frisbee: { hugeicons: "FrisbeeIcon" },

  // multi + everything else
  medal: { hugeicons: "Medal01Icon" },
  swap: { hugeicons: "ArrowLeftRightIcon" },
  horse: { hugeicons: "HorseIcon" },
  "bow-arrow": { hugeicons: "BowArrowIcon" },
  target: { hugeicons: "Target01Icon" },
  plane: { hugeicons: "PlaneTakeoffIcon" },
  paraglider: { hugeicons: "ParaglidingIcon" },
  gamepad: { hugeicons: "GamepadIcon" },
} as const satisfies Record<string, IconSource>;

export type ActivityIcon = keyof typeof ACTIVITY_ICONS;
