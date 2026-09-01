import type { NextConfig } from "next";
import createMDX from "@next/mdx";

const nextConfig: NextConfig = {
  pageExtensions: ["ts", "tsx", "md", "mdx"],
  // cs180 portfolio lives in its own repo (andrewyzhou/cs180) on github pages;
  // proxy it under /cs180 so it shares this domain. next strips trailing
  // slashes before rewrites run, so extensionless page urls must map to their
  // index.html explicitly or github responds with an off-domain 301.
  async rewrites() {
    return [
      {
        source: "/cs180",
        destination: "https://andrewyzhou.github.io/cs180/index.html",
      },
      {
        source: "/cs180/:page([^.]+)",
        destination: "https://andrewyzhou.github.io/cs180/:page/index.html",
      },
      {
        source: "/cs180/:path*",
        destination: "https://andrewyzhou.github.io/cs180/:path*",
      },
    ];
  },
  images: {
    // photo-essay images served from r2 via the custom domain
    remotePatterns: [{ protocol: "https", hostname: "cdn.andrewzhou.org" }],
    // next 16 rejects any quality not listed here (default [75]); the admin
    // calendar requests q=50 for its tiny day-cell thumbnails
    qualities: [50, 75],
  },
};

const withMDX = createMDX({
  options: {
    // turbopack requires string references for remark plugins so loader options are serializable
    remarkPlugins: [["remark-frontmatter", { type: "yaml", marker: "-" }]],
  },
});

export default withMDX(nextConfig);
