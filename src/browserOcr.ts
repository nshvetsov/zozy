export interface OcrWord {
  text: string;
  start: number;
  end: number;
  confidence: number;
  bbox: { x0: number; y0: number; x1: number; y1: number };
}

export interface BrowserOcrResult {
  text: string;
  words: OcrWord[];
  confidence: number;
  imageWidth: number;
  imageHeight: number;
}

type OcrWorker = {
  recognize: (image: unknown) => Promise<{ data?: unknown }>;
};

let cachedWorker: OcrWorker | null = null;

export async function recognizeImageText(src: string): Promise<BrowserOcrResult> {
  const worker = await getOcrWorker();
  const { blob, width, height } = await fetchImageBlob(src);
  const recognized = await worker.recognize(blob);
  return mapOcrResponse(recognized.data, width, height);
}

async function getOcrWorker(): Promise<OcrWorker> {
  if (cachedWorker) return cachedWorker;
  const tesseractModule = await import("tesseract.js");
  const worker = await tesseractModule.createWorker("rus+eng");
  cachedWorker = worker as OcrWorker;
  return cachedWorker;
}

function mapOcrResponse(dataRaw: unknown, width: number, height: number): BrowserOcrResult {
  const data = (dataRaw ?? {}) as {
    text?: string;
    confidence?: number;
    words?: Array<{
      text?: string;
      confidence?: number;
      bbox?: { x0?: number; y0?: number; x1?: number; y1?: number };
    }>;
  };
  const words = buildWordOffsets(data.words ?? []);
  return {
    text: words.length ? words.map((word) => word.text).join(" ") : (data.text ?? "").replace(/\s+/g, " ").trim(),
    words,
    confidence: data.confidence ?? 0,
    imageWidth: width,
    imageHeight: height,
  };
}

async function fetchImageBlob(src: string): Promise<{ blob: Blob; width: number; height: number }> {
  try {
    const response = await fetch(src, { mode: "cors" });
    if (!response.ok) {
      throw new Error(`Не удалось загрузить изображение (${response.status})`);
    }
    const blob = await response.blob();
    const { width, height } = await getBlobImageSize(blob);
    return { blob, width, height };
  } catch (error) {
    throw error;
  }
}

async function getBlobImageSize(blob: Blob): Promise<{ width: number; height: number }> {
  return await new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      resolve({ width: image.naturalWidth || image.width || 1, height: image.naturalHeight || image.height || 1 });
      URL.revokeObjectURL(url);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Не удалось прочитать размеры изображения"));
    };
    image.src = url;
  });
}

function buildWordOffsets(
  words: Array<{
    text?: string;
    confidence?: number;
    bbox?: { x0?: number; y0?: number; x1?: number; y1?: number };
  }>,
): OcrWord[] {
  const result: OcrWord[] = [];
  let cursor = 0;
  words.forEach((raw) => {
    const value = (raw.text ?? "").trim();
    if (!value) return;
    const start = cursor;
    const end = start + value.length;
    result.push({
      text: value,
      start,
      end,
      confidence: raw.confidence ?? 0,
      bbox: {
        x0: raw.bbox?.x0 ?? 0,
        y0: raw.bbox?.y0 ?? 0,
        x1: raw.bbox?.x1 ?? 0,
        y1: raw.bbox?.y1 ?? 0,
      },
    });
    cursor = end + 1;
  });
  return result;
}
