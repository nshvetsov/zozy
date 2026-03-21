// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { buildHtmlPreviewModel } from "./htmlPreview";

describe("buildHtmlPreviewModel", () => {
  it("builds plain text and segments for multiple text nodes", () => {
    const html = "<div>Привет <b>мир</b> и <i>коллеги</i></div>";
    const model = buildHtmlPreviewModel(html);

    expect(model.plainText).toBe("Привет мир и коллеги");
    expect(model.segments.length).toBeGreaterThanOrEqual(4);

    const phrase = "мир и";
    const start = model.plainText.indexOf(phrase);
    const end = start + phrase.length;
    const touchedSegments = model.segments.filter(
      (segment) => segment.globalStart < end && segment.globalEnd > start,
    );
    expect(touchedSegments.length).toBeGreaterThanOrEqual(2);
  });

  it("ignores hidden blocks in plain text and segments", () => {
    const html = `
      <div>
        <span style="display:none">скрытый текст</span>
        <span aria-hidden="true">тоже скрытый</span>
        <span>видимый текст</span>
      </div>
    `;
    const model = buildHtmlPreviewModel(html);
    expect(model.plainText).toBe("видимый текст");
    expect(model.bodyHtml.toLowerCase()).not.toContain("скрытый");
  });

  it("ignores style and script content", () => {
    const html = `
      <style>.x { color: red; }</style>
      <script>window.alert("x")</script>
      <p>рабочий текст</p>
    `;
    const model = buildHtmlPreviewModel(html);
    expect(model.plainText).toBe("рабочий текст");
    expect(model.bodyHtml.toLowerCase()).not.toContain("<script");
    expect(model.bodyHtml.toLowerCase()).not.toContain("<style");
  });
});
