import { describe, expect, it } from "vitest";
import dictionary from "../data/parsed_dictionary.json";

describe("parsed dictionary smoke", () => {
  const words = dictionary.words as Record<string, string[] | undefined>;

  it("contains expected baseline words", () => {
    expect(words["маркетинг"]).toBeTruthy();
    expect(words["бонус"]).toBeTruthy();
    expect(words["распродажа"]).toBeTruthy();
    expect(words["красивый"]).toBeTruthy();
    expect(words["доставка"]).toBeTruthy();
    expect(words["долгожданный"]).toBeTruthy();
  });

  it("does not contain disallowed slang words", () => {
    expect(words["кринж"]).toBeUndefined();
    expect(words["вайб"]).toBeUndefined();
  });
});
