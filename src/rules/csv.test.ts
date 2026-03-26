import { describe, expect, it } from "vitest";
import { buildRulesCsv, parseRulesCsv } from "./csv";

describe("rules/csv", () => {
  it("parses new rules csv format", () => {
    const content = [
      "phrase,mode,reason,replacements",
      "\"vr\",\"deny\",\"латиница\",\"виртуальная реальность|ВР\"",
      "\"орифлейм\",\"allow\",\"бренд\",\"\"",
    ].join("\n");
    const parsed = parseRulesCsv(content);
    expect(parsed).toEqual([
      { phrase: "vr", mode: "deny", reason: "латиница", replacements: ["виртуальная реальность", "ВР"] },
      { phrase: "орифлейм", mode: "allow", reason: "бренд", replacements: [] },
    ]);
  });

  it("supports legacy glossary csv fallback", () => {
    const content = [
      "original,replacements",
      "\"VR\",\"виртуальная реальность|ВР\"",
    ].join("\n");
    const parsed = parseRulesCsv(content);
    expect(parsed).toEqual([
      { phrase: "vr", mode: "deny", reason: "", replacements: ["виртуальная реальность", "ВР"] },
    ]);
  });

  it("builds csv rows for export", () => {
    const csv = buildRulesCsv([
      { phrase: "vr", mode: "deny", reason: "латиница", replacements: ["виртуальная реальность"] },
      { phrase: "орифлейм", mode: "allow", reason: "бренд", replacements: [] },
    ]);
    expect(csv).toContain("phrase,mode,reason,replacements");
    expect(csv).toContain("\"vr\",\"deny\",\"латиница\",\"виртуальная реальность\"");
    expect(csv).toContain("\"орифлейм\",\"allow\",\"бренд\",\"\"");
  });
});
