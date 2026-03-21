import { describe, expect, it } from "vitest";
import { buildViolationsCsvUtf8Sig } from "./exportViolationsCsv";
import type { CheckJob } from "./types";

describe("buildViolationsCsvUtf8Sig", () => {
  it("adds UTF-8 BOM and exports rows", () => {
    const jobs: CheckJob[] = [
      {
        id: "job-1",
        sourceType: "file",
        sourceName: "mail.html",
        sourceValue: "mail.html",
        html: "<html/>",
        plainText: "VR",
        status: "done",
        progressLabel: "done",
        checkedWords: [],
        createdAt: new Date().toISOString(),
        violations: [
          {
            word: "VR",
            position: { start: 0, end: 2 },
            source: "email_text",
            type: "LAT_PROHIBITED",
            risk: "HIGH",
            norm: "norm",
            normUrl: "https://example.com",
            replacements: ["виртуальная реальность"],
          },
        ],
      },
    ];
    const csv = buildViolationsCsvUtf8Sig(jobs);
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain("source_type");
    expect(csv).toContain("LAT_PROHIBITED");
    expect(csv).toContain("mail.html");
  });
});
