"use client";

import Image from "next/image";
import { useTheme } from "@/context/ThemeContext";

interface SocialLink {
  name: string;
  url: string;
  icon?: string;
  isText?: boolean;
}

const socialLinks: SocialLink[] = [
  { name: "github", url: "https://github.com/andrewyzhou", icon: "/icons/github.svg" },
  { name: "linkedin", url: "https://linkedin.com/in/andrewyzhou", icon: "/icons/linkedin.svg" },
  { name: "x", url: "https://x.com/andrewyzhou", icon: "/icons/x.svg" },
  { name: "instagram", url: "https://instagram.com/andrewyzhou", icon: "/icons/instagram.svg" },
  { name: "strava", url: "https://www.strava.com/athletes/161887324", icon: "/icons/strava.svg" },
  { name: "spotify", url: "https://open.spotify.com/user/andrewfanbois", icon: "/icons/spotify.svg" },
  { name: "resume", url: "/resume.pdf", isText: true },
  { name: "cv", url: "/cv.pdf", isText: true },
];

export default function SocialLinks() {
  const { theme, cycleTheme } = useTheme();

  return (
    <div className="flex items-center gap-2" style={{ marginTop: '1.5rem' }}>
      {socialLinks.map((link) => (
        <a
          key={link.name}
          href={link.url}
          target="_blank"
          rel="noopener noreferrer"
          className={link.isText ? "font-sans text-gray text-lg link-highlight" : ""}
          title={link.name}
        >
          {link.icon ? (
            <Image
              src={link.icon}
              alt={link.name}
              width={24}
              height={24}
              className="opacity-60 hover:opacity-100 transition-opacity"
            />
          ) : (
            link.name
          )}
        </a>
      ))}
      <button
        onClick={cycleTheme}
        className="font-sans text-gray text-lg link-highlight"
        title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
      >
        {theme}
      </button>
    </div>
  );
}
