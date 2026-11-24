import { expect, it } from "vitest";
import { createSearchMatcher } from "../src/index.js";

it("ignores case, surrounding whitespace and composed or decomposed Slovak accents", () => {
  expect(createSearchMatcher("  MACKA  ")(["Mačka domáca"])).toBe(true);
  expect(createSearchMatcher("ŽILINA")(["Z\u030cilina"])).toBe(true);
  expect(createSearchMatcher("   ")([])).toBe(true);
  expect(createSearchMatcher("cat")([undefined, ""])).toBe(false);
});

it("matches partial text and all words in any order across fields", () => {
  const fields = ["Jan Herich", "jan.herich@gmail.com", "Bratislava"];
  expect(createSearchMatcher("erich@gm")(fields)).toBe(true);
  expect(createSearchMatcher("bratis herich")(fields)).toBe(true);
  expect(createSearchMatcher("herich kosice")(fields)).toBe(false);
});

it.each(["hericb", "heriich", "herch", "hercih", "jan.hercih@gmaill.com"])(
  "tolerates insertion, deletion, replacement and swapped letters: %s",
  (query) => {
    expect(createSearchMatcher(query)(["jan.herich@gmail.com"])).toBe(true);
  },
);

it("keeps short terms literal and limits longer terms to two edits", () => {
  expect(createSearchMatcher("jhn")(["john"])).toBe(false);
  expect(createSearchMatcher("abc")(["a-b-c"])).toBe(false);
  expect(createSearchMatcher("abcdefgh")(["abxdxfgh"])).toBe(true);
  expect(createSearchMatcher("abcdefgh")(["abxdxfyh"])).toBe(false);
});

it("treats wildcard and expression characters as ordinary text", () => {
  expect(createSearchMatcher("%")(["reporter@example.invalid"])).toBe(false);
  expect(createSearchMatcher("_")(["first_last@example.invalid"])).toBe(true);
  expect(createSearchMatcher(".*")(["reporter@example.invalid"])).toBe(false);
  expect(
    createSearchMatcher("' OR true --")(["reporter@example.invalid"]),
  ).toBe(false);
});
