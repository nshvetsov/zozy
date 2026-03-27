export interface TextChunk {
  text: string;
  start: number;
  end: number;
}

function isWhitespace(char: string): boolean {
  return /\s/.test(char);
}

function isSentenceBoundary(prev: string, next: string): boolean {
  return /[.!?]/.test(prev) && isWhitespace(next);
}

function findSplitPoint(text: string, start: number, hardEnd: number): number {
  let sentenceBoundary = -1;
  let whitespaceBoundary = -1;

  for (let i = hardEnd; i > start; i -= 1) {
    const prev = text[i - 1] ?? "";
    const current = text[i] ?? "";
    if (prev === "\n" && current === "\n") return i;
    if (sentenceBoundary === -1 && isSentenceBoundary(prev, current)) sentenceBoundary = i;
    if (whitespaceBoundary === -1 && isWhitespace(prev)) whitespaceBoundary = i;
  }

  if (sentenceBoundary !== -1) return sentenceBoundary;
  if (whitespaceBoundary !== -1) return whitespaceBoundary;
  return hardEnd;
}

export function chunkPlainText(text: string, maxChunkLength = 650): TextChunk[] {
  if (maxChunkLength <= 0) throw new Error("maxChunkLength must be positive");
  if (!text.length) return [];
  if (text.length <= maxChunkLength) return [{ text, start: 0, end: text.length }];

  const chunks: TextChunk[] = [];
  let cursor = 0;

  while (cursor < text.length) {
    const hardEnd = Math.min(cursor + maxChunkLength, text.length);
    const splitPoint = hardEnd === text.length ? hardEnd : findSplitPoint(text, cursor, hardEnd);
    const end = splitPoint > cursor ? splitPoint : hardEnd;
    chunks.push({
      text: text.slice(cursor, end),
      start: cursor,
      end,
    });
    cursor = end;
  }

  return chunks;
}
