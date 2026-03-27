import { describe, expect, it } from "vitest";
import { chunkPlainText } from "./chunkText";

describe("chunkPlainText", () => {
  it("returns single chunk for short text", () => {
    const text = "Скидка 20% на кринж. Бонус: VR.";
    const chunks = chunkPlainText(text, 650);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toEqual({ text, start: 0, end: text.length });
  });

  it("splits long text without exceeding max length", () => {
    const sentence = "Это тестовый абзац с проверкой длины и позиций. ";
    const text = sentence.repeat(80);
    const chunks = chunkPlainText(text, 650);
    expect(chunks.length).toBeGreaterThan(3);
    expect(chunks.every((chunk) => chunk.text.length <= 650)).toBe(true);
    expect(chunks[0].start).toBe(0);
    expect(chunks[chunks.length - 1].end).toBe(text.length);
    const merged = chunks.map((chunk) => chunk.text).join("");
    expect(merged).toBe(text);
  });

  it("uses hard split when no boundary exists", () => {
    const text = "A".repeat(1500);
    const chunks = chunkPlainText(text, 650);
    expect(chunks).toHaveLength(3);
    expect(chunks[0].text.length).toBe(650);
    expect(chunks[1].text.length).toBe(650);
    expect(chunks[2].text.length).toBe(200);
  });
});
