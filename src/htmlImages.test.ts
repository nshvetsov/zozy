// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { extractHtmlImages } from "./htmlImages";

describe("extractHtmlImages", () => {
  it("extracts img assets from html and keeps order", () => {
    const html = `
      <div>
        <img src="https://cdn.example.com/a.png" alt="a" />
        <img src="/b.jpg" alt="b" />
      </div>
    `;
    const assets = extractHtmlImages(html);
    expect(assets).toHaveLength(2);
    expect(assets[0].id).toBe("img-1");
    expect(assets[1].id).toBe("img-2");
    expect(assets[0].status).toBe("pending");
  });

  it("marks unsupported src as skipped", () => {
    const html = `<img src="cid:banner-1" alt="cid"/>`;
    const assets = extractHtmlImages(html);
    expect(assets).toHaveLength(1);
    expect(assets[0].status).toBe("skipped");
    expect(assets[0].warning).toContain("недоступно");
  });
});
