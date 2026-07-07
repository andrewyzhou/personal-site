"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import type { ExperienceItem } from "@/lib/items";
import { courseHasDetail, semesterShortLabel, type Course, type Semester } from "@/lib/content";
import SortControl from "@/components/SortControl";

type Category = "bio" | "work" | "research" | "teaching" | "projects" | "library" | "blog" | "photos" | "coursework";

const categories: { id: Category; label: string }[] = [
  { id: "bio", label: "bio" },
  { id: "work", label: "work" },
  { id: "research", label: "research" },
  { id: "teaching", label: "teaching" },
  { id: "projects", label: "projects" },
  { id: "library", label: "library" },
  { id: "blog", label: "blog" },
  { id: "photos", label: "photos" },
  { id: "coursework", label: "coursework" },
];


export interface LibraryPreviewItem {
  slug: string;
  title: string;
  creator: string;
  type: string;
  summary: string;
  dateLabel: string;
  year: string;
}

export interface BlogPreviewItem {
  slug: string;
  title: string;
  summary: string;
  dateLabel: string;
  year: string;
}

export interface PhotosetPreviewItem {
  slug: string;
  title: string;
  caption: string;
  dateLabel: string;
  year: string;
  count: number;
}

interface ExperienceProps {
  libraryPreview?: LibraryPreviewItem[];
  blogPreview?: BlogPreviewItem[];
  photosPreview?: PhotosetPreviewItem[];
  sectionDescriptions: Record<Exclude<Category, "bio">, string>;
  semesters: Semester[];
  bio: React.ReactNode;
  workItems: ExperienceItem[];
  researchItems: ExperienceItem[];
  teachingItems: ExperienceItem[];
  projectsItems: ExperienceItem[];
}

export default function Experience({
  libraryPreview = [],
  blogPreview = [],
  photosPreview = [],
  sectionDescriptions,
  semesters,
  bio,
  workItems,
  researchItems,
  teachingItems,
  projectsItems,
}: ExperienceProps) {
  const [activeCategory, setActiveCategory] = useState<Category>("bio");
  const [selectedItem, setSelectedItem] = useState<ExperienceItem | null>(null);
  const [contentKey, setContentKey] = useState(0);
  // coursework detail view (ws6): sort mode + expanded course
  const [courseworkSort, setCourseworkSort] = useState<"semester" | "az">("semester");
  const [selectedCourseId, setSelectedCourseId] = useState<string | null>(null);

  const libraryItems: ExperienceItem[] = libraryPreview.map((e) => ({
    id: e.slug,
    title: e.title,
    company: e.creator,
    year: e.year,
    period: e.dateLabel,
    description: (
      <div className="flex flex-col gap-2">
        <p>{e.summary}</p>
        <Link
          href={`/library/${e.slug}`}
          className="font-sans text-gray hover:text-off-white transition-colors inline-block w-fit"
        >
          read full notes →
        </Link>
      </div>
    ),
  }));

  const blogItems: ExperienceItem[] = blogPreview.map((e) => ({
    id: e.slug,
    title: e.title,
    company: e.dateLabel,
    year: e.year,
    description: (
      <div className="flex flex-col gap-2">
        <p>{e.summary}</p>
        <Link
          href={`/blog/${e.slug}`}
          className="font-sans text-gray hover:text-off-white transition-colors inline-block w-fit"
        >
          read post →
        </Link>
      </div>
    ),
  }));

  const photosItems: ExperienceItem[] = photosPreview.map((e) => ({
    id: e.slug,
    title: e.title,
    company: e.dateLabel,
    year: e.year,
    description: (
      <div className="flex flex-col gap-2">
        <p>{e.caption}</p>
        <p className="font-sans text-gray text-sm italic">{e.count} photo{e.count === 1 ? "" : "s"}</p>
        <Link
          href={`/photos/${e.slug}`}
          className="font-sans text-gray hover:text-off-white transition-colors inline-block w-fit"
        >
          view set →
        </Link>
      </div>
    ),
  }));

  // read hash on mount and set category
  useEffect(() => {
    const hash = window.location.hash.slice(1) as Category;
    if (categories.some(c => c.id === hash)) {
      setActiveCategory(hash);
    }
  }, []);

  // update hash when category changes
  const handleCategoryChange = (category: Category) => {
    if (category === activeCategory) return;
    const wasBio = activeCategory === "bio";
    const goingToBio = category === "bio";
    setActiveCategory(category);
    window.history.replaceState(null, "", category === "bio" ? window.location.pathname : `#${category}`);
    // trigger enter animation only for bio transitions
    if (wasBio || goingToBio) {
      setContentKey(prev => prev + 1);
    }
  };

  // detail body shared by the a–z list panel and the below-grid card
  const courseDetail = (course: Course) => (
    <div className="flex flex-col gap-2">
      {course.review && <p className="font-sans text-secondary text-lg italic">{course.review}</p>}
      {course.experience &&
        course.experience.split(/\n\s*\n/).map((para, i) => (
          <p key={i} className="font-sans text-gray text-lg leading-[1.35]">
            {para}
          </p>
        ))}
      {((course.cheatsheets?.length ?? 0) > 0 || (course.links?.length ?? 0) > 0) && (
        <p className="font-sans text-gray text-lg">
          {[...(course.cheatsheets ?? []), ...(course.links ?? [])].map((l, i, all) => (
            <span key={`${l.label}-${i}`}>
              <a href={l.url} target="_blank" rel="noopener noreferrer" className="link-highlight">
                {l.label}
              </a>
              {i < all.length - 1 && ", "}
            </span>
          ))}
        </p>
      )}
    </div>
  );

  // a–z view maps courses onto the same list/detail template the other tabs use
  const courseworkItems: ExperienceItem[] = semesters
    .flatMap((sem) =>
      sem.courses.map((course) => ({
        id: `${sem.name}:${course.code}`,
        title: course.code,
        company: course.title,
        year: semesterShortLabel(sem.name),
        description: courseHasDetail(course) ? (
          courseDetail(course)
        ) : (
          <p className="font-sans text-gray text-lg italic">no writeup for this one (yet)</p>
        ),
      }))
    )
    .sort((a, b) => a.title.localeCompare(b.title, undefined, { numeric: true }));

  const getItemsData = (): ExperienceItem[] => {
    switch (activeCategory) {
      case "work":
        return workItems;
      case "research":
        return researchItems;
      case "teaching":
        return teachingItems;
      case "projects":
        return projectsItems;
      case "library":
        return libraryItems;
      case "blog":
        return blogItems;
      case "photos":
        return photosItems;
      case "coursework":
        return courseworkSort === "az" ? courseworkItems : [];
      default:
        return [];
    }
  };

  const items = getItemsData();

  // reset selected item when category or coursework sort changes
  useEffect(() => {
    if (items.length > 0) {
      setSelectedItem(items[0]);
    }
    setSelectedCourseId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCategory, courseworkSort]);

  const categoryTabs = (
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
  );

  return (
    <section className="py-16">
      <div key={contentKey} className="animate-content-enter">
      {activeCategory === "bio" ? (
        <div className="flex flex-col md:flex-row gap-8 md:gap-12">
          {/* left side - bio text */}
          <div className="w-full md:w-3/5">
            <h3 className="font-sans font-bold text-off-white text-3xl" style={{ marginBottom: '1rem' }}>
              about me
            </h3>
            <div>{bio}</div>
          </div>

          {/* right side - category tabs */}
          <div className="w-full md:w-2/5 flex flex-col items-start md:items-end">
            {categoryTabs}
          </div>
        </div>
      ) : (
        <>
        {/* category tabs */}
        {categoryTabs}

      {/* category content */}
      <div style={{ marginTop: '0.5rem' }}>
        {/* blurb is optional per tab — sections.yaml may leave it empty (e.g. blog) */}
        {sectionDescriptions[activeCategory] && (
          <>
            <p className="font-sans text-gray text-lg leading-[1.35] mb-8">
              {sectionDescriptions[activeCategory]}
            </p>
            <br />
          </>
        )}
        {activeCategory === "coursework" && (
          <SortControl
            options={[
              { id: "semester", label: "by semester" },
              { id: "az", label: "a–z" },
            ]}
            value={courseworkSort}
            onChange={(v) => setCourseworkSort(v as "semester" | "az")}
          />
        )}
        {activeCategory === "coursework" && courseworkSort === "semester" ? (
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
                    {semester.courses.map((course) => {
                      const courseId = `${semester.name}:${course.code}`;
                      const inner = (
                        <>
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
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    {cs.label}
                                  </a>
                                  {idx < course.cheatsheets!.length - 1 && ", "}
                                </span>
                              ))})
                            </span>
                          )}
                        </>
                      );
                      return (
                        <li key={course.code} className="font-sans text-gray text-lg">
                          {courseHasDetail(course) ? (
                            <button
                              onClick={() =>
                                setSelectedCourseId(selectedCourseId === courseId ? null : courseId)
                              }
                              className={`w-full text-left rounded transition-all duration-200 ${
                                selectedCourseId === courseId ? "card-bg" : "card-bg-hover"
                              }`}
                              style={{ padding: '0.1rem 0.5rem', margin: '-0.1rem -0.5rem' }}
                            >
                              {inner}
                            </button>
                          ) : (
                            inner
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
            {selectedCourseId &&
              (() => {
                const [semName, code] = selectedCourseId.split(":");
                const course = semesters
                  .find((s) => s.name === semName)
                  ?.courses.find((c) => c.code === code);
                if (!course) return null;
                return (
                  <div className="card-bg rounded-lg" style={{ padding: '1rem', paddingLeft: '1.25rem', marginTop: '1.5rem' }}>
                    <div className="flex justify-between" style={{ marginBottom: '0.5rem' }}>
                      <div>
                        <p className="font-sans text-off-white text-lg font-bold">{course.code}</p>
                        <p className="font-sans text-secondary text-lg">{course.title}</p>
                      </div>
                      <span className="font-sans font-semibold text-gray text-lg text-right shrink-0" style={{ marginLeft: '1rem' }}>
                        {semName}
                      </span>
                    </div>
                    {courseDetail(course)}
                  </div>
                );
              })()}
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
        {activeCategory === "library" && (
          <div style={{ marginTop: '1.5rem' }}>
            <Link
              href="/library"
              className="font-sans text-gray hover:text-off-white transition-colors text-lg"
            >
              see all library →
            </Link>
          </div>
        )}
        {activeCategory === "blog" && (
          <div style={{ marginTop: '1.5rem' }}>
            <Link
              href="/blog"
              className="font-sans text-gray hover:text-off-white transition-colors text-lg"
            >
              see all posts →
            </Link>
          </div>
        )}
        {activeCategory === "photos" && (
          <div style={{ marginTop: '1.5rem' }}>
            <Link
              href="/photos"
              className="font-sans text-gray hover:text-off-white transition-colors text-lg"
            >
              see all photos →
            </Link>
          </div>
        )}
        </div>
        </>
      )}
      </div>
    </section>
  );
}
