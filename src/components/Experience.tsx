"use client";

import { useState, useEffect } from "react";
import { workData, ExperienceItem } from "@/data/work";
import { researchData } from "@/data/research";
import { teachingData } from "@/data/teaching";
import { projectsData } from "@/data/projects";

type Category = "work" | "research" | "teaching" | "projects" | "coursework";

const categories: { id: Category; label: string }[] = [
  { id: "work", label: "work" },
  { id: "research", label: "research" },
  { id: "teaching", label: "teaching" },
  { id: "projects", label: "projects" },
  { id: "coursework", label: "coursework" },
];

const categoryDescriptions: Record<Category, string> = {
  work: "building products and shipping code >:)",
  research: "exploring machine learning with interests in distributed training, computer vision, and computational biology!",
  teaching: "helping berkeley bears learn computer science :p",
  projects: "things i've built for fun and learning :D",
  coursework: "classes i've taken at berkeley with links to my notes & cheatsheets :)",
};

interface Cheatsheet {
  label: string;
  url: string;
}

interface Course {
  code: string;
  title: string;
  cheatsheets?: Cheatsheet[];
}

interface Semester {
  name: string;
  courses: Course[];
}

const semesters: Semester[] = [
  {
    name: "spring 2026",
    courses: [
      { code: "cs 162", title: "operating systems and system programming" },
      { code: "cs 186", title: "introduction to database systems" },
      { code: "cs 189", title: "introduction to machine learning" },
      { code: "cs 197", title: "field study (cs 61a tutor)" },
      { code: "eecs 126", title: "probability and random processes" },
    ],
  },
  {
    name: "fall 2025",
    courses: [
      { code: "cs 161", title: "computer security", cheatsheets: [
        { label: "mt", url: "/docs/cs161_mt_cheatsheet.pdf" },
        { label: "final", url: "/docs/cs161_final_cheatsheet.pdf" },
      ]},
      { code: "cs 170", title: "efficient algorithms and intractable problems", cheatsheets: [
        { label: "mt1", url: "/docs/cs170_mt1_cheatsheet.pdf" },
        { label: "final", url: "/docs/cs170_final_cheatsheet.pdf" },
      ]},
      { code: "cs 195", title: "social implications of computer technology" },
      { code: "cs 197", title: "field study (cs 61a tutor)" },
      { code: "eecs 127", title: "optimization models in engineering" },
    ],
  },
  {
    name: "summer 2025",
    courses: [
      { code: "physics 7b", title: "physics for scientists and engineers*" },
      { code: "english r1b", title: "reading and composition*" },
    ],
  },
  {
    name: "spring 2025",
    courses: [
      { code: "cs 61c", title: "great ideas of computer architecture" },
      { code: "cs 70", title: "discrete mathematics and probability theory", cheatsheets: [
        { label: "final", url: "/docs/cs70_final_cheatsheet.pdf" },
      ]},
      { code: "eecs 16b", title: "designing information devices and systems ii", cheatsheets: [
        { label: "mt1", url: "/docs/eecs16b_mt1_cheatsheet.pdf" },
        { label: "mt2", url: "/docs/eecs16b_mt2_cheatsheet.pdf" },
        { label: "final", url: "/docs/eecs16b_final_cheatsheet.pdf" },
      ]},
    ],
  },
  {
    name: "fall 2024",
    courses: [
      { code: "cs 61a", title: "structure and interpretation of computer programs" },
      { code: "cs 61b", title: "data structures" },
      { code: "eecs 16a", title: "designing information devices and systems i", cheatsheets: [
        { label: "mt1", url: "/docs/eecs16a_mt1_cheatsheet.pdf" },
        { label: "mt2", url: "/docs/eecs16a_mt2_cheatsheet.pdf" },
      ]},
      { code: "philos 5", title: "science and human understanding" },
    ],
  },
  {
    name: "high school concurrent enrollment",
    courses: [
      { code: "math 54", title: "linear algebra & differential equations*" },
      { code: "math 53", title: "multivariable calculus*" },
    ],
  },
];

export default function Experience() {
  const [activeCategory, setActiveCategory] = useState<Category>("work");
  const [selectedItem, setSelectedItem] = useState<ExperienceItem | null>(null);

  // read hash on mount and set category
  useEffect(() => {
    const hash = window.location.hash.slice(1) as Category;
    if (categories.some(c => c.id === hash)) {
      setActiveCategory(hash);
    }
  }, []);

  // update hash when category changes
  const handleCategoryChange = (category: Category) => {
    setActiveCategory(category);
    window.history.replaceState(null, "", `#${category}`);
  };

  const getItemsData = (): ExperienceItem[] => {
    switch (activeCategory) {
      case "work":
        return workData;
      case "research":
        return researchData;
      case "teaching":
        return teachingData;
      case "projects":
        return projectsData;
      default:
        return [];
    }
  };

  const items = getItemsData();

  // reset selected item when category changes
  useEffect(() => {
    if (items.length > 0) {
      setSelectedItem(items[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCategory]);

  return (
    <section className="py-16">
      {/* category tabs */}
      <div className="flex flex-wrap gap-2">
        {categories.map((cat) => (
          <button
            key={cat.id}
            onClick={() => handleCategoryChange(cat.id)}
            className={`font-sans text-3xl transition-colors ${
              activeCategory === cat.id
                ? "text-off-white font-medium link-highlight-active"
                : "text-gray link-highlight"
            }`}
            style={{ padding: '0px 4px 1px 4px', margin: '0 2px' }}
          >
            <span className="inline-flex flex-col items-center">
              <span>{cat.label}</span>
              <span className="font-medium h-0 invisible overflow-hidden">{cat.label}</span>
            </span>
          </button>
        ))}
      </div>

      {/* category content */}
      <div style={{ marginTop: '0.5rem' }}>
        <p className="font-sans text-gray text-lg leading-[1.35] mb-8">
          {categoryDescriptions[activeCategory]}
        </p>
        <br />
        {activeCategory === "coursework" ? (
          /* coursework uses a 2x2 grid layout */
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {semesters.map((semester) => (
                <div
                  key={semester.name}
                  className="card-bg rounded-lg"
                  style={{ padding: '1rem', paddingLeft: '1.25rem' }}
                >
                  <h3 className="font-sans text-off-white text-lg font-bold mb-4">
                    {semester.name}
                  </h3>
                  <ul className="space-y-2">
                    {semester.courses.map((course) => (
                      <li key={course.code} className="font-sans text-gray text-lg">
                        <span className="text-off-white">{course.code}</span>: {course.title}
                        {course.cheatsheets && course.cheatsheets.length > 0 && (
                          <span>
                            {" "}({course.cheatsheets.map((cs, idx) => (
                              <span key={cs.label}>
                                <a
                                  href={cs.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="link-highlight"
                                >
                                  {cs.label}
                                </a>
                                {idx < course.cheatsheets!.length - 1 && ", "}
                              </span>
                            ))})
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
            <p className="font-sans text-gray text-lg" style={{ marginTop: '2rem' }}>
              * accredited courses taken outside of uc berkeley
            </p>
          </>
        ) : (
          /* other categories use the two-column list/detail layout */
          <div className="flex flex-col md:flex-row gap-4 md:gap-12 h-full">
            {/* left side - item list */}
            <div className="w-full md:w-1/2" style={{ marginLeft: '0rem', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
              {items.map((item) => (
                <button
                  key={item.id}
                  onClick={() => setSelectedItem(item)}
                  className={`w-full text-left transition-all duration-200 rounded ${
                    selectedItem?.id === item.id
                      ? "card-bg"
                      : "card-bg-hover"
                  }`}
                  style={{ paddingTop: '0.1rem', paddingBottom: '0.35rem', paddingLeft: '0.5rem', paddingRight: '0.5rem' }}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-sans text-off-white text-lg">
                      {item.title}
                    </span>
                    <span className="font-sans font-semibold text-gray text-lg">
                      {item.year}
                    </span>
                  </div>
                  <div className="flex items-center justify-between" style={{ marginTop: '-0.25rem' }}>
                    <span className="font-sans text-gray text-sm">
                      {item.company}
                    </span>
                    {item.location && (
                      <span className="font-sans text-gray text-sm">
                        {item.location}
                      </span>
                    )}
                  </div>
                </button>
              ))}
            </div>

            {/* right side - item details */}
            <div className="w-full md:w-1/2">
              {selectedItem && (
                <div className="card-bg rounded-lg" style={{ padding: '1rem', paddingLeft: '1.25rem' }}>
                  <div className="flex justify-between" style={{ marginBottom: '0.5rem' }}>
                    <div>
                      <p className="font-sans text-off-white text-lg font-bold">
                        {selectedItem.title}
                      </p>
                      {selectedItem.companyUrl ? (
                        <a
                          href={selectedItem.companyUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-sans text-secondary text-lg link-highlight inline-block"
                        >
                          {selectedItem.company}
                        </a>
                      ) : (
                        <p
                          className={`font-sans text-secondary text-lg${activeCategory === "projects" ? " italic" : ""}`}
                        >
                          {selectedItem.company}
                        </p>
                      )}
                    </div>
                    <div className="text-right shrink-0" style={{ marginLeft: '1rem' }}>
                      <span className="font-sans font-semibold text-gray text-lg">
                        {selectedItem.period || selectedItem.year}
                      </span>
                      {selectedItem.location && (
                        <span className="font-sans text-gray text-lg block">
                          {selectedItem.location}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="font-sans text-gray text-lg leading-[1.35]">
                    {selectedItem.description}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
        </div>
    </section>
  );
}
