import type { NextConfig } from "next";
import createMDX from "@next/mdx";

const nextConfig: NextConfig = {
  pageExtensions: ["ts", "tsx", "md", "mdx"],
  images: {
    // photo-essay images served from r2 via the custom domain
    remotePatterns: [{ protocol: "https", hostname: "cdn.andrewzhou.org" }],
  },
};

const withMDX = createMDX({
  options: {
    // turbopack requires string references for remark plugins so loader options are serializable
    remarkPlugins: [["remark-frontmatter", { type: "yaml", marker: "-" }]],
  },
});

export default withMDX(nextConfig);
