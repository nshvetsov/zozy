import { describe, expect, it } from "vitest";
import { normalizeForSearch } from "./normalization";

describe("sqlite/normalization", () => {
  it("maps latin lookalikes to cyrillic and lowercases", () => {
    expect(normalizeForSearch("CкидОК")).toBe("скидок");
  });

  it("normalizes ё and accent marks", () => {
    expect(normalizeForSearch("Ёлка а́")).toBe("елка а");
  });

  it("strips punctuation and collapses spaces", () => {
    expect(normalizeForSearch("  бьюти!!!   бренд  ")).toBe("бьюти бренд");
  });
});
