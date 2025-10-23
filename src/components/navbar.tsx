'use client';

import { useState, useEffect } from 'react';

export default function Navbar() {
  const [activeSection, setActiveSection] = useState('home');
  const [showNameInNav, setShowNameInNav] = useState(false);

  const sections = [
    { id: 'home', label: 'home' },
    { id: 'research', label: 'research' },
    { id: 'experience', label: 'experience' },
    { id: 'teaching', label: 'teaching' },
    { id: 'projects', label: 'projects' },
    { id: 'other', label: 'other' },
  ];

  // Smooth scroll to section
  const scrollToSection = (sectionId: string) => {
    const element = document.getElementById(sectionId);
    if (element) {
      element.scrollIntoView({ 
        behavior: 'smooth',
        block: 'start'
      });
    }
  };

  // Track which section is in view and whether to show name in navbar
  useEffect(() => {
    const handleScroll = () => {
      const scrollY = window.scrollY;
      
      // Find which section we're currently in
      let currentSection = 'home';
      
      for (const section of sections) {
        const element = document.getElementById(section.id);
        if (element) {
          const rect = element.getBoundingClientRect();
          const elementTop = scrollY + rect.top;
          
          // If we've scrolled past this section's start (with some offset), it's active
          if (scrollY >= elementTop - 100) {
            currentSection = section.id;
          }
        }
      }
      
      if (activeSection !== currentSection) {
        setActiveSection(currentSection);
      }

      // Check if main name is off screen (behind the navbar)
      const mainNameElement = document.getElementById('main-name');
      if (mainNameElement) {
        const rect = mainNameElement.getBoundingClientRect();
        // Show navbar name when the bottom of the main name goes above the navbar (80px)
        setShowNameInNav(rect.bottom < 80);
      }
    };

    // Run once on mount
    handleScroll();

    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, [activeSection, sections]);

  return (
    <>
      {/* Header bar background */}
      <div className="fixed top-0 left-0 right-0 h-20 bg-[#f4f2ee] z-40 border-b-4 border-[#9c9fc1]"></div>
      
      {/* Name in navbar - appears when scrolled */}
      <div 
        className={`fixed top-0 left-[15vw] h-20 z-50 font-helvetica flex items-center transition-opacity duration-300 ${
          showNameInNav ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      >
        <h1 className="text-4xl">
          <span 
            className="text-[#303030]"
            style={{
              textShadow: '2px 2px 0px rgba(0, 0, 0, 0.4)'
            }}
          >
            andrew
          </span>{' '}
          <span 
            className="text-[#9c9fc1]"
            style={{
              textShadow: '2px 2px 0px rgba(0, 0, 0, 0.4)'
            }}
          >
            zhou
          </span>
        </h1>
      </div>
      
      {/* Navigation */}
      <nav className="fixed top-0 right-[15vw] h-20 z-50 font-helvetica text-xl flex items-center">
        <ul className="flex items-center">
          {sections.map((section, index) => (
            <li key={section.id} className="flex items-center">
              <button
                onClick={() => scrollToSection(section.id)}
                className={`relative transition-all duration-300 ${
                  activeSection === section.id
                    ? 'text-[#9c9fc1] font-bold'
                    : 'text-[#303030] font-normal'
                } hover:text-[#9c9fc1]`}
                style={{
                  // Reserve space for bold text to prevent layout shift
                  display: 'inline-block',
                }}
              >
                {/* Hidden bold text to reserve space */}
                <span 
                  aria-hidden="true" 
                  className="font-bold invisible block h-0 overflow-hidden"
                >
                  {section.label}
                </span>
                {/* Actual visible text */}
                <span>{section.label}</span>
              </button>
              {index < sections.length - 1 && (
                <span className="text-[#303030]" style={{ margin: '0 16px' }}>/</span>
              )}
            </li>
          ))}
        </ul>
      </nav>
    </>
  );
}

