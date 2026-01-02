import { ExperienceItem } from "./work";

export const projectsData: ExperienceItem[] = [
  {
    id: "personal-site",
    title: "personal website",
    year: "2025",
    company: "next.js, tailwind, typescript",
    description: (
      <>
        this website! inspired by the cool sites of{" "}
        <a
          href="https://carolynwang.me"
          target="_blank"
          rel="noopener noreferrer"
          className="text-off-white link-highlight"
        >
          carolyn wang 
        </a> and{" "}
        <a
          href="https://charliekubal.com"
          target="_blank"
          rel="noopener noreferrer"
          className="text-off-white link-highlight"
        >
          charlie kubal
        </a>
        . &apos;currently&apos; section uses literal, spotify, and strava APIs. responses are cached with upstash for redis.
      </>
    ),
  },
  {
    id: "waveposer",
    title: "waveposer",
    year: "2025",
    company: "react, next.js, tailwind, web audio api",
    description: "real-time pose-to-audio synthesis using mediapipe and web audio api. converts human pose into waveforms with tone.js effects pipeline",
  },
  {
    id: "distributed-fs",
    title: "secure distributed file system",
    year: "2025",
    company: "golang, c",
    description: "secure file-sharing backend with user authentication, access revocation, and stateless concurrency-safe api",
  },
  {
    id: "adventure-game",
    title: "procedural adventure game",
    year: "2024",
    company: "java",
    description: "procedurally generated levels using disjoint-set data structures, graph search pathfinding, and ray casting for 3d view",
  },
  {
    id: "scheme-interpreter",
    title: "scheme interpreter",
    year: "2024",
    company: "python",
    description: "full interpreter for a subset of scheme with lexical scoping, tail-call optimization, and support for lambda procedures, special forms, and macro expansion",
  },
];
