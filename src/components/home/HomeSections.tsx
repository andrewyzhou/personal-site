"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { useSite } from "@/content/SiteProvider";

// the home page's second band with four tabs instead of nine: bio, and one
// per section. same parts as before (the highlight tabs, the list on the
// left with its card on the right, the content-enter animation); each
// section tab is a short look that ends in a link to the section's page.

export interface HomeRole {
  id: string;
  group: "work" | "research" | "teaching";
  title: string;
  company: string;
  companyUrl?: string;
  location?: string;
  period?: string;
  year: string;
  description: ReactNode;
}

export interface HomeWritingRow {
  href: string;
  title: string;
  line?: string;
  dateLabel: string;
  // set for notes that come from the library ("reading", "tv, movies")
  kindLabel?: string;
}

export interface HomeShelf {
  href: string;
  label: string;
  count: string;
  updated?: string;
}

type Tab = "bio" | "work" | "writing" | "library";
const TABS: Tab[] = ["bio", "work", "writing", "library"];

export default function HomeSections({ bio, roles, writing, shelves }: { bio: ReactNode; roles: HomeRole[]; writing: HomeWritingRow[]; shelves: HomeShelf[] }) {
  const site = useSite();
  const [tab, setTab] = useState<Tab>("bio");
  const [roleId, setRoleId] = useState<string | null>(roles[0]?.id ?? null);
  const [enterKey, setEnterKey] = useState(0);
  const role = roles.find((r) => r.id === roleId) ?? roles[0];

  // a link to /#work opens that tab
  useEffect(() => {
    const fromHash = () => {
      const h = window.location.hash.slice(1) as Tab;
      if (TABS.includes(h)) setTab(h);
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
  }, []);

  const choose = (t: Tab) => {
    setTab(t);
    setEnterKey((k) => k + 1);
    window.history.replaceState(null, "", t === "bio" ? window.location.pathname : `#${t}`);
  };

  const label = (t: Tab) => (t === "bio" ? site.experience.tabs.bio : site.sections[t].label);
  const tabs = (
    <div className="flex flex-wrap gap-2" role="tablist">
      {TABS.map((t) => (
        <button
          key={t}
          type="button"
          role="tab"
          aria-selected={tab === t}
          onClick={() => choose(t)}
          className={`font-sans text-3xl transition-colors ${tab === t ? "text-off-white font-medium link-highlight-active" : "text-gray link-highlight"}`}
          style={{ padding: "0px 4px 1px 4px", margin: "0 2px" }}
        >
          <span className="inline-flex flex-col items-center">
            <span>{label(t)}</span>
            <span className="font-medium h-0 invisible overflow-hidden">{label(t)}</span>
          </span>
        </button>
      ))}
    </div>
  );

  const more = (href: string) => (
    <div style={{ marginTop: "1.5rem" }}>
      <Link href={href} className="font-sans text-gray hover:text-off-white transition-colors text-lg">
        {`${site.sectionPages.seeAll} →`}
      </Link>
    </div>
  );

  return (
    <section className="py-16">
      <div key={enterKey} className="animate-content-enter">
        {tab === "bio" ? (
          <div className="flex flex-col md:flex-row gap-8 md:gap-12">
            <div className="w-full md:w-3/5">
              <h3 className="font-sans font-bold text-off-white text-3xl" style={{ marginBottom: "1rem" }}>
                {site.home.about}
              </h3>
              <div>{bio}</div>
            </div>
            <div className="w-full md:w-2/5 flex flex-col items-start md:items-end">{tabs}</div>
          </div>
        ) : (
          <>
            {tabs}
            <div style={{ marginTop: "0.5rem" }}>
              {site.sections[tab].intro ? (
                <>
                  <p className="font-sans text-gray text-lg leading-[1.35] mb-8">{site.sections[tab].intro}</p>
                  <br />
                </>
              ) : (
                <div style={{ height: "1.5rem" }} />
              )}

              {tab === "work" && (
                <>
                  <div className="flex flex-col md:flex-row gap-4 md:gap-12 h-full">
                    <div className="w-full md:w-1/2" style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
                      {roles.map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => setRoleId(item.id)}
                          className={`w-full text-left transition-all duration-200 rounded ${role?.id === item.id ? "card-bg" : "card-bg-hover"}`}
                          style={{ paddingTop: "0.1rem", paddingBottom: "0.35rem", paddingLeft: "0.5rem", paddingRight: "0.5rem" }}
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-sans text-off-white text-lg">{item.title}</span>
                            <span className="font-sans font-semibold text-gray text-lg">{item.year}</span>
                          </div>
                          <div className="flex items-center justify-between" style={{ marginTop: "-0.25rem" }}>
                            <span className="font-sans text-gray text-sm">{item.company}</span>
                            <span className="font-sans text-gray text-sm">{item.location ?? site.sectionPages.groups[item.group]}</span>
                          </div>
                        </button>
                      ))}
                    </div>
                    <div className="w-full md:w-1/2">
                      {role && (
                        <div className="card-bg rounded-lg" style={{ padding: "1rem", paddingLeft: "1.25rem" }}>
                          <div className="flex justify-between" style={{ marginBottom: "0.5rem" }}>
                            <div>
                              <p className="font-sans text-off-white text-lg font-bold">{role.title}</p>
                              {role.companyUrl ? (
                                <a href={role.companyUrl} target="_blank" rel="noopener noreferrer" className="font-sans text-secondary text-lg link-highlight inline-block">
                                  {role.company}
                                </a>
                              ) : (
                                <p className="font-sans text-secondary text-lg">{role.company}</p>
                              )}
                            </div>
                            <div className="text-right shrink-0" style={{ marginLeft: "1rem" }}>
                              <span className="font-sans font-semibold text-gray text-lg">{role.period || role.year}</span>
                              {role.location && <span className="font-sans text-gray text-lg block">{role.location}</span>}
                            </div>
                          </div>
                          <div className="font-sans text-gray text-lg leading-[1.35]">{role.description}</div>
                        </div>
                      )}
                    </div>
                  </div>
                  {more("/work")}
                </>
              )}

              {tab === "writing" && (
                <>
                  {writing.length === 0 ? (
                    <p className="font-sans text-gray text-lg italic">{site.sectionPages.empty}</p>
                  ) : (
                    <ul className="flex flex-col" style={{ gap: "0.4rem" }}>
                      {writing.map((w) => (
                        <li key={w.href}>
                          <Link href={w.href} className="block rounded card-bg-hover" style={{ padding: "0.1rem 0.5rem 0.35rem" }}>
                            <div className="flex items-center justify-between gap-4">
                              <span className="font-sans text-off-white text-lg">
                                {w.title}
                                {w.kindLabel && <span className="font-sans text-gray text-sm" style={{ marginLeft: "0.6rem" }}>{w.kindLabel}</span>}
                              </span>
                              <span className="font-sans font-semibold text-gray text-lg shrink-0">{w.dateLabel}</span>
                            </div>
                            {w.line && <span className="font-sans text-gray text-sm block" style={{ marginTop: "-0.25rem" }}>{w.line}</span>}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                  {more("/writing")}
                </>
              )}

              {tab === "library" && (
                <ul className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 md:gap-4">
                  {shelves.map((s) => (
                    <li key={s.href}>
                      <Link href={s.href} className="card-bg card-bg-hover rounded-lg flex flex-col items-center justify-center text-center transition-colors" style={{ aspectRatio: "1 / 1", padding: "1rem" }}>
                        <span className="font-sans font-bold text-off-white text-2xl" style={{ letterSpacing: "-0.01em" }}>
                          {s.label}
                        </span>
                        <span className="font-sans text-gray text-sm" style={{ marginTop: "0.5rem" }}>
                          {s.count}
                        </span>
                        {s.updated && <span className="font-sans text-gray text-sm">{s.updated}</span>}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
