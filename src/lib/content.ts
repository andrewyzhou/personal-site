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
  | "learning"
  | "coursework";

export function getSectionDescriptions(): Record<SectionKey, string> {
  return loadYaml<Record<SectionKey, string>>("sections.yaml");
}
