// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { runCheckJob } from "./jobRunner";
import type { CheckJob } from "./types";
import type { CyrillicSqliteLookup } from "../dictionary/sqliteDictionary";

function mockLookup(allowed: Set<string>): CyrillicSqliteLookup {
  return {
    allowsNormalizedBatch(words: string[]) {
      return new Set(words.filter((w) => allowed.has(w)));
    },
  };
}

describe("runCheckJob", () => {
  it("flags latin VR and allows cyrillic in dictionary", async () => {
    const job: CheckJob = {
      id: "job-1",
      sourceType: "file",
      sourceName: "mail.html",
      sourceValue: "mail.html",
      sourceFile: new File(["<html><body>Скидка VR</body></html>"], "mail.html", { type: "text/html" }),
      html: "",
      plainText: "",
      status: "pending",
      progressLabel: "",
      violations: [],
      checkedWords: [],
      createdAt: new Date().toISOString(),
    };

    const lookup = mockLookup(new Set(["скидка"]));
    const result = await runCheckJob(job, {
      fetchImpl: vi.fn(),
      norms: [
        { code: "LAT_PROHIBITED", norm: "norm-lat" },
        { code: "CYR_NOT_IN_DICT", norm: "norm-cyr" },
      ],
      glossaryMap: new Map(),
      trademarks: [],
      cyrillicLookup: lookup,
    });

    expect(result.plainText).toBe("Скидка VR");
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0].type).toBe("LAT_PROHIBITED");
    expect(result.checkedWords.some((item) => item.word.toLowerCase() === "скидка")).toBe(true);
  });

  it("filters violations by allow terms (trademarks list)", async () => {
    const job: CheckJob = {
      id: "job-allow-1",
      sourceType: "url",
      sourceName: "mail-1",
      sourceValue: "https://example.com/mail-1",
      html: "<html><body>Скидка VR</body></html>",
      plainText: "",
      status: "pending",
      progressLabel: "",
      violations: [],
      checkedWords: [],
      createdAt: new Date().toISOString(),
    };

    const lookup = mockLookup(new Set(["скидка"]));
    const result = await runCheckJob(job, {
      fetchImpl: vi.fn(),
      norms: [
        { code: "LAT_PROHIBITED", norm: "norm-lat" },
        { code: "CYR_NOT_IN_DICT", norm: "norm-cyr" },
      ],
      glossaryMap: new Map(),
      trademarks: [{ name: "VR" }],
      cyrillicLookup: lookup,
    });

    expect(result.violations).toEqual([]);
    expect(result.checkedWords.some((item) => item.word === "VR")).toBe(true);
  });

  it("filters violations by glossary map entries", async () => {
    const job: CheckJob = {
      id: "job-deny-1",
      sourceType: "file",
      sourceName: "mail.html",
      sourceValue: "mail.html",
      sourceFile: new File(["<html><body>Скидка VR</body></html>"], "mail.html", { type: "text/html" }),
      html: "",
      plainText: "",
      status: "pending",
      progressLabel: "",
      violations: [],
      checkedWords: [],
      createdAt: new Date().toISOString(),
    };

    const lookup = mockLookup(new Set(["скидка"]));
    const result = await runCheckJob(job, {
      fetchImpl: vi.fn(),
      norms: [
        { code: "LAT_PROHIBITED", norm: "norm-lat" },
        { code: "CYR_NOT_IN_DICT", norm: "norm-cyr" },
      ],
      glossaryMap: new Map([
        [
          "vr",
          {
            original: "vr",
            preferred: "виртуальная реальность",
            replacements: ["виртуальная реальность"],
            type: "LAT_PROHIBITED",
          },
        ],
      ]),
      trademarks: [],
      cyrillicLookup: lookup,
    });

    expect(result.violations).toEqual([]);
    expect(result.checkedWords.some((item) => item.word === "VR")).toBe(true);
  });
});
