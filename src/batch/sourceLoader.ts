import type { CheckJob } from "./types";

const SOURCE_FETCH_TIMEOUT_MS = 15000;
const DEV_PROXY_PATH = "/__source_html";
const SOURCE_PROXY_URL_BUILDERS: Array<(url: string) => string> = [
  (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  (url) => `https://cors.isomorphic-git.org/${url}`,
  (url) => `https://r.jina.ai/http://${url.replace(/^https?:\/\//i, "")}`,
];

export interface LoadSourceHtmlOptions {
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  urlProxyEndpoint?: string;
}

function isLocalDevRuntime(): boolean {
  if (typeof window === "undefined") return false;
  const host = window.location.hostname;
  return host === "localhost" || host === "127.0.0.1";
}

function mergeSignals(signal?: AbortSignal, timeoutMs = SOURCE_FETCH_TIMEOUT_MS): AbortSignal {
  const timeoutSignal =
    typeof AbortSignal !== "undefined" && typeof (AbortSignal as { timeout?: (ms: number) => AbortSignal }).timeout === "function"
      ? (AbortSignal as { timeout: (ms: number) => AbortSignal }).timeout(timeoutMs)
      : undefined;
  if (!signal && timeoutSignal) return timeoutSignal;
  if (!timeoutSignal && !signal) {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), timeoutMs);
    return controller.signal;
  }
  if (!timeoutSignal) return signal as AbortSignal;
  if (!signal) return timeoutSignal;
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener("abort", abort, { once: true });
  timeoutSignal.addEventListener("abort", abort, { once: true });
  return controller.signal;
}

function ensureFetch(fetchImpl?: typeof fetch): typeof fetch {
  const impl = fetchImpl ?? globalThis.fetch;
  if (!impl) throw new Error("Fetch API is not available");
  return impl;
}

async function readProxyResponseText(response: Response): Promise<string> {
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (contentType.includes("application/json")) {
    const payload = (await response.json()) as { html?: unknown };
    if (typeof payload?.html === "string") return payload.html;
    throw new Error("URL_SOURCE_PROXY_ENDPOINT_INVALID_PAYLOAD");
  }
  return await response.text();
}

export async function loadSourceHtml(job: CheckJob, options: LoadSourceHtmlOptions = {}): Promise<string> {
  if (job.sourceType === "file") {
    if (!job.sourceFile) throw new Error("Файл не найден в задаче.");
    return await job.sourceFile.text();
  }

  const fetchImpl = ensureFetch(options.fetchImpl);

  if (options.urlProxyEndpoint) {
    try {
      const mergedSignal = mergeSignals(options.signal, SOURCE_FETCH_TIMEOUT_MS);
      const response = await fetchImpl(options.urlProxyEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: job.sourceValue }),
        signal: mergedSignal,
        credentials: "omit",
      });
      if (!response.ok) {
        throw new Error(`URL_SOURCE_PROXY_ENDPOINT_HTTP_${response.status}`);
      }
      const text = await readProxyResponseText(response);
      if (!text.trim()) throw new Error("URL_SOURCE_PROXY_ENDPOINT_EMPTY");
      return text;
    } catch (error) {
      const message = (error as Error)?.message ?? "";
      if (message.includes("The operation was aborted") || message.includes("signal is aborted")) {
        throw new Error("URL_SOURCE_TIMEOUT");
      }
      // Continue with local/browser fallbacks only when explicit proxy endpoint failed.
      // This keeps local dev usable if endpoint is temporarily unavailable.
    }
  }

  if (isLocalDevRuntime()) {
    try {
      const mergedSignal = mergeSignals(options.signal, SOURCE_FETCH_TIMEOUT_MS);
      const devProxyUrl = `${DEV_PROXY_PATH}?url=${encodeURIComponent(job.sourceValue)}`;
      const devProxyResponse = await fetchImpl(devProxyUrl, { signal: mergedSignal, credentials: "omit" });
      if (!devProxyResponse.ok) {
        throw new Error(`DEV_PROXY_HTTP_${devProxyResponse.status}`);
      }
      const devProxyText = await devProxyResponse.text();
      if (!devProxyText.trim()) throw new Error("DEV_PROXY_EMPTY");
      return devProxyText;
    } catch {
      // Fall back to browser-side loading paths when local dev proxy fails.
    }
  }

  try {
    const mergedSignal = mergeSignals(options.signal, SOURCE_FETCH_TIMEOUT_MS);
    const response = await fetchImpl(job.sourceValue, { signal: mergedSignal, credentials: "omit" });
    if (!response.ok) {
      throw new Error(`Не удалось загрузить URL (${response.status}).`);
    }
    const text = await response.text();
    return text;
  } catch (error) {
    const message = (error as Error)?.message ?? "";
    if (message.includes("The operation was aborted") || message.includes("signal is aborted")) {
      throw new Error("URL_SOURCE_TIMEOUT");
    }
    if (message.includes("Failed to fetch") || message.includes("Не удалось загрузить URL")) {
      for (let idx = 0; idx < SOURCE_PROXY_URL_BUILDERS.length; idx += 1) {
        const proxyUrl = SOURCE_PROXY_URL_BUILDERS[idx](job.sourceValue);
        try {
          const mergedSignal = mergeSignals(options.signal, SOURCE_FETCH_TIMEOUT_MS);
          const proxyResponse = await fetchImpl(proxyUrl, { signal: mergedSignal, credentials: "omit" });
          if (!proxyResponse.ok) {
            throw new Error(`Proxy HTTP ${proxyResponse.status}`);
          }
          const proxyText = await proxyResponse.text();
          if (!proxyText.trim()) {
            throw new Error("Proxy returned empty payload");
          }
          return proxyText;
        } catch (proxyError) {
          const proxyMessage = (proxyError as Error)?.message ?? "unknown";
          if (proxyMessage.includes("The operation was aborted") || proxyMessage.includes("signal is aborted")) {
            if (options.signal?.aborted) {
              throw new Error("URL_SOURCE_TIMEOUT");
            }
            continue;
          }
        }
      }
      throw new Error("URL_SOURCE_PROXY_FAILED");
    }
    throw error;
  }
}
