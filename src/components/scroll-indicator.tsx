'use client';

import { useState, useEffect } from 'react';

export default function ScrollIndicator() {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const handleScroll = () => {
      // Hide when scrolled more than 100px from top
      setVisible(window.scrollY < 100);
    };

    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  return (
    <div 
      className={`fixed bottom-24 left-1/2 -translate-x-1/2 z-40 transition-opacity duration-500 ${
        visible ? 'opacity-100' : 'opacity-0 pointer-events-none'
      }`}
    >
      {/* Downward arrow made from 3 lines forming a chevron */}
      <div className="animate-bounce-slow">
        <svg width="60" height="60" viewBox="0 0 60 60" fill="none" xmlns="http://www.w3.org/2000/svg">
          {/* Left line of chevron */}
          <line 
            x1="15" 
            y1="20" 
            x2="30" 
            y2="35" 
            stroke="#9c9fc1" 
            strokeWidth="4" 
            strokeLinecap="round"
          />
          {/* Right line of chevron */}
          <line 
            x1="30" 
            y1="35" 
            x2="45" 
            y2="20" 
            stroke="#9c9fc1" 
            strokeWidth="4" 
            strokeLinecap="round"
          />
          {/* Second chevron below */}
          <line 
            x1="15" 
            y1="30" 
            x2="30" 
            y2="45" 
            stroke="#9c9fc1" 
            strokeWidth="4" 
            strokeLinecap="round"
          />
          <line 
            x1="30" 
            y1="45" 
            x2="45" 
            y2="30" 
            stroke="#9c9fc1" 
            strokeWidth="4" 
            strokeLinecap="round"
          />
        </svg>
      </div>
    </div>
  );
}

