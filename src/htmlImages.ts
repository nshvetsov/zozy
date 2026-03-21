export type OcrAssetStatus =
  | "pending"
  | "loading"
  | "skipped"
  | "ocr_done"
  | "ocr_failed";

export interface HtmlImageAsset {
  id: string;
  domIndex: number;
  src: string;
  alt: string;
  status: OcrAssetStatus;
  warning?: string;
}

export function extractHtmlImages(html: string): HtmlImageAsset[] {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  sanitizeHtmlForImages(doc);

  const images = Array.from(doc.body.querySelectorAll<HTMLImageElement>("img"));
  return images.map((img, domIndex) => {
    const srcRaw = (img.getAttribute("src") ?? "").trim();
    const src = normalizeImageSrc(srcRaw);
    const unsupportedProtocol = src.startsWith("cid:") || src.startsWith("data:text/");
    const hasUsableSrc = Boolean(src) && !unsupportedProtocol;
    return {
      id: `img-${domIndex + 1}`,
      domIndex,
      src,
      alt: (img.getAttribute("alt") ?? "").trim(),
      status: hasUsableSrc ? "pending" : "skipped",
      warning: hasUsableSrc ? undefined : "Изображение недоступно для OCR (пустой/неподдерживаемый src).",
    };
  });
}

function sanitizeHtmlForImages(doc: Document) {
  doc.querySelectorAll("script, style").forEach((node) => node.remove());
  doc.querySelectorAll("[hidden], [aria-hidden='true']").forEach((node) => node.remove());
  doc.querySelectorAll<HTMLElement>("[style]").forEach((node) => {
    const style = node.getAttribute("style")?.toLowerCase().replace(/\s+/g, "") ?? "";
    if (style.includes("display:none") || style.includes("max-height:0")) node.remove();
  });
}

function normalizeImageSrc(value: string): string {
  if (!value) return "";
  try {
    return new URL(value, window.location.href).toString();
  } catch {
    return value;
  }
}
