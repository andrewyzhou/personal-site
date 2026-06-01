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
  | "coursework";

export function getSectionDescriptions(): Record<SectionKey, string> {
  return loadYaml<Record<SectionKey, string>>("sections.yaml");
}

export interface Cheatsheet {
  label: string;
  url: string;
}

export interface Course {
  code: string;
  title: string;
  cheatsheets?: Cheatsheet[];
}

export interface Semester {
  name: string;
  courses: Course[];
}

export function getCoursework(): Semester[] {
  return loadYaml<Semester[]>("coursework.yaml");
}
