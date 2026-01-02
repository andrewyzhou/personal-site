"use client";

import { useState } from "react";
import Image from "next/image";
import SocialLinks from "./SocialLinks";

export default function Hero() {
  const [showLogo, setShowLogo] = useState(false);

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
        <div className="text-right">
          <p className="font-sans font-semibold text-off-white text-lg leading-[1.35]">
            electrical engineering &amp; computer science
          </p>
          <p className="font-sans font-semibold text-off-white text-lg leading-[1.35]" style={{ marginBottom: '0.5rem' }}>
            @ uc berkeley
          </p>
          <p className="font-sans italic text-gray text-lg leading-[1.35] max-w-md">
            &ldquo;there&apos;s a lot of beauty in ordinary things.
            <br />
            isn&apos;t that kind of the point?&rdquo; - pam halpert
          </p>
        </div>
      </div>
    </section>
  );
}
