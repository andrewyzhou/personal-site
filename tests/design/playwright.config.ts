import { defineConfig } from "@playwright/test";

// design harness: renders the site built against frozen fixture content
// (tests/design/fixtures) and locks v1's pixels. see tests/design/README.md.
//
// locally this drives the installed chrome (no browser download); ci uses
// playwright's bundled chromium. baselines are per-platform; only the linux
// set is committed, because that's what ci compares against.

const PORT = Number(process.env.DESIGN_PORT ?? 3100);
const CI = !!process.env.CI;

export default defineConfig({
  testDir: ".",
  testMatch: /.*\.spec\.ts$/,
  outputDir: process.env.DESIGN_OUTPUT_DIR ?? "./.output",
  snapshotPathTemplate: `${process.env.DESIGN_SNAPSHOT_DIR ?? "{testDir}/__screenshots__"}/{platform}/{arg}{ext}`,
  fullyParallel: true,
  workers: 2,
  retries: 0,
  timeout: 90_000,
  reporter: CI ? [["list"], ["html", { open: "never", outputFolder: "./.report" }]] : "list",
  expect: {
    toHaveScreenshot: { maxDiffPixels: 0, animations: "disabled", caret: "hide", scale: "css" },
  },
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    channel: CI ? undefined : "chrome",
    locale: "en-US",
    timezoneId: "America/Los_Angeles",
    deviceScaleFactor: 1,
  },
  webServer: process.env.DESIGN_NO_SERVER
    ? undefined
    : {
        // the build must already exist: `npm run build:design`
        command: `npx next start -p ${PORT}`,
        cwd: "../..",
        url: `http://127.0.0.1:${PORT}/`,
        reuseExistingServer: !CI,
        timeout: 120_000,
        env: { CONTENT_ROOT: "tests/design/fixtures/content", DESIGN_FIXTURES: "1" },
      },
});
