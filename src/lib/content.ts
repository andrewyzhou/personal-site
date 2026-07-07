import { loadYaml } from "./yaml";

interface HeroQuote {
  text: string;
  attribution: string;
}

export function getHeroQuotes(): string[] {
  const raw = loadYaml<HeroQuote[]>("hero-quotes.yaml");
  return raw.map((q) => `${q.text}\n- ${q.attribution}`);
}

export type SectionKey =
  | "work"
  | "research"
  | "teaching"
  | "projects"
  | "library"
  | "blog"
  | "photos"
  | "coursework";

export function getSectionDescriptions(): Record<SectionKey, string> {
  return loadYaml<Record<SectionKey, string>>("sections.yaml");
}

export interface Cheatsheet {
  label: string;
  url: string;
}

export interface CourseLink {
  label: string;
  url: string;
}

export interface Course {
  code: string;
  title: string;
  cheatsheets?: Cheatsheet[];
  // detailed view (ws6): all optional — courses without detail render as before
  review?: string; // one-line take
  experience?: string; // longer writeup, blank lines split paragraphs
  links?: CourseLink[]; // notes and other resources beyond cheatsheets
}

export interface Semester {
  name: string;
  courses: Course[];
}

export function getCoursework(): Semester[] {
  try {
    return loadYaml<Semester[]>("coursework.yaml") ?? [];
  } catch {
    return [];
  }
}

export function courseHasDetail(course: Course): boolean {
  // cheatsheets alone don't warrant a detail card — they already render inline
  return !!course.review || !!course.experience || (course.links?.length ?? 0) > 0;
}

// "fall 2025" → "fa25" for tight right-aligned slots in the a–z list
export function semesterShortLabel(name: string): string {
  const m = name.toLowerCase().match(/(spring|summer|fall|winter)\s*'?(\d{2,4})/);
  if (!m) return name;
  const season = { spring: "sp", summer: "su", fall: "fa", winter: "wi" }[m[1]] ?? m[1];
  return `${season}${m[2].slice(-2)}`;
}
