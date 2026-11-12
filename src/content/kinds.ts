// every kind of content the site has, described once. pages, the editor and
// the tests all take their types and their checks from here. no fs: safe to
// import from client components.

import { anyText, bool, date, list, number, object, oneOf, optional, record, stars, text, type Infer } from "./schema";

// ------------------------------------------------------------------ writing

export const POST = {
  title: text(),
  date: date(),
  summary: text(),
  tags: list(text()),
  cover: optional(text()),
  // pinned posts sort first everywhere
  pinned: optional(bool()),
};
export type PostFields = Infer<typeof POST>;

// --------------------------------------------------------------------- work

export const ROLE_GROUPS = ["work", "research", "teaching"] as const;
export type RoleGroup = (typeof ROLE_GROUPS)[number];

// a job, a research position or a teaching post. it lives in one group's
// folder; `alsoIn` lists it under other groups too without a second file.
export const ROLE = {
  order: number(),
  title: text(),
  company: text(),
  companyUrl: optional(text()),
  location: optional(text()),
  period: optional(text()),
  year: text(),
  alsoIn: optional(list(oneOf(ROLE_GROUPS))),
};
export type RoleFields = Infer<typeof ROLE>;

// ------------------------------------------------------------------ library

// `company` holds the stack line shown where a role shows its company
export const PROJECT = {
  order: number(),
  title: text(),
  company: text(),
  companyUrl: optional(text()),
  location: optional(text()),
  period: optional(text()),
  year: text(),
};
export type ProjectFields = Infer<typeof PROJECT>;

// notes on something read
export const READING = {
  title: text(),
  creator: text(),
  sourceUrl: optional(text()),
  cover: optional(text()),
  dateStarted: optional(date()),
  dateCompleted: optional(date()),
  rating: optional(stars()),
  tags: list(text()),
  summary: text(),
  // also list this note in the writing section
  inWriting: optional(bool()),
};
export type ReadingFields = Infer<typeof READING>;

// notes on a movie or a show. every time it is watched is its own entry in
// `watches`, with that viewing's rating and review, so a rewatch adds to the
// record instead of replacing it. no watches yet = on the list to watch.
export const WATCH = { date: date(), rating: optional(stars()), review: optional(anyText()) };
export type Watch = Infer<typeof WATCH>;
export const SCREEN_FORMATS = ["movie", "show"] as const;
export const SCREEN = {
  title: text(),
  format: oneOf(SCREEN_FORMATS),
  year: optional(number({ min: 1880, max: 2100 })),
  // poster image, local path or https
  cover: optional(text()),
  sourceUrl: optional(text()),
  watches: list(object(WATCH)),
  tags: list(text()),
  summary: optional(anyText()),
  inWriting: optional(bool()),
};
export type ScreenFields = Infer<typeof SCREEN>;

const LINK = object({ label: text(), url: text() });

export const COURSE = {
  code: text(),
  title: text(),
  cheatsheets: optional(list(LINK)),
  review: optional(anyText()),
  experience: optional(anyText()),
  links: optional(list(LINK)),
};
export const SEMESTER = { name: text(), courses: list(object(COURSE)) };
export const COURSEWORK = list(object(SEMESTER));

// photo sets come in two formats; the shared part is checked here and the
// photo list or block list by the photo loader, which also reads the images
export const PHOTO_SET = {
  title: text(),
  date: date(),
  format: optional(oneOf(["blocks"] as const)),
};

// ------------------------------------------------------------------ one-offs

export const QUOTES = list(object({ text: text(), attribution: text() }));

// the line under each home tab; a key may be left empty
export const BLURBS = record(anyText());

// ----------------------------------------------------------------- sections

// the three sections of the site and the kinds each one holds. a theme may
// use this for its navigation; the content interface groups by it.
export const SECTIONS = [
  { id: "writing", kinds: ["posts"] },
  { id: "work", kinds: ["work", "research", "teaching"] },
  { id: "library", kinds: ["reading", "screen", "photos", "projects", "coursework"] },
] as const;
export type SectionId = (typeof SECTIONS)[number]["id"];

// the shelves of the library, in display order
export const SHELVES = ["reading", "screen", "photos", "projects", "coursework"] as const;
export type ShelfId = (typeof SHELVES)[number];
