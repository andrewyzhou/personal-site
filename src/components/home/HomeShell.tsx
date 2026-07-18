"use client";

import { useEffect, useRef, useState } from "react";
import GoldenLogo from "./GoldenLogo";
import CurrentlyCards from "./CurrentlyCards";
import SocialLinks from "@/components/SocialLinks";
import Currently from "@/components/Currently";
import ActivityCalendar from "@/components/ActivityCalendar";
import ErrorBoundary from "@/components/ErrorBoundary";
import Hero from "@/components/Hero";

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
  bio: React.ReactNode;
  quotes: string[];
}

export default function HomeShell({ descriptions, bio, quotes }: HomeShellProps) {
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
    <div className="relative flex h-dvh overflow-hidden">
      {/* left sidebar — simple dividing line for now (dynamic progress line later) */}
      <aside
        className="hidden md:flex shrink-0 flex-col h-full"
        style={{ width: 150, borderRight: "1px solid var(--theme-divider)", padding: "2rem 1.25rem" }}
      >
        {/* the logo lives here now — always visible, doubles as "home" */}
        <button
          onClick={() => goTo("home")}
          aria-label="home"
          className="cursor-pointer w-full flex justify-end shrink-0"
          style={{ marginBottom: "1.75rem" }}
        >
          <GoldenLogo variant="hero" className="w-full" />
        </button>

        <nav className="flex flex-col items-end gap-0.5 flex-1 min-h-0 overflow-y-auto">
          {SECTIONS.slice(1).map((s) => (
            <button
              key={s.id}
              onClick={() => goTo(s.id)}
              className={`text-right text-sm cursor-pointer transition-colors ${
                active === s.id ? "text-off-white font-medium" : "text-gray hover:text-secondary"
              }`}
              style={{ padding: "0.25rem 0" }}
            >
              {s.label}
            </button>
          ))}
        </nav>

        <div className="w-full" style={{ marginBottom: "0.25rem" }}>
          <CurrentlyCards variant="mini" />
        </div>
        <SocialLinks className="justify-end flex-wrap" />
      </aside>

      {/* right: one section on screen at a time, scroll locked per page */}
      <div ref={containerRef} className="flex-1 h-full overflow-y-auto snap-y snap-mandatory">
        {/* home — the old homepage, minus the section tabs (nav lives left) */}
        <section
          id="section-home"
          className="h-full snap-start flex flex-col justify-center"
          style={{ padding: "1.5rem clamp(2rem, 5vw, 4rem)", gap: "1.5rem" }}
        >
          {/* old hero: headshot + "hi, i'm andrew" + socials, school + quotes right */}
          <Hero quotes={quotes} />

          {/* bio + currently typewriter, calendar alongside */}
          <div className="min-h-0 flex items-start justify-between" style={{ gap: "clamp(3rem, 6vw, 5rem)" }}>
            <div className="min-w-0" style={{ maxWidth: "36rem" }}>
              <div className="text-secondary">{bio}</div>
              <div style={{ marginTop: "2rem" }}>
                <ErrorBoundary fallback={<p className="font-sans text-gray text-lg">couldn&apos;t load this section.</p>}>
                  <Currently />
                </ErrorBoundary>
              </div>
            </div>
            <div className="hidden xl:flex justify-center shrink-0">
              <ErrorBoundary
                fallback={<p className="font-sans text-gray text-lg">couldn&apos;t load the activity calendar.</p>}
              >
                <ActivityCalendar />
              </ErrorBoundary>
            </div>
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
