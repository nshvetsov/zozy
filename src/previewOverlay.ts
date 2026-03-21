import type { HtmlPreviewModel, TextSegment } from "./htmlPreview";

export type OverlayKind = "ok" | "violation" | "tech";

export interface OverlayRange {
  start: number;
  end: number;
  kind: OverlayKind;
  violationId?: string;
}

export interface PreviewRenderHandle {
  focusViolation: (violationId: string) => void;
  bindViolationSelect: (callback: (violationId: string) => void) => void;
  getDocument: () => Document;
}

interface NodeOperation {
  localStart: number;
  localEnd: number;
  kind: OverlayKind;
  violationId?: string;
}

const OVERLAY_STYLE = `
  <style>
    html, body { margin: 0; padding: 0; overflow: visible; }
    body { padding: 12px; font-family: "Segoe UI", Tahoma, sans-serif; color: #1b2b3b; transform-origin: top left; }
    .overlay-ok { background: rgba(44, 178, 91, 0.16) !important; border-radius: 2px; box-decoration-break: clone; -webkit-box-decoration-break: clone; }
    .overlay-violation {
      background: rgba(220, 38, 38, 0.55) !important;
      border-radius: 2px;
      box-shadow: inset 0 -2px 0 rgba(140, 0, 0, 0.95);
      text-decoration: underline solid rgba(140, 0, 0, 0.98) 2px !important;
      text-underline-offset: 1px;
      box-decoration-break: clone;
      -webkit-box-decoration-break: clone;
    }
    .overlay-tech {
      background: rgba(234, 146, 26, 0.5) !important;
      border-radius: 2px;
      box-shadow: inset 0 -2px 0 rgba(160, 92, 0, 0.95);
      text-decoration: underline solid rgba(160, 92, 0, 0.98) 2px !important;
      text-underline-offset: 1px;
      box-decoration-break: clone;
      -webkit-box-decoration-break: clone;
    }
    .overlay-focused { outline: 2px solid rgba(31, 100, 184, 0.7); }
    .image-focus-target { outline: 3px solid rgba(31, 100, 184, 0.85) !important; outline-offset: 2px; }
    .image-ocr-box { border: 1px solid rgba(220, 38, 38, 0.85); background: rgba(220, 38, 38, 0.22); border-radius: 2px; padding: 0; margin: 0; }
    .image-ocr-box-tech { border-color: rgba(234, 146, 26, 0.95); background: rgba(234, 146, 26, 0.24); }
    .image-ocr-box-focused { box-shadow: 0 0 0 2px rgba(31, 100, 184, 0.85); }
  </style>
`;

export async function renderPreviewWithOverlay(
  iframe: HTMLIFrameElement,
  model: HtmlPreviewModel,
  ranges: OverlayRange[],
): Promise<PreviewRenderHandle> {
  iframe.srcdoc = buildSrcDoc(model.bodyHtml);
  const doc = await waitForIframeDocument(iframe);
  applyOverlayRanges(doc, model.segments, ranges);
  fitIframeToContent(iframe, doc);

  let lastFocused: HTMLElement | null = null;
  let onViolationSelect: ((violationId: string) => void) | null = null;
  doc.body.addEventListener("click", (event) => {
    const target = event.target as HTMLElement | null;
    const violationId = target?.closest<HTMLElement>("[data-violation-id]")?.dataset.violationId;
    if (!violationId) return;
    onViolationSelect?.(violationId);
  });
  return {
    focusViolation: (violationId: string) => {
      if (lastFocused) lastFocused.classList.remove("overlay-focused");
      const target = doc.querySelector<HTMLElement>(`[data-violation-id="${violationId}"]`);
      if (!target) return;
      target.classList.add("overlay-focused");
      target.scrollIntoView({ block: "center", behavior: "smooth" });
      lastFocused = target;
    },
    bindViolationSelect: (callback: (violationId: string) => void) => {
      onViolationSelect = callback;
    },
    getDocument: () => doc,
  };
}

function buildSrcDoc(bodyHtml: string): string {
  return `<!doctype html><html><head><meta charset="utf-8">${OVERLAY_STYLE}</head><body>${bodyHtml}</body></html>`;
}

function waitForIframeDocument(iframe: HTMLIFrameElement): Promise<Document> {
  return new Promise((resolve) => {
    iframe.addEventListener(
      "load",
      () => {
        resolve(iframe.contentDocument ?? document.implementation.createHTMLDocument(""));
      },
      { once: true },
    );
  });
}

function applyOverlayRanges(doc: Document, segments: TextSegment[], ranges: OverlayRange[]) {
  const operationsByNode = new Map<Text, NodeOperation[]>();
  const orderedTextNodes = collectTextNodes(doc.body);
  let unresolvedSegments = 0;
  let overlappedSegments = 0;
  let whitespaceCandidateRejects = 0;
  let pathResolved = 0;
  let orderResolved = 0;
  let searchResolved = 0;

  ranges.forEach((range) => {
    if (range.end <= range.start) return;
    const overlapSegments = segments.filter(
      (segment) => segment.globalStart < range.end && segment.globalEnd > range.start,
    );
    overlappedSegments += overlapSegments.length;
    overlapSegments.forEach((segment) => {
      const overlapStart = Math.max(range.start, segment.globalStart);
      const overlapEnd = Math.min(range.end, segment.globalEnd);
      const resolved = resolveTextNodeForSegment(doc.body, segment, orderedTextNodes);
      const textNode = resolved.node;
      if (!textNode) {
        unresolvedSegments += 1;
        return;
      }
      whitespaceCandidateRejects += resolved.whitespaceRejects;
      if (resolved.source === "path") pathResolved += 1;
      if (resolved.source === "order") orderResolved += 1;
      if (resolved.source === "search") searchResolved += 1;
      const localStart = resolved.baseStart + (overlapStart - segment.globalStart);
      const localEnd = resolved.baseStart + (overlapEnd - segment.globalStart);
      if (localEnd <= localStart) return;
      const list = operationsByNode.get(textNode) ?? [];
      list.push({
        localStart,
        localEnd,
        kind: range.kind,
        violationId: range.violationId,
      });
      operationsByNode.set(textNode, list);
    });
  });

  operationsByNode.forEach((operations, node) => {
    const merged = mergeOperations(operations);
    merged
      .sort((a, b) => b.localStart - a.localStart)
      .forEach((operation) => wrapTextRange(doc, node, operation));
  });
  const violationNodes = Array.from(doc.querySelectorAll<HTMLElement>(".overlay-violation"));
  const sample = violationNodes.slice(0, 3).map((node) => {
    const rect = node.getBoundingClientRect();
    const view = doc.defaultView;
    const styles = view ? view.getComputedStyle(node) : null;
    return {
      text: (node.textContent ?? "").slice(0, 40),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      bg: styles?.backgroundColor ?? "",
      textDecoration: styles?.textDecorationLine ?? "",
    };
  });
  void sample;
}

function resolveTextNodeForSegment(
  root: Node,
  segment: TextSegment,
  orderedTextNodes: Text[],
): { node: Text | null; source: "path" | "order" | "search" | "none"; whitespaceRejects: number; baseStart: number } {
  let whitespaceRejects = 0;
  const pathNode = resolveTextNodeByPath(root, segment.nodePath);
  const pathBase = resolveBaseStart(pathNode, segment);
  if (pathBase !== null) {
    return { node: pathNode, source: "path", whitespaceRejects, baseStart: pathBase };
  }
  if (pathNode) whitespaceRejects += 1;

  const orderNode = orderedTextNodes[segment.nodeOrder] ?? null;
  const orderBase = resolveBaseStart(orderNode, segment);
  if (orderBase !== null) {
    return { node: orderNode, source: "order", whitespaceRejects, baseStart: orderBase };
  }
  if (orderNode) whitespaceRejects += 1;

  for (const candidate of orderedTextNodes) {
    const searchBase = resolveBaseStart(candidate, segment);
    if (searchBase !== null) {
      return { node: candidate, source: "search", whitespaceRejects, baseStart: searchBase };
    }
  }

  return { node: null, source: "none", whitespaceRejects, baseStart: 0 };
}

function resolveBaseStart(node: Text | null, segment: TextSegment): number | null {
  if (!node) return null;
  const value = node.nodeValue ?? "";
  const localStart = segment.localStart;
  const localEnd = segment.localEnd;
  if (localStart >= 0 && localEnd <= value.length && localEnd > localStart) {
    const slice = value.slice(localStart, localEnd);
    if (slice === segment.text && /\S/.test(slice)) return localStart;
  }
  const fallbackStart = value.indexOf(segment.text);
  if (fallbackStart >= 0 && /\S/.test(segment.text)) return fallbackStart;
  return null;
}

function collectTextNodes(root: Node): Text[] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  let current = walker.nextNode();
  while (current) {
    if (current.nodeType === Node.TEXT_NODE) nodes.push(current as Text);
    current = walker.nextNode();
  }
  return nodes;
}

function resolveTextNodeByPath(root: Node, path: number[]): Text | null {
  let current: Node | null = root;
  for (const index of path) {
    if (!current?.childNodes[index]) return null;
    current = current.childNodes[index];
  }
  return current?.nodeType === Node.TEXT_NODE ? (current as Text) : null;
}

function mergeOperations(operations: NodeOperation[]): NodeOperation[] {
  const sorted = [...operations].sort((a, b) => a.localStart - b.localStart);
  const merged: NodeOperation[] = [];
  for (const current of sorted) {
    const last = merged[merged.length - 1];
    if (!last) {
      merged.push({ ...current });
      continue;
    }
    const sameKind = last.kind === current.kind && last.violationId === current.violationId;
    if (sameKind && current.localStart <= last.localEnd) {
      last.localEnd = Math.max(last.localEnd, current.localEnd);
      continue;
    }
    if (current.localStart < last.localEnd) continue;
    merged.push({ ...current });
  }
  return merged;
}

function wrapTextRange(doc: Document, textNode: Text, operation: NodeOperation) {
  const value = textNode.nodeValue ?? "";
  if (operation.localStart < 0 || operation.localEnd > value.length) return;
  const afterNode = textNode.splitText(operation.localEnd);
  const targetNode = textNode.splitText(operation.localStart);
  const wrapper = doc.createElement("span");
  wrapper.className = getOverlayClass(operation.kind);
  if (operation.violationId) wrapper.dataset.violationId = operation.violationId;
  const parent = targetNode.parentNode;
  if (!parent) return;
  parent.replaceChild(wrapper, targetNode);
  wrapper.appendChild(targetNode);
  void afterNode;
}

function getOverlayClass(kind: OverlayKind): string {
  if (kind === "violation") return "overlay-violation";
  if (kind === "tech") return "overlay-tech";
  return "overlay-ok";
}

function fitIframeToContent(iframe: HTMLIFrameElement, doc: Document) {
  const htmlEl = doc.documentElement;
  const body = doc.body;
  if (!htmlEl || !body) return;

  // Reset before measurement.
  body.style.transform = "scale(1)";
  iframe.style.height = "0px";

  const availableWidth = Math.max(iframe.clientWidth, 1);
  const contentWidth = Math.max(body.scrollWidth, htmlEl.scrollWidth, 1);
  const scale = contentWidth > availableWidth ? availableWidth / contentWidth : 1;
  body.style.transform = `scale(${scale})`;

  const contentHeight = Math.max(body.scrollHeight, htmlEl.scrollHeight, 1);
  const probe = measureVisualBounds(doc);
  const unscaledVisualHeight = probe.maxBottom > 0 ? probe.maxBottom / Math.max(scale, 0.001) : 0;
  const effectiveHeight = Math.max(contentHeight, unscaledVisualHeight, 1);
  const scaledHeight = Math.ceil(effectiveHeight * scale + 24);
  iframe.style.height = `${scaledHeight}px`;
}

function measureVisualBounds(doc: Document): { maxBottom: number; overflowY: string; elementsMeasured: number } {
  const body = doc.body;
  const view = doc.defaultView;
  if (!body || !view) return { maxBottom: 0, overflowY: "", elementsMeasured: 0 };
  const elements = Array.from(body.querySelectorAll<HTMLElement>("*"));
  let maxBottom = 0;
  elements.forEach((el) => {
    const rect = el.getBoundingClientRect();
    if (rect.bottom > maxBottom) maxBottom = rect.bottom;
  });
  const overflowY = view.getComputedStyle(body).overflowY;
  return {
    maxBottom: Math.round(maxBottom),
    overflowY,
    elementsMeasured: elements.length,
  };
}
