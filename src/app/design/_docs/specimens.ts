// specimen content for the design docs. real public values copied from the
// live site (activities 464, 496 and the recent list, the library drafts, the
// hello-world post), frozen so the docs render without a database. the docs
// demo the system; they are not a design, so they don't go through the
// content layer. hub labels and intros come from content/site.yaml.

export const FOOTER = "© andrew zhou 2025-2026";
export const LABELS = { menu: "menu", theme: "switch to {theme} mode" };

export const HIKE = {
  id: 464,
  name: "🥾 epic hike at super underground spot",
  sport: "hike",
  date: "sunday, august 16",
  short: "aug 16",
  time: "6:48 pm",
  description: "my gps yearns for soda hall or smth",
  stats: [
    { label: "distance", value: "29.34", unit: "mi" },
    { label: "moving time", value: "2:27:23" },
    { label: "avg pace", value: "5:01", unit: "/mi" },
    { label: "elevation", value: "3,741", unit: "ft" },
  ],
  details: [
    { label: "elapsed", value: "2:41:05" },
    { label: "max elevation", value: "1,912", unit: "ft" },
    { label: "avg heart rate", value: "142", unit: "bpm" },
    { label: "calories", value: "1,610" },
  ],
};

export const LIFT = {
  id: 496,
  name: "bike + lift with edward",
  date: "monday, november 2",
  short: "nov 2",
  time: "2:01 pm",
  program: "full body b",
  summary: "3 exercises · 6 working sets · 3,970 lb volume",
  stats: [
    { label: "time", value: "3:05:22" },
    { label: "volume", value: "3,970", unit: "lb" },
    { label: "avg heart rate", value: "95", unit: "bpm" },
    { label: "max heart rate", value: "172", unit: "bpm" },
  ],
  sets: [
    { exercise: "squat (barbell)", sets: "2×5", load: "185 lb", top: "e1rm 216 lb", pr: false },
    { exercise: "deadlift (barbell)", sets: "1×5, 1×4", load: "185 lb", top: "e1rm 216 lb", pr: true },
    { exercise: "bicep curl (dumbbell)", sets: "1×6, 1×7", load: "35 lb", top: "e1rm 43 lb", pr: false },
  ],
};

export const TRAINING = [
  { id: 497, name: "stroll", sport: "walk", date: "nov 3", stat: "0.56 mi" },
  { id: 496, name: "bike + lift with edward", sport: "lift", date: "nov 2", stat: "3:05:22" },
  { id: 495, name: "legs w edward and noah", sport: "lift", date: "oct 20", stat: "1:10:37" },
  { id: 494, name: "bike", sport: "ride", date: "oct 19", stat: "1.93 mi" },
  { id: 493, name: "lift", sport: "lift", date: "oct 18", stat: "1:11:26" },
  { id: 491, name: "hike w the littles :)", sport: "hike", date: "oct 17", stat: "1.75 mi" },
  { id: 488, name: "bike to oh and back", sport: "ride", date: "oct 7", stat: "1.86 mi" },
  { id: 464, name: "🥾 epic hike at super underground spot", sport: "hike", date: "aug 16", stat: "29.34 mi" },
];

export const TRAINING_SUMMARY = [
  { label: "this week", value: "3", unit: "sessions" },
  { label: "distance in 2026", value: "97.3", unit: "mi" },
  { label: "working sets / week", value: "18" },
  { label: "records this month", value: "2" },
];

export const WRITING = [
  { kind: "post", slug: "hello-world", title: "hello, world", date: "may 31, 2026", summary: "sample text." },
  { kind: "note", slug: "foundation", title: "foundation", date: "isaac asimov · book", summary: "sample text." },
  { kind: "note", slug: "make-it-stick", title: "make it stick", date: "brown, roediger & mcdaniel · book", summary: "sample text." },
  { kind: "note", slug: "psychology-of-money", title: "the psychology of money", date: "morgan housel · book", summary: "sample text." },
];

export const ARTICLE = {
  title: "hello, world",
  date: "may 31, 2026",
  tags: ["meta"],
  body: [
    "sample text.",
    "sample text.",
  ],
};

export const HOME = {
  greeting: "hi, i'm andrew",
  affiliation: "electrical engineering & computer science @ uc berkeley",
  bio: [
    { text: "i'm an undergraduate @ ", link: "uc berkeley", after: " studying electrical engineering & computer sciences. my research interests lie broadly in machine learning architecture and infrastructure." },
    { text: "this past summer, i was an ml engineer intern at ", link: "annapurna labs", after: " on the neuron distributed training team, bringing flux diffusion training to aws trainium." },
  ],
  currently: "i'm currently reading the algebra of happiness by scott galloway. my last workout was a 0.6 mi walk yesterday.",
  contact: "i love chatting — the best way to reach me is by email. i read every message!",
  email: "firstnamelastname [at] berkeley [dot] edu",
};

// sport → icon file in /public/icons/activities
export const SPORT_ICON: Record<string, string> = { walk: "shoe", lift: "dumbbell", ride: "bicycle", hike: "hiking-boot", run: "running-shoe" };
