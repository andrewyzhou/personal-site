import Link from "next/link";
import Image from "next/image";
import * as content from "@/content";
import Currently from "@/components/Currently";
import ErrorBoundary from "@/components/ErrorBoundary";
import Bio from "@/components/mdx/Bio";
import ActivityFigure from "@/components/figure/ActivityFigure";
import type { HomeData } from "./data";
import "./rtf.css";

// the home page as a plain document: one narrow column of text in a serif
// face, nothing but bold, italic and underline, one small picture. the
// year's figure is the only thing wider than the column.
export default function HomeB({ data }: { data: HomeData }) {
  const site = content.site();
  return (
    <main className="rtf">
      <div className="rtf-col">
        <header className="rtf-head">
          <Image src={site.hero.headshot.src} alt={site.hero.headshot.alt} width={56} height={90} className="rtf-photo" priority />
          <div>
            <p>
              <strong>{site.site.name}</strong>
            </p>
            <p className="rtf-muted">{site.hero.affiliation.join(" ")}</p>
            <nav className="rtf-nav">
              {content.sections().map((s) => (
                <Link key={s.id} href={content.urls.section(s.id)}>
                  {site.sections[s.id].label}
                </Link>
              ))}
            </nav>
          </div>
        </header>

        <section>
          <Bio />
        </section>

        <section>
          <ErrorBoundary fallback={<p>{site.home.errors.currently}</p>}>
            <Currently />
          </ErrorBoundary>
        </section>
      </div>

      <div className="rtf-wide">
        <ErrorBoundary fallback={<p>{site.home.errors.calendar}</p>}>
          <ActivityFigure marks={data.marks} />
        </ErrorBoundary>
      </div>

      <div className="rtf-col">
        {data.latest && (
          <section>
            <h3>{site.sectionPages.latest}</h3>
            <p>
              <Link href={data.latest.href}>
                <strong>{data.latest.title}</strong>
              </Link>
              <span className="rtf-muted">{`, ${data.latest.dateLabel}`}</span>
            </p>
            <p>{data.latest.summary}</p>
          </section>
        )}

        {data.recent.length > 0 && (
          <section>
            <h3>{site.sectionPages.recent}</h3>
            <ul className="rtf-list">
              {data.recent.map((r) => (
                <li key={`${r.title}:${r.dateLabel}`}>
                  {r.href ? <Link href={r.href}>{r.title}</Link> : r.title}
                  <span className="rtf-muted">{`, ${r.dateLabel}`}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section>
          <h3>{site.contact.heading}</h3>
          <p>{site.contact.body}</p>
          <p>
            <em>{site.contact.email}</em>
          </p>
        </section>

        <footer className="rtf-muted rtf-foot">
          <p>{site.site.footer}</p>
        </footer>
      </div>
    </main>
  );
}
