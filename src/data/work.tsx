export interface ExperienceItem {
  id: string;
  title: string;
  company: string;
  companyUrl?: string;
  description: React.ReactNode;
  year: string;
  period?: string;
  location?: string;
}

export const workData: ExperienceItem[] = [
  {
    id: "annapurna",
    title: "[incoming] ml engineer",
    company: "annapurna labs",
    location: "seattle",
    period: "may 2026 – aug 2026",
    description: (
      <ul className="list-disc list-inside">
        <li>incoming summer 2026</li>
        <li>distributed ml training team</li>
      </ul>
    ),
    year: "2026",
  },
  {
    id: "afterquery",
    title: "ml research & software",
    company: "afterquery",
    companyUrl: "https://afterquery.com",
    location: "san francisco",
    period: "nov 2025 – present",
    description: (
      <ul className="list-disc list-inside">
        <li>built <a href="https://appbench.ai" target="_blank" rel="noopener noreferrer" className="link-highlight">appbench.ai</a>, a comprehensive benchmarking platform for code generation tools</li>
      </ul>
    ),
    year: "2025",
  },
  {
    id: "lgnova",
    title: "backend & llms",
    company: "lg nova",
    companyUrl: "https://www.lgnova.com/",
    location: "santa clara",
    period: "sep 2025 – dec 2025",
    description: (
      <ul className="list-disc list-inside">
        <li>built document storage + analysis dashboard for lg nova startups</li>
        <li>designed rest api + rag pipeline on centralized postgresql db</li>
      </ul>
    ),
    year: "2025",
  },
  {
    id: "ipick",
    title: "ai agents & systems",
    company: "ipick.ai",
    companyUrl: "https://ipick.ai",
    location: "cupertino",
    period: "sep 2024 – nov 2025",
    description: (
      <ul className="list-disc list-inside">
        <li>built multi rag agent stock-screening + portfolio analysis ensemble</li>
        <li>designed backend systems to support speedy agents</li>
        <li>contributed to 48% growth in 2025 for multi-million AUM</li>
      </ul>
    ),
    year: "2025",
  },
  {
    id: "claythis",
    title: "generative 3d modeling",
    company: "claythis",
    companyUrl: "https://claythis.com",
    location: "menlo park",
    period: "jun 2025 – aug 2025",
    description: (
      <ul className="list-disc list-inside">
        <li>iterated on ai 3d model generation, from animations to textures</li>
        <li>built demo used in successful investor pitches</li>
      </ul>
    ),
    year: "2025",
  },
];
