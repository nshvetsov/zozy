import {
  collectPlainTextViolations,
  filterViolationsByGlossaryAndTrademarks,
  tokenizeText,
  type PlainTextViolation,
} from "../check/textCheck";
import type { CyrillicSqliteLookup } from "../dictionary/sqliteDictionary";
import { extractVisibleTextFromHtml } from "../htmlPreview";
import { loadSourceHtml } from "./sourceLoader";
import type { CheckJob, JobCheckedWord, JobViolation } from "./types";

export interface JobRunnerNorm {
  code: "LAT_PROHIBITED" | "CYR_NOT_IN_DICT";
  norm: string;
  url?: string;
}

export interface JobRunnerGlossaryEntry {
  original: string;
  replacements: string[];
  preferred: string;
  type: "LAT_PROHIBITED" | "CYR_NOT_IN_DICT";
}

export interface JobRunnerTrademark {
  name: string;
}

export interface RunCheckJobOptions {
  fetchImpl?: typeof fetch;
  urlProxyEndpoint?: string;
  norms: JobRunnerNorm[];
  glossaryMap: Map<string, JobRunnerGlossaryEntry>;
  trademarks: JobRunnerTrademark[];
  cyrillicLookup: CyrillicSqliteLookup;
  signal?: AbortSignal;
  onProgress?: (label: string) => void;
}

export interface RunCheckJobResult {
  html: string;
  plainText: string;
  violations: JobViolation[];
  checkedWords: JobCheckedWord[];
}

function toJobViolation(v: PlainTextViolation): JobViolation {
  return {
    word: v.word,
    position: v.position,
    source: v.source,
    type: v.type,
    risk: v.risk,
    norm: v.norm,
    normUrl: v.normUrl,
    replacements: v.replacements,
  };
}

function buildCheckedWords(text: string, violations: JobViolation[]): JobCheckedWord[] {
  const violationRanges = violations.map((item) => item.position).sort((a, b) => a.start - b.start);
  const seen = new Set<string>();
  return tokenizeText(text)
    .filter((token) => {
      const intersectsViolation = violationRanges.some(
        (range) => token.start < range.end && token.end > range.start,
      );
      return !intersectsViolation;
    })
    .filter((token) => {
      if (seen.has(token.normalized)) return false;
      seen.add(token.normalized);
      return true;
    })
    .map((token, idx) => ({
      id: `ok-${idx + 1}`,
      word: token.raw,
      normalized: token.normalized,
      start: token.start,
      end: token.end,
    }));
}

export async function runCheckJob(job: CheckJob, options: RunCheckJobOptions): Promise<RunCheckJobResult> {
  options.onProgress?.("Извлечение текста…");
  const html =
    job.html ||
    (await loadSourceHtml(job, {
      signal: options.signal,
      fetchImpl: options.fetchImpl,
      urlProxyEndpoint: options.urlProxyEndpoint,
    }));
  const plainText = extractVisibleTextFromHtml(html);
  if (!plainText.trim()) {
    if (job.sourceType === "url") {
      throw new Error("URL_SOURCE_EMPTY_TEXT");
    }
    return { html, plainText, violations: [], checkedWords: [] };
  }

  options.onProgress?.("Проверка по словарю…");
  const rawViolations = collectPlainTextViolations(plainText, {
    norms: options.norms,
    glossaryMap: options.glossaryMap,
    trademarks: options.trademarks,
    cyrillicLookup: options.cyrillicLookup,
  });
  const mapped = rawViolations.map(toJobViolation);
  const violations = filterViolationsByGlossaryAndTrademarks(mapped, options.glossaryMap, options.trademarks);
  const checkedWords = buildCheckedWords(plainText, violations);
  return { html, plainText, violations, checkedWords };
}
