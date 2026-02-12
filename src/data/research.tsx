import { ExperienceItem } from "./work";

export const researchData: ExperienceItem[] = [
  {
    id: "afterquery-research",
    title: "code gen & evals",
    company: "afterquery",
    companyUrl: "https://afterquery.com",
    location: "san francisco",
    period: "nov 2025 – present",
    description: (
      <ul className="list-disc list-inside">
        <li>built <a href="https://appbench.ai" target="_blank" rel="noopener noreferrer" className="link-highlight">appbench.ai</a>, a comprehensive benchmarking platform for code generation tools</li>
        <li>engineered an agent harness system running parallelized evaluations across 14 frontier models with trajectory logging, cost analysis, and automated grading</li>
      </ul>
    ),
    year: "2025",
  },
  {
    id: "stanford",
    title: "deep learning, diffusion & imaging",
    company: "guolan lu lab | stanford medicine",
    companyUrl: "https://med.stanford.edu/guolanlulab.html",
    location: "stanford",
    period: "may 2025 – aug 2025",
    description: (
      <ul className="list-disc list-inside">
        <li>trained 4d diffusion-transformer for super-resolution</li>
        <li>built 4d image analysis pipeline and novel hybrid-attention transformer for spatial proteomics imagery</li>
      </ul>
    ),
    year: "2025",
  },
];
