// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { loadSourceHtml } from "./sourceLoader";
import type { CheckJob } from "./types";

function createBaseJob(): Omit<CheckJob, "id" | "sourceType" | "sourceName" | "sourceValue"> {
  return {
    sourceFile: undefined,
    html: "",
    plainText: "",
    status: "pending",
    progressLabel: "",
    violations: [],
    checkedWords: [],
    createdAt: new Date().toISOString(),
  };
}

describe("loadSourceHtml", () => {
  it("loads html from file source", async () => {
    const file = new File(["<html><body>mail</body></html>"], "mail.html", { type: "text/html" });
    const job: CheckJob = {
      id: "1",
      sourceType: "file",
      sourceName: "mail.html",
      sourceValue: "mail.html",
      ...createBaseJob(),
      sourceFile: file,
    };
    const html = await loadSourceHtml(job);
    expect(html).toContain("mail");
  });

  it("loads html from url source", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => "<html><body>from-url</body></html>",
    }));
    vi.stubGlobal("fetch", fetchMock);
    const job: CheckJob = {
      id: "2",
      sourceType: "url",
      sourceName: "url",
      sourceValue: "https://example.com/mail",
      ...createBaseJob(),
    };
    const html = await loadSourceHtml(job);
    expect(html).toContain("from-url");
  });

  it("uses configured proxy endpoint for url source", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "https://proxy.example/proxy") {
        return new Response("<html><body>from-proxy-endpoint</body></html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        });
      }
      return new Response("unexpected", { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const job: CheckJob = {
      id: "3",
      sourceType: "url",
      sourceName: "url",
      sourceValue: "https://example.com/mail",
      ...createBaseJob(),
    };
    const html = await loadSourceHtml(job, { urlProxyEndpoint: "https://proxy.example/proxy" });
    expect(html).toContain("from-proxy-endpoint");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://proxy.example/proxy",
      expect.objectContaining({ method: "POST" }),
    );
  });
});
