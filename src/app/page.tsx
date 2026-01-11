import Hero from "@/components/Hero";
import Experience from "@/components/Experience";
import GitHubActivity from "@/components/GitHubActivity";
import Currently from "@/components/Currently";
import Contact from "@/components/Contact";
import StravaCalendar from "@/components/StravaCalendar";

export default function Home() {
  return (
    <main style={{ maxWidth: '1344px', margin: '0 auto', paddingTop: '10%', paddingBottom: '10%', paddingLeft: '5%', paddingRight: '5%' }}>
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
        <div className="flex flex-col md:flex-row justify-between gap-12">
          {/* left side - github activity */}
          <div className="w-full md:w-2/3">
            <GitHubActivity />
          </div>

          {/* right side - strava calendar */}
          <div className="w-full md:w-1/3 flex justify-center">
            <StravaCalendar />
          </div>
        </div>
      </section>
    </main>
  );
}
