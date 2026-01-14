import { ExperienceItem } from "./work";

export const projectsData: ExperienceItem[] = [
  {
    id: "personal-site",
    title: "personal website",
    year: "2025",
    company: "next.js, tailwind, typescript",
    description: (
      <ul className="list-disc list-inside">
        <li>this website! inspired by the cool sites of{" "}
          <a href="https://carolynwang.me" target="_blank" rel="noopener noreferrer" className="text-off-white link-highlight">carolyn wang</a> and{" "}
          <a href="https://charliekubal.com" target="_blank" rel="noopener noreferrer" className="text-off-white link-highlight">charlie kubal</a>
        </li>
        <li>&apos;currently&apos; section uses literal, spotify, and strava APIs</li>
        <li>responses + strava calendar are cached with upstash for redis</li>
      </ul>
    ),
  },
  {
    id: "waveposer",
    title: "waveposer",
    year: "2025",
    company: "react, next.js, tailwind, web audio api",
    description: (
      <ul className="list-disc list-inside">
        <li>real-time pose-to-audio synthesis using mediapipe and web audio api</li>
        <li>converts human pose into waveforms with tone.js effects pipeline</li>
      </ul>
    ),
  },
  {
    id: "distributed-fs",
    title: "secure distributed file system",
    year: "2025",
    company: "golang, c",
    description: (
      <ul className="list-disc list-inside">
        <li>secure file-sharing backend with user authentication, access revocation, and stateless concurrency-safe api</li>
      </ul>
    ),
  },
  {
    id: "adventure-game",
    title: "procedural adventure game",
    year: "2024",
    company: "java",
    description: (
      <ul className="list-disc list-inside">
        <li>procedurally generated levels using disjoint-set data structures, graph search pathfinding, and ray casting for 3d view</li>
      </ul>
    ),
  },
  {
    id: "scheme-interpreter",
    title: "scheme interpreter",
    year: "2024",
    company: "python",
    description: (
      <ul className="list-disc list-inside">
        <li>full interpreter for a subset of scheme with lexical scoping, tail-call optimization, and support for lambda procedures, special forms, and macro expansion</li>
      </ul>
    ),
  },
];
