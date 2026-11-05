import { expect, test } from "@playwright/test";
import { settle, stage } from "./support/stage";

// v1 is the site as it looked when the design system work began. every route
// here is rendered from fixtures and compared pixel-for-pixel against the
// committed baseline. a diff means a change leaked into v1: fix the change,
// don't update the baseline (only the coordinator does that, deliberately).

export const V1_ROUTES = [
  { name: "home", path: "/" },
  { name: "blog", path: "/blog" },
  { name: "blog-post", path: "/blog/hello-world" },
  { name: "library", path: "/library" },
  { name: "library-entry", path: "/library/foundation" },
  { name: "photos", path: "/photos" },
  { name: "not-found", path: "/this-page-does-not-exist" },
] as const;

const VIEWPORTS = [
  { name: "1440", width: 1440, height: 900 },
  { name: "390", width: 390, height: 844 },
] as const;

const THEMES = ["dark", "light"] as const;

for (const route of V1_ROUTES) {
  for (const vp of VIEWPORTS) {
    for (const theme of THEMES) {
      test(`v1 ${route.name} ${vp.name} ${theme}`, async ({ page }) => {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
        await stage(page);
        await page.goto(route.path);
        await settle(page, { theme });
        await expect(page).toHaveScreenshot(`v1/${route.name}-${vp.name}-${theme}.png`, {
          fullPage: true,
          // two home elements rotate on intervals forever (hero quote, the
          // calendar's yearly stat); their phase at capture time isn't stable,
          // so their boxes are masked. everything else is compared exactly.
          mask: [
            page.locator("p.whitespace-pre-line.italic"),
            page.locator('div.justify-between:has(> span.text-sm img[src*="/icons/activities/"])'),
          ],
        });
      });
    }
  }
}
