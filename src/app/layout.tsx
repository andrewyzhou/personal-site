import type { Metadata } from "next";
import { Funnel_Sans } from "next/font/google";
import { ThemeProvider } from "@/context/ThemeContext";
import "./globals.css";

const funnelSans = Funnel_Sans({
  subsets: ["latin"],
  variable: "--font-funnel",
  display: "swap",
});

export const metadata: Metadata = {
  title: "andrew zhou",
  description: "electrical engineering & computer science @ uc berkeley",
  icons: {
    icon: "/images/logo.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${funnelSans.variable} theme-dark`}>
      <body className="antialiased">
        <ThemeProvider>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
