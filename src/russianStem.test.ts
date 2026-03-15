import { describe, expect, it } from "vitest";
import dictionary from "../data/parsed_dictionary.json";
import { russianStem } from "./russianStem";

describe("russianStem", () => {
  const stems = dictionary.stems as Record<string, boolean | undefined>;

  it("matches common inflected forms to dictionary stems", () => {
    expect(stems[russianStem("делимся")]).toBe(true);
    expect(stems[russianStem("встречайте")]).toBe(true);
    expect(stems[russianStem("новостью")]).toBe(true);
  });
});
