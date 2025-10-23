'use client';

import Image from "next/image";
import { useState } from "react";
import ExperienceItem from "@/components/experience-item";
import Navbar from "@/components/navbar";
import ScrollIndicator from "@/components/scroll-indicator";

export default function Home() {
  const [showNotice, setShowNotice] = useState(true);

  return (
    <div className="min-h-screen">
      <Navbar />
      <ScrollIndicator />
      
      {/* Construction Notice */}
      <div 
        className={`fixed bottom-4 left-4 z-50 bg-[#f4f2ee] border-4 border-[#c19c9c] rounded-2xl transition-all duration-300 ease-in-out ${
          showNotice ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4 pointer-events-none'
        }`}
        style={{ padding: '16px 48px 16px 24px', maxWidth: '240px' }}
      >
        <div className="text-sm font-helvetica text-gray-800 leading-relaxed">
          <div>
            <span className="font-bold text-[#c19c9c]">notice:</span> website is best viewed on mobile as site design (and contents) are still under construction<span className="animate-dots"></span>
          </div>
        </div>
        
        {/* Close button */}
        <button
          onClick={() => setShowNotice(false)}
          className="absolute top-3 right-3 w-6 h-6 flex items-center justify-center text-[#c19c9c] hover:text-[#a07c7c] transition-all duration-200 hover:scale-110 hover:rotate-90 group"
          aria-label="Close notice"
        >
          <svg
            className="w-5 h-5 transition-transform duration-200"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            strokeWidth="2.5"
            strokeLinecap="round"
          >
            <path d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
      
      {/* Desktop: positioned layout | Mobile: stacked flow layout */}
      <div className="md:relative scroll-mt-20" id="home">
        
        {/* Header Section - stacks naturally on mobile, positioned on desktop */}
        <div className="flex flex-col items-center pt-8 px-8 md:p-0">
          
          {/* Intro text */}
          <p className="text-xl font-helvetica text-center md:text-left md:absolute md:left-[15vw] md:top-[14vh] text-gray-800">
            hi, i&apos;m...
          </p>

          {/* Name */}
          <h1 
            id="main-name"
            className="text-7xl md:text-8xl font-helvetica text-center md:text-left md:absolute md:left-[15vw] md:top-[20vh]"
          >
            <span 
              className="text-[#303030]"
              style={{
                textShadow: '3px 3px 0px rgba(0, 0, 0, 0.4)'
              }}
            >
              andrew
            </span>{' '}
            <span 
              className="text-[#9c9fc1]"
              style={{
                textShadow: '3px 3px 0px rgba(0, 0, 0, 0.4)'
              }}
            >
              zhou
            </span>
          </h1>

          {/* Headshot */}
          <div 
            className="relative w-48 h-48 mt-8 md:w-[20vw] md:h-[20vw] md:mt-0 md:absolute md:right-[15vw] md:top-[8vw] rounded-full border-4 border-[#9c9fc1]"
          >
            <Image
              src="/images/headshot.png"
              alt="Andrew Zhou headshot"
              fill
              className="object-cover rounded-full"
              priority
            />
          </div>

          {/* Contact and Links - centered below headshot */}
          <div className="mt-8 flex flex-col items-center md:absolute md:right-[15vw] md:top-[calc(8vw+20vw+1.5vw)] md:w-[20vw]">
            {/* Email */}
            <p className="text-lg font-helvetica text-gray-800 text-center mb-3">
              andrewzhou [at] berkeley [dot] edu
            </p>
            
            {/* Academic Links */}
            <div className="flex justify-center gap-x-2 font-helvetica text-lg mb-1">
              <a 
                href="https://github.com/andrewyzhou" 
                target="_blank" 
                rel="noopener noreferrer"
                className="text-[#9c9fc1] hover:underline"
              >
                github
              </a>
              <span className="text-gray-800">/</span>
              <a 
                href="/docs/cv.pdf" 
                target="_blank" 
                rel="noopener noreferrer"
                className="text-[#9c9fc1] hover:underline"
              >
                CV
              </a>
              <span className="text-gray-800">/</span>
              <a 
                href="https://scholar.google.com/citations?user=CNboCcMAAAAJ" 
                target="_blank" 
                rel="noopener noreferrer"
                className="text-[#9c9fc1] hover:underline"
              >
                google scholar
              </a>
            </div>

            {/* Professional Links */}
            <div className="flex justify-center gap-x-2 font-helvetica text-lg">
              <a 
                href="/docs/resume.pdf" 
                target="_blank" 
                rel="noopener noreferrer"
                className="text-[#9c9fc1] hover:underline"
              >
                resume
              </a>
              <span className="text-gray-800">/</span>
              <a 
                href="https://www.linkedin.com/in/andrewyzhou/" 
                target="_blank" 
                rel="noopener noreferrer"
                className="text-[#9c9fc1] hover:underline"
              >
                linkedin
              </a>
            </div>
          </div>
        </div>

        {/* Bio Section - flows after header on mobile, positioned on desktop */}
        <div className="mt-12 px-8 relative md:absolute md:left-[17vw] md:right-[5vw] md:top-[35vh] md:max-w-[45vw] md:right-auto">
          {/* Vertical line and content wrapper */}
          <div className="relative flex gap-6">
            {/* Vertical line */}
            <div className="w-1 bg-[#9c9fc1] flex-shrink-0 absolute left-[-2vw] md:left-[-2vw] top-0 bottom-0 rounded-full"></div>
            
            {/* Bio content */}
            <div className="text-xl text-gray-800 font-helvetica">
              <p style={{ marginBottom: '12px' }}>
                i&apos;m an undergraduate at berkeley studying electrical engineering and computer science. my interests include machine learning, computer vision, AI-driven biology, and teaching.
              </p>

              <div style={{ marginBottom: '12px' }}>
                <p className="mb-2">currently, i&apos;m:</p>
                <ul className="list-disc list-outside space-y-1 pl-1" style={{ marginLeft: '1.5rem' }}>
                  <li>teaching berkeley bears as a part of <a href="https://cs61a.org/staff/" target="_blank" rel="noopener noreferrer" className="text-[#9c9fc1] hover:underline">cs61a staff</a></li>
                  <li>training to run the berkeley half marathon!</li>
                  <li>working on this website {'>:)'}</li>
                </ul>
              </div>

              <div style={{ marginBottom: '12px' }}>
                <p className="mb-2">previously, i was:</p>
                <ul className="list-disc list-outside space-y-1 pl-1" style={{ marginLeft: '1.5rem' }}>
                  <li>conducting machine learning research at the <a href="https://med.stanford.edu/guolanlulab.html" target="_blank" rel="noopener noreferrer" className="text-[#9c9fc1] hover:underline">guolan lu lab</a></li>
                </ul>
              </div>

              <p>
              in my free time, i make electronic music, lift weights, play guitar, go to concerts, run, hike, backpack, and play soccer and tennis.
              </p>
            </div>
          </div>
        </div>

        {/* Spacer for absolute positioned header/bio */}
        <div className="hidden md:block md:h-[100vh] md:w-0"></div>

        {/* Research Section */}
        <div id="research" className="mt-16 px-8 relative md:mt-0 pb-32 scroll-mt-16 md:scroll-mt-20" style={{ paddingLeft: '15vw', paddingRight: '15vw' }}>
          <h2 className="text-5xl md:text-[80px] font-helvetica text-[#303030] text-center md:text-left">
            research
          </h2>

          {/* Research Items */}
          <div className="md:ml-[2vw]" style={{ paddingTop: '20px' }}>
            <ExperienceItem
              title="machine learning research intern"
              subtitle="stanford university • may 2025 - aug 2025"
              bullets={[
                "built modular 3D analysis pipeline adopted as lab's primary workflow for imaging datasets",
                "trained 4D diffusion-transformer model for multi-channel super-resolution and 3D reconstruction",
                "proposed swin-4D hybrid attention transformer for 5× faster training vs. baseline ViT"
              ]}
              mediaType="image"
              mediaSrc="/images/stanford_medicine_logo.png"
              mediaCaption=""
            />
          </div>
        </div>

        {/* Experience Section */}
        <div id="experience" className="px-8 relative pb-32 scroll-mt-16 md:scroll-mt-20" style={{ paddingLeft: '15vw', paddingRight: '15vw', marginTop: '4rem' }}>
          <h2 className="text-5xl md:text-[80px] font-helvetica text-[#303030] text-center md:text-left">
            experience
          </h2>

          {/* Experience Items */}
          <div className="md:ml-[2vw]" style={{ paddingTop: '20px' }}>
            <ExperienceItem
              title="software engineer"
              subtitle="iPick.ai • sept 2024 - present"
              bullets={[
                "built full-stack portfolio analysis dashboard with multi-RAG agent stock-screening ensemble",
                "implemented agents using LangChain + GPT-4o + FinBERT embeddings with FAISS vector database",
                "accelerated response times by 10× through Redis caching and request optimization"
              ]}
              mediaType="image"
              mediaSrc="/images/ipick_logo.png"
              mediaCaption=""
            />

            <ExperienceItem
              title="game development intern"
              subtitle="claythis • june 2025 - aug 2025"
              bullets={[
                "led integration of 3-intern team's systems and established modular project architecture",
                "engineered modular NPC systems: AI navigation, behavior FSMs, health, and combat controllers",
                "delivered full video game in 7 weeks for fundraising showcase"
              ]}
              mediaType="image"
              mediaSrc="/images/claythis_logo.png"
              mediaCaption=""
            />
          </div>
        </div>

        {/* Teaching Section */}
        <div id="teaching" className="px-8 relative pb-32 scroll-mt-16 md:scroll-mt-20" style={{ paddingLeft: '15vw', paddingRight: '15vw', marginTop: '4rem' }}>
          <h2 className="text-5xl md:text-[80px] font-helvetica text-[#303030] text-center md:text-left">
            teaching
          </h2>

          {/* Teaching Items */}
          <div className="md:ml-[2vw]" style={{ paddingTop: '20px' }}>
            <ExperienceItem
              title="cs61a: tutor (cs scholars)"
              subtitle="uc berkeley • aug 2025 - present"
              bullets={[
                "co-teaching the <a href='https://eecs.berkeley.edu/cs-scholars/' target='_blank' rel='noopener noreferrer' class='text-[#9c9fc1] hover:underline'>cs scholars</a> discussion and lab",
                "leading 2 weekly small group tutoring sections for 5-8 students each",
                "supporting cs scholars students through weekly personal tutoring sections"
              ]}
              mediaType="image"
              mediaSrc="/images/cs61a_shirt.png"
              mediaCaption=""
            />
          </div>
        </div>

        {/* Projects Section */}
        <div id="projects" className="px-8 relative pb-32 scroll-mt-16 md:scroll-mt-20" style={{ paddingLeft: '15vw', paddingRight: '15vw', marginTop: '4rem' }}>
          <h2 className="text-5xl md:text-[80px] font-helvetica text-[#303030] text-center md:text-left">
            projects
          </h2>

          {/* Projects Items */}
          <div style={{ paddingTop: '20px' }}>
            <ExperienceItem
              title="waveposer: real-time pose-to-audio synthesis"
              subtitle="react, next.js, node.js, tailwind, web audio API • 2025"
              bullets={[
                "built real-time CV app converting human pose into waveforms using MediaPipe",
                "developed Tone.js effects pipeline with gain, distortion, EQ, and reverb controls",
                "architected modular React+Zustand system with reusable hooks"
              ]}
              mediaType="image"
              mediaSrc="/images/placeholder_kitten_1.jpg"
              mediaCaption="<s>live demo of pose-to-audio synthesis</s> placeholder_kitten_1"
            />

            <ExperienceItem
              title="secure distributed file system"
              subtitle="golang, C • 2025"
              bullets={[
                "built secure file-sharing backend with user authentication and access revocation",
                "designed stateless, concurrency-safe API for multi-device sessions",
                "authored 40+ test suites covering tampering and edge cases"
              ]}
              mediaType="image"
              mediaSrc="/images/placeholder_kitten_2.webp"
              mediaCaption="<s>distributed file system architecture diagram</s> placeholder_kitten_2"
            />

            <ExperienceItem
              title="procedurally generated adventure game"
              subtitle="java, data structures & algorithms • 2024"
              bullets={[
                "used disjoint-set data structure for procedural level generation with reproducible seeds",
                "designed graph search algorithms for NPC pathfinding and item spawning",
                "implemented ray casting for 3D first-person view"
              ]}
              mediaType="image"
              mediaSrc="/images/placeholder_kitten_3.avif"
              mediaCaption="<s>gameplay with procedural generation</s> placeholder_kitten_3"
            />
          </div>
        </div>

        {/* Other Section */}
        <div id="other" className="px-8 relative scroll-mt-16 md:scroll-mt-20" style={{ paddingLeft: '15vw', paddingRight: '15vw', marginTop: '4rem' }}>
          <h2 className="text-5xl md:text-[80px] font-helvetica text-[#303030] text-center md:text-left">
            other
          </h2>

          {/* Other Items */}
          <div className="md:ml-[2vw]" style={{ paddingTop: '20px' }}>
            <ExperienceItem
              title="coursework"
              subtitle="uc berkeley & hs concurrent enrollment"
              bullets={[
                "cs 170: efficient algorithms & intractable problems",
                "cs 161: computer security",
                "eecs 127: optimization models in engineering",
                "cs 61a: structure & interpretation of computer programs",
                "cs 61b: data structures",
                "cs 61c: computer architecture",
                "eecs 16a: signals & systems",
                "eecs 16b: circuits & devices",
                "cs 70: discrete math & probability",
                "multivariable calculus",
                "linear algebra"
              ]}
              mediaType="image"
              mediaSrc="/images/eecs_logo.png"
              mediaCaption=""
            />

            <ExperienceItem
              title="side quests"
              subtitle="high school adventures"
              bullets={[
                "science olympiad: captained the 2024 (go <a href='https://mvso.club/' target='_blank' rel='noopener noreferrer' class='text-[#9c9fc1] hover:underline'>MVSO</a>!), 2020, and 2019 science olympiad national championship teams",
                "research: 1st place at 2023 <a href='https://science-fair.org/' target='_blank' rel='noopener noreferrer' class='text-[#9c9fc1] hover:underline'>synopsys championship</a>",
                "olympiads: usajmo qualifier, usaco gold",
                "clubs: artificial intellgence (president), data science club (president), science olympiad (president), chess, research"
              ]}
              mediaType="image"
              mediaSrc="/images/scioly.jpeg"
              mediaCaption="2024 science olympiad nationals"
            />
          </div>
        </div>
      </div>
      
      {/* Footer */}
      <footer className="w-full text-center" style={{ marginTop: '64px', paddingBottom: '16px' }}>
        <p className="text-sm font-helvetica text-gray-600">
          © 2025 andrew zhou
        </p>
      </footer>
    </div>
  );
}
