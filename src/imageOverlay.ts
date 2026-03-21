import type { OcrWord } from "./browserOcr";

export type ImageOverlayKind = "violation" | "tech";

export interface ImageViolationRange {
  violationId: string;
  start: number;
  end: number;
  kind: ImageOverlayKind;
}

export interface ImageViolationBox {
  violationId: string;
  kind: ImageOverlayKind;
  bbox: { x0: number; y0: number; x1: number; y1: number };
}

export interface ImageOverlayAsset {
  assetId: string;
  domIndex: number;
  imageWidth: number;
  imageHeight: number;
  words: OcrWord[];
  violations: ImageViolationRange[];
}

export interface ImageOverlayHandle {
  focusViolation: (violationId: string) => void;
}

export function mapViolationRangesToWordBoxes(
  words: OcrWord[],
  ranges: ImageViolationRange[],
): ImageViolationBox[] {
  const boxes: ImageViolationBox[] = [];
  ranges.forEach((range) => {
    words.forEach((word) => {
      if (word.start < range.end && word.end > range.start) {
        boxes.push({
          violationId: range.violationId,
          kind: range.kind,
          bbox: word.bbox,
        });
      }
    });
  });
  return boxes;
}

export function renderImageOverlays(
  doc: Document,
  assets: ImageOverlayAsset[],
  onSelect: (violationId: string) => void,
): ImageOverlayHandle {
  doc.querySelectorAll(".image-ocr-overlay-layer").forEach((node) => node.remove());
  const images = Array.from(doc.querySelectorAll<HTMLImageElement>("img"));
  let lastFocused: HTMLElement | null = null;

  assets.forEach((asset) => {
    const image = images[asset.domIndex];
    if (!image) return;
    const imageBoxWidth = image.clientWidth || image.width || 1;
    const imageBoxHeight = image.clientHeight || image.height || 1;
    const scaleX = imageBoxWidth / Math.max(asset.imageWidth, 1);
    const scaleY = imageBoxHeight / Math.max(asset.imageHeight, 1);
    const parent = image.parentElement;
    if (!parent) return;
    const parentStyle = doc.defaultView?.getComputedStyle(parent);
    if (parentStyle?.position === "static") {
      parent.style.position = "relative";
    }

    const layer = doc.createElement("div");
    layer.className = "image-ocr-overlay-layer";
    layer.style.position = "absolute";
    layer.style.inset = "0";
    layer.style.pointerEvents = "none";

    const boxes = mapViolationRangesToWordBoxes(asset.words, asset.violations);
    boxes.forEach((box) => {
      const node = doc.createElement("button");
      node.type = "button";
      node.className =
        box.kind === "tech" ? "image-ocr-box image-ocr-box-tech" : "image-ocr-box image-ocr-box-violation";
      node.dataset.violationId = box.violationId;
      node.style.position = "absolute";
      node.style.left = `${Math.max(box.bbox.x0 * scaleX, 0)}px`;
      node.style.top = `${Math.max(box.bbox.y0 * scaleY, 0)}px`;
      node.style.width = `${Math.max((box.bbox.x1 - box.bbox.x0) * scaleX, 6)}px`;
      node.style.height = `${Math.max((box.bbox.y1 - box.bbox.y0) * scaleY, 6)}px`;
      node.style.pointerEvents = "auto";
      node.addEventListener("click", () => onSelect(box.violationId));
      layer.appendChild(node);
    });

    parent.appendChild(layer);
  });

  return {
    focusViolation: (violationId: string) => {
      if (lastFocused) lastFocused.classList.remove("image-ocr-box-focused");
      const target = doc.querySelector<HTMLElement>(`.image-ocr-box[data-violation-id="${violationId}"]`);
      if (!target) return;
      target.classList.add("image-ocr-box-focused");
      target.scrollIntoView({ block: "center", behavior: "smooth" });
      lastFocused = target;
    },
  };
}
