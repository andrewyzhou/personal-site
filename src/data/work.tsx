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
    title: "ai 3d models",
    company: "claythis",
    companyUrl: "https://claythis.com",
    description: (
      <ul className="list-disc list-inside">
        <li>iterated on ai 3d model generation, from animations to textures</li>
        <li>built demo used in successful investor pitches</li>
      </ul>
    ),
    year: "2025",
  },
];
