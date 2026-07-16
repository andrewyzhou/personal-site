"use client";

import { useEffect, useRef, useState } from "react";
import GoldenLogo from "./GoldenLogo";
import CurrentlyCards from "./CurrentlyCards";
import SocialLinks from "@/components/SocialLinks";

const SECTIONS = [
  { id: "home", label: "home" },
  { id: "about", label: "about" },
  { id: "work", label: "work" },
  { id: "research", label: "research" },
  { id: "teaching", label: "teaching" },
  { id: "projects", label: "projects" },
  { id: "library", label: "library" },
  { id: "blog", label: "blog" },
  { id: "photos", label: "photos" },
  { id: "coursework", label: "coursework" },
] as const;

type SectionId = (typeof SECTIONS)[number]["id"];

interface HomeShellProps {
  descriptions: Partial<Record<string, string>>;
}

export default function HomeShell({ descriptions }: HomeShellProps) {
  const [active, setActive] = useState<SectionId>("home");
  const containerRef = useRef<HTMLDivElement>(null);

  // scroll-spy: highlight the nav item for the section filling the viewport
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActive(entry.target.id.replace("section-", "") as SectionId);
          }
        }
      },
      { root: container, threshold: 0.55 }
    );
    container.querySelectorAll("section[id^='section-']").forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  const goTo = (id: SectionId) => {
    document.getElementById(`section-${id}`)?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <div className="flex h-dvh overflow-hidden">
      {/* left sidebar — simple dividing line for now (dynamic progress line later) */}
      <aside
        className="hidden md:flex w-64 shrink-0 flex-col h-full"
        style={{ borderRight: "1px solid var(--theme-divider)", padding: "2rem 1.75rem" }}
      >
        <button
          onClick={() => goTo("home")}
          className="flex items-center gap-3 cursor-pointer"
          aria-label="scroll to top"
        >
          <GoldenLogo variant="mark" animate={false} className="w-12 shrink-0" />
          <span className="font-sans font-bold text-off-white text-base">andrew zhou</span>
        </button>

        <nav className="flex flex-col gap-0.5 flex-1 min-h-0 overflow-y-auto" style={{ marginTop: "2.5rem" }}>
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              onClick={() => goTo(s.id)}
              className={`text-left text-sm cursor-pointer transition-colors ${
                active === s.id ? "text-off-white font-medium" : "text-gray hover:text-secondary"
              }`}
              style={{ padding: "0.25rem 0" }}
            >
              {s.label}
            </button>
          ))}
        </nav>

        <div style={{ marginBottom: "0.5rem" }}>
          <CurrentlyCards variant="mini" />
        </div>
        <SocialLinks />
      </aside>

      {/* right: one section on screen at a time, scroll locked per page */}
      <div ref={containerRef} className="flex-1 h-full overflow-y-auto snap-y snap-mandatory">
        {/* home */}
        <section
          id="section-home"
          className="h-full snap-start flex flex-col items-center justify-center"
          style={{ padding: "0 clamp(1.5rem, 4vw, 3rem)" }}
        >
          <GoldenLogo variant="hero" className="w-full max-w-md" />
          <h1
            className="font-sans font-bold text-off-white text-4xl md:text-5xl"
            style={{ marginTop: "2.5rem" }}
          >
            andrew zhou
          </h1>
          <p className="text-gray text-base md:text-lg" style={{ marginTop: "0.75rem" }}>
            electrical engineering &amp; computer science @ uc berkeley
          </p>
          <div style={{ marginTop: "2.25rem" }}>
            <CurrentlyCards variant="full" />
          </div>
        </section>

        {/* placeholder sections — real content lands here next */}
        {SECTIONS.slice(1).map((s) => (
          <section
            key={s.id}
            id={`section-${s.id}`}
            className="h-full snap-start flex flex-col justify-center"
            style={{ padding: "0 clamp(2rem, 8vw, 5rem)" }}
          >
            <h2 className="font-sans font-bold text-off-white text-3xl md:text-4xl">{s.label}</h2>
            {descriptions[s.id] && (
              <p className="text-secondary text-base max-w-xl line-clamp-4" style={{ marginTop: "1rem" }}>
                {descriptions[s.id]?.split("\\n")[0]}
              </p>
            )}
            <p className="text-gray text-sm" style={{ marginTop: "1.5rem" }}>
              full section coming in the redesign
            </p>
          </section>
        ))}
      </div>
    </div>
  );
}
