import Hero from "@/components/Hero";
import Experience from "@/components/Experience";
import GitHubActivity from "@/components/GitHubActivity";
import Currently from "@/components/Currently";
import Contact from "@/components/Contact";
import StravaCalendar from "@/components/StravaCalendar";

export default function Home() {
  return (
    <main style={{ maxWidth: '1344px', margin: '0 auto', paddingTop: '2.5%', paddingBottom: '2.5%', paddingLeft: '5%', paddingRight: '5%' }}>
      {/* section 1: hero */}
      <Hero />
      <div className="section-divider" />

      {/* section 2: experience/work/research/teaching/projects */}
      <Experience />
      <div className="section-divider" />

      {/* section 3: currently + contact */}
      <section className="py-16">
        <div className="flex flex-col md:flex-row justify-between gap-12">
          {/* left side - currently */}
          <div className="w-full md:w-1/2">
            <Currently />
          </div>

          {/* right side - contact */}
          <div className="w-full md:w-1/2">
            <Contact />
          </div>
        </div>
      </section>
      <div className="section-divider" />

      {/* section 4: github activity + strava calendar */}
      <section className="py-16">
        {/* heading - visible on mobile only, above everything */}
        <h3 className="font-sans font-bold text-off-white text-3xl md:hidden" style={{ marginBottom: '1rem' }}>
          activity
        </h3>

        <div className="flex flex-col md:flex-row justify-between gap-8 md:gap-12">
          {/* strava calendar - shows first on mobile, right on desktop */}
          <div className="w-full md:w-2/5 flex justify-center md:items-center order-first md:order-last">
            <StravaCalendar />
          </div>

          {/* github activity - shows second on mobile, left on desktop */}
          <div className="w-full md:w-3/5 order-last md:order-first">
            <GitHubActivity showHeading={true} mobileHeading={false} />
          </div>
        </div>
      </section>
      <div className="section-divider" />

      {/* footer */}
      <footer className="py-8 text-center">
        <p className="font-sans text-gray text-sm">© andrew zhou 2025-2026</p>
      </footer>
    </main>
  );
}
