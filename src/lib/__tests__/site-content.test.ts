import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import { describe, expect, it } from "vitest";
import { validateSite } from "@/content/site";
import { fill, fillParts, pageTitle, plural, type SiteContent } from "@/content/site-types";
import { formatDay } from "@/content/format";

const load = (p: string) => yaml.load(fs.readFileSync(p, "utf8"));

describe("content/site.yaml", () => {
  it("is valid", () => {
    expect(validateSite(load("content/site.yaml"))).toEqual([]);
  });

  it("design fixture copy satisfies the same schema", () => {
    // the fixture is frozen on purpose (copy edits mustn't break the v1 lock),
    // but a schema change has to be carried into it
    expect(validateSite(load("tests/design/fixtures/content/site.yaml"))).toEqual([]);
  });

  it("reports missing and mistyped keys", () => {
    const site = load("content/site.yaml") as Record<string, Record<string, unknown>>;
    const broken = { ...site, contact: { ...site.contact, heading: 3 }, social: [{ name: "x" }] };
    delete (broken as Record<string, unknown>).github;
    const errors = validateSite(broken);
    expect(errors).toContain("contact.heading must be a string");
    expect(errors).toContain("github.heading must be a string");
    expect(errors).toContain("social[0] needs name and url");
  });

  it("references only icons that exist", () => {
    const site = load("content/site.yaml") as SiteContent;
    for (const s of site.social) if (s.icon) expect(fs.existsSync(path.join("public", s.icon)), s.icon).toBe(true);
    expect(fs.existsSync(path.join("public", site.hero.headshot.src))).toBe(true);
  });
});

describe("copy helpers", () => {
  it("fills templates and leaves unknown slots", () => {
    expect(fill("{theme} mode", { theme: "dark" })).toBe("dark mode");
    expect(fill("{a} and {b}", { a: 1 })).toBe("1 and {b}");
  });

  it("splits templates into the text runs jsx would produce", () => {
    expect(fillParts("deployed on {date} for commit {sha}", { date: "nov 4", sha: "abc" })).toEqual([
      "deployed on ",
      "nov 4",
      " for commit ",
      "abc",
    ]);
    expect(fillParts("{a}", { a: "x" })).toEqual(["x"]);
    expect(fillParts("no slots", {})).toEqual(["no slots"]);
  });

  it("pluralizes and builds page titles", () => {
    expect(plural(1, { one: "photo", other: "photos" })).toBe("photo");
    expect(plural(0, { one: "photo", other: "photos" })).toBe("photos");
    const site = load("content/site.yaml") as SiteContent;
    expect(pageTitle(site, "hello", "blog")).toBe("hello · blog · andrew zhou");
  });

  it("formats days the way the site always has", () => {
    expect(formatDay("2026-05-31")).toBe("may 31, 2026");
    expect(formatDay(undefined)).toBe("");
  });
});
