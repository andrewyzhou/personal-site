import type { Metadata } from "next";
import * as content from "@/content";
import { ROLE_GROUPS } from "@/content/kinds";
import { pageTitle } from "@/content/site";
import Frame from "@/components/site/Frame";
import ItemContent from "@/components/mdx/ItemContent";

const site = content.site();

export const metadata: Metadata = {
  title: pageTitle(site, site.sections.work.label),
  description: site.sections.work.intro || undefined,
};

// every role once, grouped: the group's name on the left, its roles as
// cards on the right, each with its full text (the home page shows these
// one at a time).
export default function WorkPage() {
  const roles = content.allRoles();
  const groups = ROLE_GROUPS.map((g) => ({ id: g, roles: roles.filter((r) => r.group === g) })).filter((g) => g.roles.length > 0);

  return (
    <Frame
      section="work"
      title={site.sections.work.label}
      intro={site.sections.work.intro}
      aside={
        <nav className="flex flex-wrap gap-2 md:justify-end">
          {groups.map((g) => (
            <a key={g.id} href={`#${g.id}`} className="link-highlight">
              {site.sectionPages.groups[g.id]}
            </a>
          ))}
        </nav>
      }
    >
      {groups.map((g, i) => (
        <div key={g.id}>
          {i > 0 && <div className="section-divider" />}
          <section id={g.id} className="py-8" style={{ scrollMarginTop: "2rem" }}>
            <div className="flex flex-col md:flex-row gap-6 md:gap-12">
              <div className="w-full md:w-1/4">
                <h2 className="font-sans font-bold text-off-white text-3xl md:sticky" style={{ top: "2rem" }}>
                  {site.sectionPages.groups[g.id]}
                </h2>
              </div>
              <div className="w-full md:w-3/4 flex flex-col gap-4">
                {g.roles.map((r) => (
                  <article key={r.slug} className="card-bg rounded-lg" style={{ padding: "1rem", paddingLeft: "1.25rem" }}>
                    <div className="flex justify-between" style={{ marginBottom: "0.5rem" }}>
                      <div>
                        <h3 className="font-sans text-off-white text-lg font-bold">{r.title}</h3>
                        {r.companyUrl ? (
                          <a href={r.companyUrl} target="_blank" rel="noopener noreferrer" className="font-sans text-secondary text-lg link-highlight inline-block">
                            {r.company}
                          </a>
                        ) : (
                          <p className="font-sans text-secondary text-lg">{r.company}</p>
                        )}
                      </div>
                      <div className="text-right shrink-0" style={{ marginLeft: "1rem" }}>
                        <span className="font-sans font-semibold text-gray text-lg">{r.period || r.year}</span>
                        {r.location && <span className="font-sans text-gray text-lg block">{r.location}</span>}
                      </div>
                    </div>
                    <div className="font-sans text-gray text-lg leading-[1.35]">
                      <ItemContent category={r.group} slug={r.slug} />
                    </div>
                  </article>
                ))}
              </div>
            </div>
          </section>
        </div>
      ))}
    </Frame>
  );
}
