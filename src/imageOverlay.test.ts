import { describe, expect, it } from "vitest";
import { mapViolationRangesToWordBoxes } from "./imageOverlay";

describe("mapViolationRangesToWordBoxes", () => {
  it("maps range intersections to word boxes", () => {
    const words = [
      { text: "drive", start: 0, end: 5, confidence: 90, bbox: { x0: 10, y0: 10, x1: 60, y1: 28 } },
      { text: "test", start: 6, end: 10, confidence: 88, bbox: { x0: 70, y0: 10, x1: 110, y1: 28 } },
    ];
    const ranges = [{ violationId: "v1", start: 0, end: 7, kind: "violation" as const }];
    const boxes = mapViolationRangesToWordBoxes(words, ranges);
    expect(boxes).toHaveLength(2);
    expect(boxes[0].violationId).toBe("v1");
  });

  it("returns empty when no intersections", () => {
    const words = [
      { text: "drive", start: 0, end: 5, confidence: 90, bbox: { x0: 10, y0: 10, x1: 60, y1: 28 } },
    ];
    const ranges = [{ violationId: "v2", start: 10, end: 12, kind: "violation" as const }];
    const boxes = mapViolationRangesToWordBoxes(words, ranges);
    expect(boxes).toHaveLength(0);
  });
});
