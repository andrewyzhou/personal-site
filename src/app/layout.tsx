import type { Metadata } from "next";
import { EB_Garamond, Funnel_Sans } from "next/font/google";
import { ThemeProvider } from "@/context/ThemeContext";
import { Analytics } from "@vercel/analytics/next";
import CursorHalo from "@/components/CursorHalo";
import "./globals.css";

const funnelSans = Funnel_Sans({
  subsets: ["latin"],
  variable: "--font-funnel",
  display: "swap",
});

// serif for the golden-logo letterforms — variable font, 400-800 range
const ebGaramond = EB_Garamond({
  subsets: ["latin"],
  variable: "--font-garamond",
  display: "swap",
});

export const metadata: Metadata = {
  title: "andrew zhou",
  description: "electrical engineering & computer science @ uc berkeley",
  icons: {
    icon: [
      { url: "/images/az-favicon.png", sizes: "512x512", type: "image/png" },
      { url: "/images/az-logo.svg", type: "image/svg+xml" },
    ],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${funnelSans.variable} ${ebGaramond.variable} theme-dark`}>
      <body className="antialiased">
        <ThemeProvider>
          {children}
        </ThemeProvider>
        <CursorHalo />
        <Analytics />
      </body>
    </html>
  );
}
