export interface TextSegment {
  globalStart: number;
  globalEnd: number;
  nodeOrder: number;
  nodePath: number[];
  text: string;
  localStart: number;
  localEnd: number;
}

export interface HtmlPreviewModel {
  plainText: string;
  bodyHtml: string;
  segments: TextSegment[];
}

interface TextChunk {
  text: string;
  localStart: number;
  localEnd: number;
}

export function buildHtmlPreviewModel(html: string): HtmlPreviewModel {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  sanitizeHtmlDocument(doc);

  const chunksByNode = new Map<Text, TextChunk[]>();
  const textNodes = collectVisibleTextNodes(doc.body);
  textNodes.forEach((node) => {
    const chunks = chunkNonWhitespace(node.nodeValue ?? "");
    if (chunks.length) chunksByNode.set(node, chunks);
  });

  const segments: TextSegment[] = [];
  const textParts: string[] = [];
  let cursor = 0;

  textNodes.forEach((node, nodeOrder) => {
    const chunks = chunksByNode.get(node);
    if (!chunks) return;
    const nodePath = getNodePath(node, doc.body);
    chunks.forEach((chunk, chunkIdx) => {
      if (!chunk.text) return;
      if (textParts.length) {
        textParts.push(" ");
        cursor += 1;
      }
      textParts.push(chunk.text);
      const start = cursor;
      const end = start + chunk.text.length;
      segments.push({
        globalStart: start,
        globalEnd: end,
        nodeOrder,
        nodePath,
        text: chunk.text,
        localStart: chunk.localStart,
        localEnd: chunk.localEnd,
      });
      cursor = end;
      if (chunkIdx === chunks.length - 1) return;
    });
  });

  return {
    plainText: textParts.join(""),
    bodyHtml: doc.body.innerHTML,
    segments,
  };
}

export function extractVisibleTextFromHtml(html: string): string {
  return buildHtmlPreviewModel(html).plainText;
}

function sanitizeHtmlDocument(doc: Document) {
  doc.querySelectorAll("script, style").forEach((node) => node.remove());
  doc.querySelectorAll("[hidden], [aria-hidden='true']").forEach((node) => node.remove());
  doc.querySelectorAll<HTMLElement>("[style]").forEach((node) => {
    const style = node.getAttribute("style")?.toLowerCase().replace(/\s+/g, "") ?? "";
    if (style.includes("display:none") || style.includes("font-size:0") || style.includes("max-height:0")) {
      node.remove();
    }
  });
}

function collectVisibleTextNodes(root: HTMLElement): Text[] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  let current = walker.nextNode();
  while (current) {
    if (current.nodeType === Node.TEXT_NODE) nodes.push(current as Text);
    current = walker.nextNode();
  }
  return nodes;
}

function chunkNonWhitespace(value: string): TextChunk[] {
  const chunks: TextChunk[] = [];
  const regex = /\S+/g;
  let match: RegExpExecArray | null = regex.exec(value);
  while (match) {
    const text = match[0];
    chunks.push({
      text,
      localStart: match.index,
      localEnd: match.index + text.length,
    });
    match = regex.exec(value);
  }
  return chunks;
}

function getNodePath(node: Node, root: Node): number[] {
  const path: number[] = [];
  let current: Node | null = node;
  while (current && current !== root) {
    const parentNode: Node | null = current.parentNode;
    if (!parentNode) break;
    path.push(Array.prototype.indexOf.call(parentNode.childNodes, current));
    current = parentNode;
  }
  return path.reverse();
}
