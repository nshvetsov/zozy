// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { runCheckJob } from "./jobRunner";
import type { CheckJob } from "./types";

describe("runCheckJob", () => {
  it("runs API pipeline and maps violations", async () => {
    const responses = [
      { ok: true, status: 200, json: async () => ({ id: "c1" }) },
      {
        ok: true,
        status: 200,
        json: async () => ({
          status: "done",
          error: null,
          result: {
            status: "not-found",
            text: "Скидка VR",
            missing_words: [{ word: "VR", position: 7, length: 2 }],
          },
        }),
      },
    ];
    const fetchMock = vi.fn(async () => responses.shift() as Response);

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

    const result = await runCheckJob(job, {
      apiKey: "GS-KEY",
      fetchImpl: fetchMock,
      norms: [
        { code: "LAT_PROHIBITED", norm: "norm-lat" },
        { code: "CYR_NOT_IN_DICT", norm: "norm-cyr" },
      ],
      glossaryMap: new Map(),
      trademarks: [],
      chunkSize: 650,
      jitterMinMs: 0,
      jitterMaxMs: 0,
      pollIntervalMs: 1,
    });

    expect(result.plainText).toBe("Скидка VR");
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0].type).toBe("LAT_PROHIBITED");
    expect(result.checkedWords.some((item) => item.word.toLowerCase() === "скидка")).toBe(true);
  });
});
