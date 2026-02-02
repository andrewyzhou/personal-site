"use client";

import { useState, useEffect, useRef } from "react";
import Image from "next/image";
import SocialLinks from "./SocialLinks";

const QUOTES = [
  `"there's a lot of beauty in ordinary things.\nisn't that kind of the point?" - pam halpert`,
  `"you miss 100% of the shots you \ndon't take. - wayne gretzky"\n- michael scott`,
  `"how would i describe myself? three words.\nhard-working, alpha male. jackhammer. merciless.\ninsatiable." - dwight schrute`,
];

const TYPING_SPEED = 35;

function getNextQuoteIndex(current: number): number {
  return (current + 1) % QUOTES.length;
}

export default function Hero() {
  const [showLogo, setShowLogo] = useState(false);
  const [initialIndex] = useState(() => Math.floor(Math.random() * QUOTES.length));
  const [displayedQuote, setDisplayedQuote] = useState("");
  const [isTypingActive, setIsTypingActive] = useState(false);
  const [showCursor, setShowCursor] = useState(false);
  const quoteIndexRef = useRef(0);
  const animatingRef = useRef(false);
  const displayedQuoteRef = useRef("");
  const cursorTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Set random quote on client mount to avoid hydration mismatch
  useEffect(() => {
    quoteIndexRef.current = initialIndex;
    displayedQuoteRef.current = QUOTES[initialIndex];
    setDisplayedQuote(QUOTES[initialIndex]);
  }, [initialIndex]);

  // keep ref in sync with state
  useEffect(() => {
    displayedQuoteRef.current = displayedQuote;
  }, [displayedQuote]);

  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout>;
    let interval: ReturnType<typeof setInterval>;

    const animateQuoteChange = () => {
      if (animatingRef.current) return;
      animatingRef.current = true;

      const nextIndex = getNextQuoteIndex(quoteIndexRef.current);
      quoteIndexRef.current = nextIndex;
      const newText = QUOTES[nextIndex];
      const oldText = displayedQuoteRef.current;

      if (cursorTimeoutRef.current) clearTimeout(cursorTimeoutRef.current);
      setShowCursor(true);
      setIsTypingActive(true);
      let deleteIndex = oldText.length;

      const deleteChar = () => {
        if (deleteIndex > 0) {
          deleteIndex--;
          const sliced = oldText.slice(0, deleteIndex);
          displayedQuoteRef.current = sliced;
          setDisplayedQuote(sliced);
          setTimeout(deleteChar, TYPING_SPEED);
        } else {
          setTimeout(() => {
            let typeIndex = 0;
            const typeChar = () => {
              if (typeIndex < newText.length) {
                typeIndex++;
                const sliced = newText.slice(0, typeIndex);
                displayedQuoteRef.current = sliced;
                setDisplayedQuote(sliced);
                setTimeout(typeChar, TYPING_SPEED);
              } else {
                setIsTypingActive(false);
                animatingRef.current = false;
                cursorTimeoutRef.current = setTimeout(() => setShowCursor(false), 2000);
              }
            };
            typeChar();
          }, 500);
        }
      };
      deleteChar();
    };

    const handleTypingComplete = () => {
      // first switch 30s after Currently typing finishes
      timeout = setTimeout(() => {
        animateQuoteChange();

        // then every 30s after that
        interval = setInterval(() => {
          animateQuoteChange();
        }, 30000);
      }, 30000);
    };

    window.addEventListener("currently-typing-complete", handleTypingComplete);
    return () => {
      window.removeEventListener("currently-typing-complete", handleTypingComplete);
      clearTimeout(timeout);
      clearInterval(interval);
    };
  }, []);

  return (
    <section className="py-16">
      <div className="w-full flex flex-col md:flex-row justify-between items-center gap-8">
        {/* left side - headshot, name, and social links */}
        <div>
          <div className="flex items-center gap-6">
            {/* headshot / logo */}
            <div
              className={`w-[112px] h-[150px] flex-shrink-0 cursor-pointer ${
                showLogo ? "" : "headshot-border bg-off-white p-1"
              }`}
              onClick={() => setShowLogo(!showLogo)}
            >
              <div className={`relative w-full h-full overflow-hidden ${showLogo ? "" : "headshot-image-container"}`}>
                <Image
                  src={showLogo ? "/images/logo.svg" : "/images/headshot.png"}
                  alt="Andrew Zhou"
                  fill
                  className={showLogo ? "object-contain" : "object-cover object-top"}
                  priority
                />
              </div>
            </div>

            {/* name - left aligned with tighter letter spacing */}
            <div className="text-left">
              <p
                className="font-sans font-bold text-off-white text-6xl md:text-7xl"
                style={{ letterSpacing: '-0.02em' }}
              >
                hi, i&apos;m
              </p>
              <p
                className="font-sans font-bold text-off-white text-6xl md:text-7xl"
                style={{ letterSpacing: '-0.02em' }}
              >
                andrew
              </p>
            </div>
          </div>

          {/* social links */}
          <SocialLinks />
        </div>

        {/* right side - info */}
        <div className="text-center md:text-right">
          <p className="font-sans font-semibold text-off-white text-lg leading-[1.35]">
            electrical engineering &amp; computer science
          </p>
          <p className="font-sans font-semibold text-off-white text-lg leading-[1.35]" style={{ marginBottom: '0.5rem' }}>
            @ uc berkeley
          </p>
          <p className="font-sans italic text-gray text-lg leading-[1.35] max-w-md whitespace-pre-line">
            {displayedQuote}
            {showCursor && (
              <span
                className={`inline-block w-[2px] h-[1.1em] bg-gray align-middle ml-[1px] ${isTypingActive ? '' : 'animate-cursor-blink'}`}
              />
            )}
          </p>
        </div>
      </div>
    </section>
  );
}
