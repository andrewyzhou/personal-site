// the one way pages get content. every kind is read from content/ and
// checked against its definition in ./kinds; a published file that doesn't
// match stops the build with the file name and every problem in it. drafts
// (a kind's wip/ folder) are never returned. server only (reads files).

import fs from "fs";
import path from "path";
import { contentPath } from "@/lib/content-root";
import { parseMdx, parseYamlFile } from "@/lib/admin/frontmatter";
import { getAllPhotosets, type PhotosEntry } from "@/lib/photos";
import type { Semester } from "@/lib/coursework";
import { getSite } from "./site";
import {
  BLURBS,
  COURSEWORK,
  PHOTO_SET,
  POST,
  PROJECT,
  QUOTES,
  READING,
  ROLE,
  ROLE_GROUPS,
  SCREEN,
  SECTIONS,
  SHELVES,
  type PostFields,
  type ProjectFields,
  type ReadingFields,
  type RoleFields,
  type RoleGroup,
  type ScreenFields,
  type ShelfId,
} from "./kinds";
import { problems, problemsOf, type Field, type Infer, type Shape } from "./schema";

export * from "./kinds";
export type { PhotosEntry } from "@/lib/photos";
export type { Semester } from "@/lib/coursework";

const SLUG_RE = /^[a-z0-9][a-z0-9-_]*$/;

// an entry of a collection: its fields, its url name, and its text (mdx)
export type Entry<T> = T & { slug: string; body: string };

export type Post = Entry<PostFields>;
export type Role = Entry<RoleFields> & { group: RoleGroup };
export type Project = Entry<ProjectFields>;
export type Reading = Entry<ReadingFields> & { status: "in-progress" | "completed" };
export type Screen = Entry<ScreenFields>;
export interface Quote {
  text: string;
  attribution: string;
}

export interface Problem {
  file: string;
  problems: string[];
}

export class ContentError extends Error {
  constructor(public readonly found: Problem[]) {
    super(`content doesn't match its definition:\n${found.map((p) => `  ${p.file}\n${p.problems.map((x) => `    - ${x}`).join("\n")}`).join("\n")}`);
    this.name = "ContentError";
  }
}

// ---------------------------------------------------------------- reading

interface Loaded<T> {
  entries: Entry<T>[];
  found: Problem[];
}

function loadCollection<S extends Shape>(dir: string, shape: S): Loaded<Infer<S>> {
  const full = contentPath(dir);
  const entries: Entry<Infer<S>>[] = [];
  const found: Problem[] = [];
  if (!fs.existsSync(full)) return { entries, found };
  // direct children only: a wip/ folder holds drafts and is never read
  for (const d of fs.readdirSync(full, { withFileTypes: true })) {
    if (!d.isFile() || !d.name.endsWith(".mdx")) continue;
    const file = `${dir}/${d.name}`;
    const slug = d.name.replace(/\.mdx$/, "");
    const { frontmatter, body } = parseMdx(fs.readFileSync(path.join(full, d.name), "utf8"));
    const errors = SLUG_RE.test(slug) ? problems(shape, frontmatter) : ["file name must be lowercase letters, digits, - or _"];
    if (errors.length > 0) found.push({ file, problems: errors });
    else entries.push({ ...(frontmatter as Infer<S>), slug, body });
  }
  return { entries, found };
}

function loadYamlFile<T>(file: string, f: Field<T>, fallback: T): { value: T; found: Problem[] } {
  const full = contentPath(file);
  if (!fs.existsSync(full)) return { value: fallback, found: [] };
  const { frontmatter } = parseYamlFile(fs.readFileSync(full, "utf8"));
  const data = "value" in frontmatter && Object.keys(frontmatter).length === 1 ? frontmatter.value : frontmatter;
  const errors = problemsOf(f, data, path.basename(file));
  return errors.length > 0 ? { value: fallback, found: [{ file, problems: errors }] } : { value: data as T, found: [] };
}

function strict<T>(loaded: { found: Problem[] } & T): T {
  if (loaded.found.length > 0) throw new ContentError(loaded.found);
  return loaded;
}

const byOrder = <T extends { order: number; slug: string }>(a: T, b: T) => a.order - b.order || a.slug.localeCompare(b.slug);

// ----------------------------------------------------------------- writing

// newest first, pinned posts ahead of the rest
export function posts(): Post[] {
  return strict(loadCollection("blog", POST)).entries.sort(
    (a, b) => Number(b.pinned ?? false) - Number(a.pinned ?? false) || b.date.localeCompare(a.date) || a.slug.localeCompare(b.slug),
  );
}

export function post(slug: string): Post | null {
  return posts().find((p) => p.slug === slug) ?? null;
}

// -------------------------------------------------------------------- work

function loadRoles(): Loaded<RoleFields & { group: RoleGroup }> {
  const entries: (Entry<RoleFields> & { group: RoleGroup })[] = [];
  const found: Problem[] = [];
  for (const group of ROLE_GROUPS) {
    const l = loadCollection(group, ROLE);
    found.push(...l.found);
    entries.push(...l.entries.map((e) => ({ ...e, group })));
  }
  return { entries, found };
}

// the roles listed under one group: its own, plus any filed elsewhere that
// name it in `alsoIn`
export function roles(group: RoleGroup): Role[] {
  return strict(loadRoles())
    .entries.filter((r) => r.group === group || (r.alsoIn ?? []).includes(group))
    .sort(byOrder);
}

// every role once, whatever groups it is listed under
export function allRoles(): Role[] {
  return strict(loadRoles()).entries.sort((a, b) => ROLE_GROUPS.indexOf(a.group) - ROLE_GROUPS.indexOf(b.group) || byOrder(a, b));
}

// ----------------------------------------------------------------- library

export function projects(): Project[] {
  return strict(loadCollection("projects", PROJECT)).entries.sort(byOrder);
}

// in progress first (latest started first), then finished (latest first)
export function reading(): Reading[] {
  const withStatus = strict(loadCollection("library", READING)).entries.map((e) => ({ ...e, status: e.dateCompleted ? ("completed" as const) : ("in-progress" as const) }));
  return withStatus.sort((a, b) => {
    if (a.status !== b.status) return a.status === "in-progress" ? -1 : 1;
    return (b.dateCompleted ?? b.dateStarted ?? "").localeCompare(a.dateCompleted ?? a.dateStarted ?? "") || a.slug.localeCompare(b.slug);
  });
}

// latest watched first; undated entries last
export function screen(): Screen[] {
  return strict(loadCollection("screen", SCREEN)).entries.sort((a, b) => (b.dateWatched ?? "").localeCompare(a.dateWatched ?? "") || a.slug.localeCompare(b.slug));
}

function photoSetProblems(): Problem[] {
  const full = contentPath("photos");
  if (!fs.existsSync(full)) return [];
  const found: Problem[] = [];
  for (const d of fs.readdirSync(full, { withFileTypes: true })) {
    if (!d.isFile() || !/\.ya?ml$/.test(d.name)) continue;
    const { frontmatter } = parseYamlFile(fs.readFileSync(path.join(full, d.name), "utf8"));
    const errors = problems(PHOTO_SET, frontmatter);
    if (errors.length > 0) found.push({ file: `photos/${d.name}`, problems: errors });
  }
  return found;
}

// newest first. the photo loader reads image sizes and builds the blocks.
export function photoSets(): PhotosEntry[] {
  strict({ found: photoSetProblems() });
  return getAllPhotosets();
}

export function coursework(): Semester[] {
  return strict(loadYamlFile("coursework.yaml", COURSEWORK, [])).value as Semester[];
}

export interface Shelf {
  id: ShelfId;
  count: number;
  // the day the shelf last gained something, when its entries carry dates
  updated?: string;
}

const latest = (days: (string | undefined)[]): string | undefined => days.filter((d): d is string => !!d).sort().at(-1);

// the library's shelves with how much each holds
export function shelves(): Shelf[] {
  const r = reading();
  const s = screen();
  const p = photoSets();
  const counts: Record<ShelfId, Shelf> = {
    reading: { id: "reading", count: r.length, updated: latest(r.map((e) => e.dateCompleted ?? e.dateStarted)) },
    screen: { id: "screen", count: s.length, updated: latest(s.map((e) => e.dateWatched)) },
    photos: { id: "photos", count: p.length, updated: latest(p.map((e) => e.date)) },
    projects: { id: "projects", count: projects().length },
    coursework: { id: "coursework", count: coursework().reduce((n, sem) => n + sem.courses.length, 0) },
  };
  return SHELVES.map((id) => counts[id]);
}

// ---------------------------------------------------------------- one-offs

// the about-me text (mdx)
export function bio(): string {
  const full = contentPath("bio.mdx");
  const body = fs.existsSync(full) ? parseMdx(fs.readFileSync(full, "utf8")).body : "";
  if (body.trim() === "") throw new ContentError([{ file: "bio.mdx", problems: ["bio cannot be empty"] }]);
  return body;
}

export function quotes(): Quote[] {
  return strict(loadYamlFile("hero-quotes.yaml", QUOTES, [])).value as Quote[];
}

// the line under each home tab, by key; missing keys read as ""
export function blurbs(): Record<string, string> {
  const raw = strict(loadYamlFile("sections.yaml", BLURBS, {})).value as Record<string, string | null>;
  return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, v ?? ""]));
}

// all of the site's own wording (content/site.yaml)
export const site = getSite;

// ---------------------------------------------------------------- sections

// what the writing section lists: every post, plus the notes that opted in
export type WritingItem =
  | { kind: "post"; date: string; entry: Post }
  | { kind: "reading"; date: string; entry: Reading }
  | { kind: "screen"; date: string; entry: Screen };

export function writing(): WritingItem[] {
  const items: WritingItem[] = posts().map((entry) => ({ kind: "post", date: entry.date, entry }));
  for (const entry of reading()) {
    const day = entry.dateCompleted ?? entry.dateStarted;
    if (entry.inWriting && day) items.push({ kind: "reading", date: day, entry });
  }
  for (const entry of screen()) if (entry.inWriting && entry.dateWatched) items.push({ kind: "screen", date: entry.dateWatched, entry });
  return items.sort((a, b) => b.date.localeCompare(a.date) || a.entry.slug.localeCompare(b.entry.slug));
}

export const sections = () => SECTIONS;

// ------------------------------------------------------------------ checks

// every problem in every published file, without throwing. the test suite
// asserts this is empty, so a bad file fails before it can reach a build.
export function check(): Problem[] {
  const found: Problem[] = [];
  found.push(...loadCollection("blog", POST).found);
  found.push(...loadRoles().found);
  found.push(...loadCollection("projects", PROJECT).found);
  found.push(...loadCollection("library", READING).found);
  found.push(...loadCollection("screen", SCREEN).found);
  found.push(...photoSetProblems());
  found.push(...loadYamlFile("coursework.yaml", COURSEWORK, []).found);
  found.push(...loadYamlFile("hero-quotes.yaml", QUOTES, []).found);
  found.push(...loadYamlFile("sections.yaml", BLURBS, {}).found);
  try {
    bio();
  } catch (e) {
    if (e instanceof ContentError) found.push(...e.found);
    else throw e;
  }
  return found;
}

// problems in drafts (wip/ folders). a draft may be unfinished, so these are
// for the editor to show, never a build failure.
export function checkDrafts(): Problem[] {
  return [
    ...loadCollection("blog/wip", POST).found,
    ...loadCollection("library/wip", READING).found,
    ...loadCollection("screen/wip", SCREEN).found,
  ];
}
