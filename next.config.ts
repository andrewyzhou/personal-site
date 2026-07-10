import type { NextConfig } from "next";
import createMDX from "@next/mdx";

const nextConfig: NextConfig = {
  pageExtensions: ["ts", "tsx", "md", "mdx"],
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
