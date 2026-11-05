// specimen content for the design lab (/design-system). real public values
// copied from the live site (activities 464 and 496), frozen so the lab
// renders without a database. these pages demo the system; they are not
// designs, so they don't go through the content layer.

export const SITE = {
  mark: "andrew zhou",
  nav: [
    { label: "activities", href: "/design-system/preview/x/activities" },
    { label: "lifts", href: "/design-system/preview/x/lifts" },
    { label: "photos", href: "/photos" },
    { label: "blog", href: "/blog" },
    { label: "library", href: "/library" },
  ],
  footer: "© andrew zhou 2025-2026",
  labels: { menu: "menu", theme: "switch to {theme} mode" },
};

export const HIKE = {
  id: 464,
  name: "🥾 epic hike at super underground spot",
  sport: "hike",
  date: "sunday, august 16",
  time: "6:48 pm",
  description: "my gps yearns for soda hall or smth",
  stats: [
    { label: "distance", value: "29.34", unit: "mi" },
    { label: "moving time", value: "2:27:23" },
    { label: "avg pace", value: "5:01", unit: "/mi" },
    { label: "elevation", value: "3,741", unit: "ft" },
  ],
};

export const LIFT = {
  name: "Full Body B",
  summary: "3 exercises · 6 working sets · 3,970 lb volume",
  sets: [
    { exercise: "squat (barbell)", sets: "2×5", load: "185 lb", top: "e1rm 216 lb", pr: false },
    { exercise: "deadlift (barbell)", sets: "1×5, 1×4", load: "185 lb", top: "e1rm 216 lb", pr: true },
    { exercise: "bicep curl (dumbbell)", sets: "1×6, 1×7", load: "35 lb", top: "e1rm 43 lb", pr: false },
  ],
};

export const RECENT = [
  { id: 497, name: "stroll", sport: "walk", date: "nov 3", stat: "0.56 mi" },
  { id: 496, name: "bike + lift with edward", sport: "lift", date: "nov 2", stat: "3:05:22" },
  { id: 495, name: "legs w edward and noah", sport: "lift", date: "oct 20", stat: "1:10:37" },
  { id: 494, name: "bike", sport: "ride", date: "oct 19", stat: "1.93 mi" },
  { id: 493, name: "lift", sport: "lift", date: "oct 18", stat: "1:11:26" },
  { id: 491, name: "hike w the littles :)", sport: "hike", date: "oct 17", stat: "1.75 mi" },
  { id: 464, name: "🥾 epic hike at super underground spot", sport: "hike", date: "aug 16", stat: "29.34 mi" },
];

export const HOME = {
  greeting: "hi, i'm andrew",
  affiliation: "electrical engineering & computer science @ uc berkeley",
  bio: [
    "i'm an undergraduate @ uc berkeley studying electrical engineering & computer sciences. my research interests lie broadly in machine learning architecture and infrastructure.",
    "currently, i'm a teaching assistant for cs 189 and cs 61a. this past summer, i was an ml engineer intern at annapurna labs on the neuron distributed training team.",
  ],
  sections: [
    { label: "work", meta: "incoming ml engineer · annapurna labs", href: "/#work" },
    { label: "research", meta: "sky computing lab · stanford medicine", href: "/#research" },
    { label: "teaching", meta: "cs 189 · cs 61a", href: "/#teaching" },
    { label: "projects", meta: "distributed fs · scheme interpreter · this site", href: "/#projects" },
  ],
};

// three candidate directions for v2. same system, different shell, accent and
// gray temperature.
export const DIRECTIONS = {
  a: { name: "a · quiet sidebar", variant: "rail", accent: "blue" },
  b: { name: "b · editorial pill", variant: "pill", accent: "amber" },
  c: { name: "c · top bar + breadcrumbs", variant: "topbar", accent: "green" },
} as const;
export type DirectionId = keyof typeof DIRECTIONS;
