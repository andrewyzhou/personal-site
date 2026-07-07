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

export type { Cheatsheet, Course, CourseLink, Semester } from "./coursework";
import type { Semester } from "./coursework";

export function getCoursework(): Semester[] {
  try {
    return loadYaml<Semester[]>("coursework.yaml") ?? [];
  } catch {
    return [];
  }
}
