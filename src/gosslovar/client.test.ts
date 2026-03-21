import { describe, expect, it, vi } from "vitest";
import { checkPlainTextWithApi } from "./client";

describe("checkPlainTextWithApi", () => {
  it("runs check + polling and merges offsets across chunks", async () => {
    const text = "А".repeat(1300);
    const resultsCalls = new Map<string, number>();
    let checkCounter = 0;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/check/text")) {
        checkCounter += 1;
        return {
          ok: true,
          status: 200,
          json: async () => ({ id: `c${checkCounter}` }),
        } as Response;
      }
      if (url.includes("/api/results/text?id=c1")) {
        const count = (resultsCalls.get("c1") ?? 0) + 1;
        resultsCalls.set("c1", count);
        if (count === 1) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ status: "running", error: null, result: null }),
          } as Response;
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({
            status: "done",
            error: null,
            result: {
              status: "not-found",
              text: "chunk1",
              missing_words: [{ word: "VR", position: 649, length: 2 }],
            },
          }),
        } as Response;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          status: "done",
          error: null,
          result: {
            status: "not-found",
            text: "chunk2",
            missing_words: [{ word: "кринж", position: 10, length: 5 }],
          },
        }),
      } as Response;
    });

    const result = await checkPlainTextWithApi("GS-KEY", text, {
      fetchImpl,
      chunkSize: 650,
      pollIntervalMs: 1,
      jitterMinMs: 0,
      jitterMaxMs: 0,
    });

    expect(result.missingWords).toHaveLength(2);
    expect(result.missingWords[0].word).toBe("VR");
    expect(result.missingWords[0].globalStart).toBe(649);
    expect(result.missingWords[1].word).toBe("кринж");
    expect(result.missingWords[1].globalStart).toBe(660);
  });

  it("throws when API returns status error", async () => {
    const responses = [
      { ok: true, status: 200, json: async () => ({ id: "c1" }) },
      {
        ok: true,
        status: 200,
        json: async () => ({ status: "error", error: "limit reached", result: null }),
      },
    ];
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL) => responses.shift() as Response);

    await expect(
      checkPlainTextWithApi("GS-KEY", "Тест", {
        fetchImpl,
        pollIntervalMs: 1,
        jitterMinMs: 0,
        jitterMaxMs: 0,
      }),
    ).rejects.toThrow("limit reached");
  });
});
