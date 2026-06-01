import { loadYaml } from "./yaml";

interface HeroQuote {
  text: string;
  attribution: string;
}

export function getHeroQuotes(): string[] {
  const raw = loadYaml<HeroQuote[]>("hero-quotes.yaml");
  return raw.map((q) => `${q.text}\n- ${q.attribution}`);
}
