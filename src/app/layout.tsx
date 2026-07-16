import type { Metadata } from "next";
import { EB_Garamond, Funnel_Sans } from "next/font/google";
import { ThemeProvider } from "@/context/ThemeContext";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";

const funnelSans = Funnel_Sans({
  subsets: ["latin"],
  variable: "--font-funnel",
  display: "swap",
});

// bold serif for the golden-logo letterforms
const ebGaramond = EB_Garamond({
  subsets: ["latin"],
  weight: "700",
  variable: "--font-garamond",
  display: "swap",
});

export const metadata: Metadata = {
  title: "andrew zhou",
  description: "electrical engineering & computer science @ uc berkeley",
  icons: {
    icon: [
      { url: "/images/favicon.png", sizes: "48x48", type: "image/png" },
      { url: "/images/logo.svg", type: "image/svg+xml" },
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
        <Analytics />
      </body>
    </html>
  );
}
