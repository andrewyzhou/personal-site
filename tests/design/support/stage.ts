import fs from "node:fs";
import path from "node:path";
import type { Page, Route } from "@playwright/test";

// everything a page could do differently between two runs is pinned here:
// the clock, Math.random, every /api response, and every external request.

const API_DIR = path.join(__dirname, "..", "fixtures", "api");

// the moment every fixture page is rendered at (a wednesday afternoon in
// berkeley, the day after the newest fixture activity)
export const FIXED_NOW = new Date("2026-11-04T22:00:00.000Z");

function fixture(name: string): string {
  return fs.readFileSync(path.join(API_DIR, `${name}.json`), "utf8");
}

// map an /api path to its fixture file. anything unmapped answers 404 so a new
// client fetch shows up as a visible difference instead of hitting prod.
function apiFixture(pathname: string): string | null {
  const p = pathname.replace(/^\/api\//, "");
  if (p.startsWith("engagement/")) return '{"data":{}}';
  if (p.startsWith("engagement")) return fixture("engagement");
  const known: Record<string, string> = {
    spotify: "spotify",
    literal: "literal",
    github: "github",
    "github/leetcode": "github_leetcode",
    activities: "activities",
    "activities/latest": "activities_latest",
    stats: "stats",
  };
  return known[p] ? fixture(known[p]) : null;
}

// 1x1 mid-gray png: stands in for every external image (album art, covers)
const GRAY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGNoAAAAggCBd81ytgAAAABJRU5ErkJggg==",
  "base64",
);

export async function stage(page: Page): Promise<void> {
  await page.clock.install({ time: FIXED_NOW });

  // seeded prng (mulberry32) so quote rotation and any shuffles repeat exactly
  await page.addInitScript(() => {
    let a = 0x2f6b9d1;
    Math.random = () => {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  });

  await page.route("**/*", async (route: Route) => {
    const url = new URL(route.request().url());
    const local = url.hostname === "127.0.0.1" || url.hostname === "localhost";
    if (local && url.pathname.startsWith("/api/")) {
      const body = apiFixture(url.pathname);
      return body === null
        ? route.fulfill({ status: 404, contentType: "application/json", body: '{"error":"no fixture"}' })
        : route.fulfill({ status: 200, contentType: "application/json", body });
    }
    if (local) return route.continue();
    if (route.request().resourceType() === "image") {
      return route.fulfill({ status: 200, contentType: "image/png", body: GRAY_PNG });
    }
    // map tiles, analytics, fonts from elsewhere: nothing external renders
    return route.abort();
  });
}

// let timers (typing effects, rotating icons, fetch-then-render) run to the
// same state every time. the fake clock advances in small steps with a real
// pause after each, so promise chains and mocked fetches started by one timer
// finish before the next one fires; one big jump would race them.
export async function settle(page: Page, opts: { theme?: "dark" | "light" } = {}): Promise<void> {
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => document.fonts.ready);
  for (let i = 0; i < 90; i++) {
    await page.clock.runFor(500);
    await page.waitForTimeout(15);
  }
  // the theme class is applied after hydration; never shoot the wrong theme
  if (opts.theme) {
    const want = `theme-${opts.theme}`;
    const has = () => page.evaluate((c) => document.documentElement.classList.contains(c), want);
    for (let i = 0; i < 200 && !(await has()); i++) {
      await page.clock.runFor(100);
      await page.waitForTimeout(75);
    }
    if (!(await has())) throw new Error(`page never applied ${want} (hydration stalled?)`);
    // let the swap's 0.15s color transitions finish on the fake clock
    await page.clock.runFor(1_000);
    await page.waitForTimeout(50);
  }
  await page.waitForLoadState("networkidle");
}
