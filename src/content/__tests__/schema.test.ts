import { describe, expect, it } from "vitest";
import { anyText, bool, date, list, number, object, oneOf, optional, problems, problemsOf, record, text } from "../schema";

const SHAPE = {
  title: text(),
  date: date(),
  tags: list(text()),
  rating: optional(number({ min: 0, max: 5 })),
  pinned: optional(bool()),
  format: optional(oneOf(["movie", "show"] as const)),
  links: optional(list(object({ label: text(), url: text() }))),
  note: optional(anyText()),
};

describe("content schema", () => {
  it("accepts a valid entry, with or without its optional fields", () => {
    expect(problems(SHAPE, { title: "a", date: "2026-05-31", tags: [] })).toEqual([]);
    expect(problems(SHAPE, { title: "a", date: "2026-05-31", tags: ["x"], rating: 4.5, pinned: true, format: "show", links: [{ label: "l", url: "/u" }], note: "" })).toEqual([]);
  });

  it("allows keys it has no definition for", () => {
    expect(problems(SHAPE, { title: "a", date: "2026-05-31", tags: [], extra: 1 })).toEqual([]);
  });

  it("names every missing required field", () => {
    expect(problems(SHAPE, {})).toEqual(["title: is required", "date: is required", "tags: is required"]);
  });

  it("treats null like a missing field", () => {
    expect(problems(SHAPE, { title: "a", date: "2026-05-31", tags: [], rating: null })).toEqual([]);
    expect(problems(SHAPE, { title: null, date: "2026-05-31", tags: [] })).toEqual(["title: is required"]);
  });

  it("rejects wrong types, empty text and impossible dates, with the path", () => {
    expect(problems(SHAPE, { title: "  ", date: "2026-5-31", tags: "x", rating: 6, pinned: "yes", format: "book" })).toEqual([
      "title: must be text",
      "date: must be a date like 2026-05-31",
      "tags: must be a list",
      "rating: must be at most 5",
      "pinned: must be true or false",
      "format: must be one of movie, show",
    ]);
    expect(problems(SHAPE, { title: "a", date: "2026-13-40", tags: [] })).toEqual(["date: must be a date like 2026-05-31"]);
  });

  it("points into lists and nested objects", () => {
    expect(problems(SHAPE, { title: "a", date: "2026-05-31", tags: ["ok", 3], links: [{ label: "l" }] })).toEqual(["tags[2]: must be text", "links[1].url: is required"]);
  });

  it("checks a whole-file list and a key: value map", () => {
    const quotes = list(object({ text: text(), attribution: text() }));
    expect(problemsOf(quotes, [{ text: "t", attribution: "a" }], "hero-quotes.yaml")).toEqual([]);
    expect(problemsOf(quotes, { text: "t" }, "hero-quotes.yaml")).toEqual(["hero-quotes.yaml: must be a list"]);
    expect(problemsOf(record(anyText()), { a: "x", b: null, c: 2 }, "sections.yaml")).toEqual(["sections.yaml.c: must be text"]);
  });

  it("reports a non-object entry once", () => {
    expect(problems(SHAPE, "nope")).toEqual(["entry: must be a set of fields"]);
  });
});
