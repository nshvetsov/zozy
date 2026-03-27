import { chunkPlainText } from "./chunkText";

export interface GosslovarMissingWord {
  word: string;
  position: number;
  length: number;
}

export interface GosslovarCheckResponse {
  id: string;
}

export interface GosslovarResultStatistics {
  lines_total?: number;
  symbols_total?: number;
  symbols_checked?: number;
  words_checked?: number;
  words_left?: number;
  bad_words_found?: number;
  is_word_limit_reached?: boolean;
}

export interface GosslovarResultPayload {
  status: "ok" | "not-found";
  text: string;
  missing_words: GosslovarMissingWord[];
  statistics?: GosslovarResultStatistics;
}

export interface GosslovarResultsResponse {
  status: "running" | "done" | "error";
  error: string | null;
  result: GosslovarResultPayload | null;
}

export interface GlobalMissingWord extends GosslovarMissingWord {
  chunkIndex: number;
  globalStart: number;
  globalEnd: number;
}

export interface CheckPlainTextResult {
  text: string;
  missingWords: GlobalMissingWord[];
}

interface HttpOptions {
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}

export interface CheckPlainTextOptions extends HttpOptions {
  chunkSize?: number;
  pollIntervalMs?: number;
  maxPollAttempts?: number;
  jitterMinMs?: number;
  jitterMaxMs?: number;
  onChunkStart?: (chunkIndex: number, totalChunks: number) => void;
}

const GOSSLOVAR_BASE_URL = "https://gosslovar.ru";

function withAuthHeaders(apiKey: string, extra: Record<string, string> = {}): HeadersInit {
  return {
    Authorization: `Bearer ${apiKey}`,
    ...extra,
  };
}

function ensureFetch(fetchImpl?: typeof fetch): typeof fetch {
  if (fetchImpl) return fetchImpl;
  if (typeof fetch === "undefined") throw new Error("fetch is not available");
  return fetch;
}

function ensureNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error("Request aborted");
}

async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  ensureNotAborted(signal);
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(new Error("Request aborted"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function resolveJitterMs(minMs: number, maxMs: number): number {
  const safeMin = Math.max(0, minMs);
  const safeMax = Math.max(safeMin, maxMs);
  return Math.floor(safeMin + Math.random() * (safeMax - safeMin + 1));
}

export async function createCheckTextRequest(
  apiKey: string,
  text: string,
  options: HttpOptions = {},
): Promise<string> {
  const fetchImpl = ensureFetch(options.fetchImpl);
  try {
    const response = await fetchImpl(`${GOSSLOVAR_BASE_URL}/api/check/text`, {
      method: "POST",
      headers: withAuthHeaders(apiKey, { "Content-Type": "application/json" }),
      body: JSON.stringify({ text }),
      signal: options.signal,
    });
    if (!response.ok) {
      throw new Error(`Gosslovar check request failed: HTTP ${response.status}`);
    }
    const payload = (await response.json()) as GosslovarCheckResponse;
    if (!payload?.id) throw new Error("Gosslovar check request failed: missing id");
    return payload.id;
  } catch (error) {
    throw error;
  }
}

export async function getCheckTextResult(
  apiKey: string,
  checkId: string,
  options: HttpOptions = {},
): Promise<GosslovarResultsResponse> {
  const fetchImpl = ensureFetch(options.fetchImpl);
  try {
    const response = await fetchImpl(
      `${GOSSLOVAR_BASE_URL}/api/results/text?id=${encodeURIComponent(checkId)}`,
      {
        method: "GET",
        headers: withAuthHeaders(apiKey),
        signal: options.signal,
      },
    );
    if (!response.ok) {
      throw new Error(`Gosslovar results request failed: HTTP ${response.status}`);
    }
    return (await response.json()) as GosslovarResultsResponse;
  } catch (error) {
    throw error;
  }
}

export async function pollCheckTextResult(
  apiKey: string,
  checkId: string,
  options: CheckPlainTextOptions = {},
): Promise<GosslovarResultsResponse> {
  const pollIntervalMs = options.pollIntervalMs ?? 3000;
  const maxPollAttempts = options.maxPollAttempts ?? 60;

  for (let attempt = 1; attempt <= maxPollAttempts; attempt += 1) {
    ensureNotAborted(options.signal);
    const result = await getCheckTextResult(apiKey, checkId, options);
    if (result.status !== "running") return result;
    if (attempt < maxPollAttempts) await sleep(pollIntervalMs, options.signal);
  }
  throw new Error("Gosslovar polling timed out");
}

export async function checkPlainTextWithApi(
  apiKey: string,
  text: string,
  options: CheckPlainTextOptions = {},
): Promise<CheckPlainTextResult> {
  const chunkSize = options.chunkSize ?? 650;
  const jitterMinMs = options.jitterMinMs ?? 100;
  const jitterMaxMs = options.jitterMaxMs ?? 500;
  const chunks = chunkPlainText(text, chunkSize);
  const merged: GlobalMissingWord[] = [];

  for (let idx = 0; idx < chunks.length; idx += 1) {
    ensureNotAborted(options.signal);
    const chunk = chunks[idx];
    if (idx > 0) await sleep(resolveJitterMs(jitterMinMs, jitterMaxMs), options.signal);
    options.onChunkStart?.(idx + 1, chunks.length);
    const checkId = await createCheckTextRequest(apiKey, chunk.text, options);
    const result = await pollCheckTextResult(apiKey, checkId, options);
    if (result.status === "error") {
      throw new Error(result.error || "Gosslovar processing failed");
    }
    if (result.status !== "done" || !result.result) {
      throw new Error("Gosslovar returned unexpected empty result");
    }
    result.result.missing_words.forEach((word) => {
      const globalStart = chunk.start + word.position;
      const globalEnd = globalStart + word.length;
      merged.push({
        ...word,
        chunkIndex: idx,
        globalStart,
        globalEnd,
      });
    });
  }

  return { text, missingWords: merged };
}
