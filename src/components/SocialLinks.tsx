"use client";

import Image from "next/image";
import { useTheme } from "@/context/ThemeContext";
import { useSite } from "@/content/SiteProvider";
import { fill } from "@/content/site-types";

export default function SocialLinks() {
  const { theme, cycleTheme } = useTheme();
  const site = useSite();

  return (
    <div className="flex items-center gap-2" style={{ marginTop: '1.5rem' }}>
      {site.social.map((link) => {
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
        const className = link.icon ? "" : "font-sans text-gray text-lg link-highlight";

        return (
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
        title={fill(site.theme.switchTo, { theme: theme === "dark" ? "light" : "dark" })}
      >
        <Image
          src={theme === "dark" ? "/icons/moon.svg" : "/icons/sun.svg"}
          alt={fill(site.theme.current, { theme })}
          width={24}
          height={24}
          className="opacity-60 hover:opacity-100 transition-opacity"
        />
      </button>
    </div>
  );
}
