import { describe, expect, it } from "vitest";
import { normalizeForSearch } from "./normalizeForSearch";

describe("normalizeForSearch", () => {
  it("applies NFC and lowercase", () => {
    expect(normalizeForSearch(" \tСтол  ")).toBe("стол");
  });

  it("maps Latin lookalikes to Cyrillic", () => {
    expect(normalizeForSearch("cafe")).toBe("сае");
    expect(normalizeForSearch("kop")).toBe("кор");
  });

  it("strips combining acute and grave", () => {
    expect(normalizeForSearch("а́бв")).toBe("абв");
    expect(normalizeForSearch("а̀бв")).toBe("абв");
  });

  it("folds ё to е", () => {
    expect(normalizeForSearch("Ёлка")).toBe("елка");
  });

  it("keeps only allowed charset and collapses spaces", () => {
    expect(normalizeForSearch("a-b! c?")).toBe("а-в с");
    expect(normalizeForSearch("один  два   три")).toBe("один два три");
  });

  it("parity-style mixed noise", () => {
    expect(normalizeForSearch("  Тест™, 123  ")).toBe("тест 123");
  });
});
