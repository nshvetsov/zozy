import { describe, expect, it } from "vitest";
import { buildRulesContext, normalizeRuleEntry, normalizeRulePhrase } from "./domain";

describe("rules/domain", () => {
  it("normalizes phrase and mode", () => {
    const normalized = normalizeRuleEntry({
      phrase: "  VR Promo  ",
      mode: "deny",
      reason: " test ",
      replacements: ["ВР", "Промо"],
    });
    expect(normalized).toEqual({
      phrase: "vr promo",
      mode: "deny",
      reason: "test",
      replacements: ["ВР", "Промо"],
      applyToInflections: false,
    });
  });

  it("drops replacements for allow mode", () => {
    const normalized = normalizeRuleEntry({
      phrase: "  орифлейм ",
      mode: "allow",
      replacements: ["не должно сохраниться"],
    });
    expect(normalized).toEqual({
      phrase: "орифлейм",
      mode: "allow",
      reason: "",
      replacements: [],
      applyToInflections: false,
    });
  });

  it("builds allow and deny context", () => {
    const context = buildRulesContext([
      { phrase: "VR", mode: "deny", reason: "", replacements: ["виртуальная реальность"], applyToInflections: false },
      { phrase: "орифлейм", mode: "deny", reason: "", replacements: ["Oriflame"], applyToInflections: false },
      { phrase: "brand safe", mode: "allow", reason: "", replacements: [], applyToInflections: false },
    ]);
    expect(context.allowTerms).toEqual(["brand safe"]);
    expect(context.denyGlossary).toEqual([
      {
        original: "vr",
        preferred: "виртуальная реальность",
        replacements: ["виртуальная реальность"],
        type: "LAT_PROHIBITED",
      },
      {
        original: "орифлейм",
        preferred: "Oriflame",
        replacements: ["Oriflame"],
        type: "CYR_NOT_IN_DICT",
      },
    ]);
  });

  it("normalizes mixed latin/cyrillic lookalikes in phrase", () => {
    expect(normalizeRulePhrase("cкидок")).toBe("скидок");
    const normalized = normalizeRuleEntry({
      phrase: "cкидок",
      mode: "deny",
      replacements: ["скидок"],
    });
    expect(normalized?.phrase).toBe("скидок");
  });
});
