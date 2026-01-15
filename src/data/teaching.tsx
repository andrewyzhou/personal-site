import { ExperienceItem } from "./work";

export const teachingData: ExperienceItem[] = [
  {
    id: "cs61a-tutor-sp26",
    title: "cs 61a tutor",
    company: "uc berkeley eecs",
    companyUrl: "https://eecs.berkeley.edu/",
    description: (
      <ul className="list-disc list-inside">
        <li>teaching <a href="https://cs61a.org" target="_blank" rel="noopener noreferrer" className="link-highlight">cs 61a</a>&apos;s <a href="https://eecs.berkeley.edu/cs-scholars/" target="_blank" rel="noopener noreferrer" className="link-highlight">cs scholars</a> discussion and lab sections!</li>
      </ul>
    ),
    year: "spring 2026",
  },
  {
    id: "cs61a-tutor-fa25",
    title: "cs 61a tutor",
    company: "uc berkeley eecs",
    companyUrl: "https://eecs.berkeley.edu/",
    description: (
      <ul className="list-disc list-inside">
        <li>taught <a href="https://cs61a.org" target="_blank" rel="noopener noreferrer" className="link-highlight">cs 61a</a>&apos;s <a href="https://eecs.berkeley.edu/cs-scholars/" target="_blank" rel="noopener noreferrer" className="link-highlight">cs scholars</a> discussion and lab sections!</li>
      </ul>
    ),
    year: "fall 2025",
  },
];
