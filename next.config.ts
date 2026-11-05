import type { NextConfig } from "next";
import createMDX from "@next/mdx";
import path from "node:path";

// point @content at the fixture copy (alias targets are relative to the
// project dir). scripts/design-build.mjs passes the turbopack root, which in a
// git worktree with linked node_modules is the main checkout.
function fixtureTurbopack(contentRoot: string) {
  const root = path.resolve(process.env.DESIGN_TURBOPACK_ROOT ?? process.cwd());
  const rel = path.relative(process.cwd(), path.resolve(contentRoot)).split(path.sep).join("/");
  return { root, resolveAlias: { "@content/*": `./${rel}/*` } };
}

const nextConfig: NextConfig = {
  pageExtensions: ["ts", "tsx", "md", "mdx"],
  // the design test harness builds against frozen fixture content (see
  // tests/design/README.md); CONTENT_ROOT is unset everywhere else
  ...(process.env.CONTENT_ROOT ? { turbopack: fixtureTurbopack(process.env.CONTENT_ROOT) } : {}),
  // workspace package shipped as typescript source
  transpilePackages: ["lift-core"],
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
