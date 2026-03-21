import { extractVisibleTextFromHtml } from "../htmlPreview";
import { checkPlainTextWithApi, type GlobalMissingWord } from "../gosslovar/client";
import { loadSourceHtml } from "./sourceLoader";
import type { CheckJob, JobCheckedWord, JobViolation } from "./types";

export interface JobRunnerNorm {
  code: "LAT_PROHIBITED" | "CYR_NOT_IN_DICT" | "TECH_ABBREV";
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
  apiKey: string;
  fetchImpl?: typeof fetch;
  norms: JobRunnerNorm[];
  glossaryMap: Map<string, JobRunnerGlossaryEntry>;
  trademarks: JobRunnerTrademark[];
  chunkSize?: number;
  jitterMinMs?: number;
  jitterMaxMs?: number;
  pollIntervalMs?: number;
  signal?: AbortSignal;
  onProgress?: (label: string) => void;
}

export interface RunCheckJobResult {
  html: string;
  plainText: string;
  violations: JobViolation[];
  checkedWords: JobCheckedWord[];
}

function isLatinWord(value: string): boolean {
  return /^[a-z-]+$/i.test(value);
}

function getNorm(
  type: JobViolation["type"],
  norms: JobRunnerNorm[],
): { norm: string; url?: string } {
  const item = norms.find((norm) => norm.code === type);
  return item ? { norm: item.norm, url: item.url } : { norm: "Норма не указана" };
}

function getRisk(type: JobViolation["type"]): JobViolation["risk"] {
  if (type === "LAT_PROHIBITED") return "HIGH";
  if (type === "CYR_NOT_IN_DICT") return "MEDIUM";
  return "LOW";
}

function isTrademarkToken(token: string, trademarks: JobRunnerTrademark[]): boolean {
  return trademarks.some((entry) => {
    const name = entry.name.toLowerCase();
    if (name === token) return true;
    if (token.includes("-")) return token.split("-").includes(name);
    return false;
  });
}

function getReplacements(value: string, glossaryMap: Map<string, JobRunnerGlossaryEntry>): string[] {
  const entry = glossaryMap.get(value.toLowerCase());
  if (!entry) return [];
  const ordered = entry.preferred
    ? [entry.preferred, ...entry.replacements.filter((x) => x.toLowerCase() !== entry.preferred.toLowerCase())]
    : entry.replacements;
  return ordered.slice(0, 3);
}

function mapApiMissingWordsToViolations(
  words: GlobalMissingWord[],
  text: string,
  norms: JobRunnerNorm[],
  glossaryMap: Map<string, JobRunnerGlossaryEntry>,
): JobViolation[] {
  return words
    .filter((word) => word.globalStart >= 0 && word.globalEnd <= text.length)
    .map((word) => {
      const type: JobViolation["type"] = isLatinWord(word.word) ? "LAT_PROHIBITED" : "CYR_NOT_IN_DICT";
      const norm = getNorm(type, norms);
      return {
        word: word.word,
        position: { start: word.globalStart, end: word.globalEnd },
        source: "email_text",
        type,
        risk: getRisk(type),
        norm: norm.norm,
        normUrl: norm.url,
        replacements: getReplacements(word.word, glossaryMap),
      };
    });
}

function tokenize(text: string): Array<{ raw: string; normalized: string; start: number; end: number }> {
  const regex = /[A-Za-zА-Яа-яЁё]+(?:-[A-Za-zА-Яа-яЁё]+)*/g;
  const result: Array<{ raw: string; normalized: string; start: number; end: number }> = [];
  let match: RegExpExecArray | null = regex.exec(text);
  while (match) {
    const raw = match[0];
    const start = match.index;
    const end = start + raw.length;
    result.push({ raw, normalized: raw.toLowerCase(), start, end });
    match = regex.exec(text);
  }
  return result;
}

function buildCheckedWords(text: string, violations: JobViolation[]): JobCheckedWord[] {
  const violationRanges = violations.map((item) => item.position).sort((a, b) => a.start - b.start);
  const seen = new Set<string>();
  return tokenize(text)
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

function filterViolationsByUserRules(
  violations: JobViolation[],
  glossaryMap: Map<string, JobRunnerGlossaryEntry>,
  trademarks: JobRunnerTrademark[],
): JobViolation[] {
  return violations.filter((violation) => {
    const normalized = violation.word.toLowerCase();
    if (glossaryMap.has(normalized)) return false;
    if (isTrademarkToken(normalized, trademarks)) return false;
    return true;
  });
}

export async function runCheckJob(
  job: CheckJob,
  options: RunCheckJobOptions,
): Promise<RunCheckJobResult> {
  const html = job.html || (await loadSourceHtml(job, options.signal));
  const plainText = extractVisibleTextFromHtml(html);
  if (!plainText.trim()) {
    return { html, plainText, violations: [], checkedWords: [] };
  }

  const apiResult = await checkPlainTextWithApi(options.apiKey, plainText, {
    fetchImpl: options.fetchImpl,
    chunkSize: options.chunkSize ?? 650,
    jitterMinMs: options.jitterMinMs ?? 100,
    jitterMaxMs: options.jitterMaxMs ?? 500,
    pollIntervalMs: options.pollIntervalMs ?? 3000,
    signal: options.signal,
    onChunkStart: (chunkIndex, totalChunks) => {
      options.onProgress?.(`Проверка через API: чанк ${chunkIndex}/${totalChunks}`);
    },
  });

  const mapped = mapApiMissingWordsToViolations(
    apiResult.missingWords,
    apiResult.text,
    options.norms,
    options.glossaryMap,
  );
  const violations = filterViolationsByUserRules(mapped, options.glossaryMap, options.trademarks);
  const checkedWords = buildCheckedWords(apiResult.text, violations);
  return { html, plainText: apiResult.text, violations, checkedWords };
}
