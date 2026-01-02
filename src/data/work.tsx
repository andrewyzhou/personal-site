export interface ExperienceItem {
  id: string;
  title: string;
  company: string;
  companyUrl?: string;
  description: React.ReactNode;
  year: string;
}

export const workData: ExperienceItem[] = [
  {
    id: "afterquery",
    title: "ml research & software",
    company: "afterquery",
    companyUrl: "https://afterquery.com",
    description: (<>built <a href="https://appbench.ai" target="_blank" rel="noopener noreferrer" className="link-highlight">appbench.ai</a>, a comprehensive benchmarking platform for code generation tools.</>),
    year: "2025",
  },
  {
    id: "lgnova",
    title: "backend software & agents",
    company: "lg nova",
    companyUrl: "https://www.lgnova.com/",
    description: "document storage and analysis dashboard to manage lg nova's startups. built restful api and rag pipeline on centralized postgresql db.",
    year: "2025",
  },
  {
    id: "ipick",
    title: "ai systems",
    company: "ipick.ai",
    companyUrl: "https://ipick.ai",
    description: "financial agents and backend engineering. built multi-rag agent stock-screening ensemble. designed backend systems to support speedy agents.",
    year: "2025",
  },
  {
    id: "claythis",
    title: "ai 3d models",
    company: "claythis",
    companyUrl: "https://claythis.com",
    description: "iterating on ai 3d model generation, from animations to textures. built demo for pitch decks.",
    year: "2025",
  },
];
