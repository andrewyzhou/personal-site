"use client";

import Image from "next/image";
import Link from "next/link";
import { useTheme } from "@/context/ThemeContext";

interface SocialLink {
  name: string;
  url: string;
  icon?: string;
  isText?: boolean;
  internal?: boolean;
}

const socialLinks: SocialLink[] = [
  { name: "github", url: "https://github.com/andrewyzhou", icon: "/icons/github.svg" },
  { name: "linkedin", url: "https://linkedin.com/in/andrewyzhou", icon: "/icons/linkedin.svg" },
  { name: "x", url: "https://x.com/andrewyzhou", icon: "/icons/x.svg" },
  { name: "strava", url: "https://www.strava.com/athletes/161887324", icon: "/icons/strava.svg" },
  { name: "spotify", url: "https://open.spotify.com/user/andrewfanbois", icon: "/icons/spotify.svg" },
  { name: "resume", url: "/resume.pdf", isText: true },
  { name: "cv", url: "/cv.pdf", isText: true },
];

export default function SocialLinks() {
  const { theme, cycleTheme } = useTheme();

  return (
    <div className="flex items-center gap-2" style={{ marginTop: '1.5rem' }}>
      {socialLinks.map((link) => {
        const content = link.icon ? (
          <Image
            src={link.icon}
            alt={link.name}
            width={24}
            height={24}
            className="opacity-60 hover:opacity-100 transition-opacity"
          />
        ) : (
          link.name
        );
        const className = link.isText ? "font-sans text-gray text-lg link-highlight" : "";

        return link.internal ? (
          <Link key={link.name} href={link.url} className={className} title={link.name}>
            {content}
          </Link>
        ) : (
          <a
            key={link.name}
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            className={className}
            title={link.name}
          >
            {content}
          </a>
        );
      })}
      <button
        onClick={cycleTheme}
        title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
      >
        <Image
          src={theme === "dark" ? "/icons/moon.svg" : "/icons/sun.svg"}
          alt={`${theme} mode`}
          width={24}
          height={24}
          className="opacity-60 hover:opacity-100 transition-opacity"
        />
      </button>
    </div>
  );
}
