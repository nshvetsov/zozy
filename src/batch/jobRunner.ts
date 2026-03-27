import { extractVisibleTextFromHtml } from "../htmlPreview";
import type { Database } from "sql.js";
import type { RuleEntry } from "../rules/domain";
import { verifyText } from "../sqlite/engine";
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

export interface RunCheckJobOptions {
  db: Database;
  fetchImpl?: typeof fetch;
  urlProxyEndpoint?: string;
  norms: JobRunnerNorm[];
  glossaryMap: Map<string, JobRunnerGlossaryEntry>;
  rules: RuleEntry[];
  allowTerms: string[];
  signal?: AbortSignal;
  onProgress?: (label: string) => void;
}

export interface RunCheckJobResult {
  html: string;
  plainText: string;
  violations: JobViolation[];
  checkedWords: JobCheckedWord[];
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

function getReplacements(value: string, glossaryMap: Map<string, JobRunnerGlossaryEntry>): string[] {
  const entry = glossaryMap.get(value.toLowerCase());
  if (!entry) return [];
  const ordered = entry.preferred
    ? [entry.preferred, ...entry.replacements.filter((x) => x.toLowerCase() !== entry.preferred.toLowerCase())]
    : entry.replacements;
  return ordered.slice(0, 3);
}

function resolveMatchingRule(
  normalized: string,
  lemma: string,
  rules: RuleEntry[],
): RuleEntry | null {
  const matches = rules.filter((rule) => {
    if (rule.phrase === normalized) return true;
    if (rule.applyToInflections && lemma && rule.phrase === lemma) return true;
    return false;
  });
  if (!matches.length) return null;
  const deny = matches.find((rule) => rule.mode === "deny");
  if (deny) return deny;
  return matches[0];
}

function isAllowedByBuiltinTerms(normalized: string, allowTerms: string[]): boolean {
  if (allowTerms.includes(normalized)) return true;
  if (!normalized.includes("-")) return false;
  const parts = normalized.split("-");
  return parts.some((part) => allowTerms.includes(part));
}

export async function runCheckJob(
  job: CheckJob,
  options: RunCheckJobOptions,
): Promise<RunCheckJobResult> {
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

  options.onProgress?.("Проверяем текст через локальную базу...");
  const verifiedTokens = await verifyText(options.db, plainText);

  const violations: JobViolation[] = [];
  const checkedWords: JobCheckedWord[] = [];
  const seen = new Set<string>();

  for (const token of verifiedTokens) {
    const normalized = token.result.normalizedWord || token.normalizedRaw;
    if (!normalized || seen.has(`${normalized}:${token.start}:${token.end}`)) continue;
    seen.add(`${normalized}:${token.start}:${token.end}`);
    const matchingRule = resolveMatchingRule(normalized, token.result.lemma, options.rules);
    const allowedByBuiltin = isAllowedByBuiltinTerms(normalized, options.allowTerms);
    const hasLatin = /[A-Za-z]/.test(token.raw);
    const dictionaryAllows = token.result.status !== "no_match";
    const dictionarySummary = token.result.status === "no_match"
      ? "Не найдено в словарях."
      : token.result.status === "compound_match"
        ? `Составное слово (${token.result.compoundParts.join(" + ")}) найдено по частям.`
        : "Найдено в словарях.";
    const ruleSummary = matchingRule
      ? matchingRule.mode === "allow"
        ? "Разрешено по правилу."
        : "Запрещено по правилу."
      : allowedByBuiltin
        ? "Разрешено встроенным списком."
        : "Правила не применялись.";
    const explanation = `${dictionarySummary} ${ruleSummary}`.trim();

    if (matchingRule?.mode === "deny") {
      const violationType: JobViolation["type"] = hasLatin ? "LAT_PROHIBITED" : "CYR_NOT_IN_DICT";
      const norm = getNorm(violationType, options.norms);
      violations.push({
        word: token.raw,
        position: { start: token.start, end: token.end },
        source: "email_text",
        type: violationType,
        risk: getRisk(violationType),
        norm: norm.norm,
        normUrl: norm.url,
        replacements: matchingRule.replacements.length
          ? matchingRule.replacements.slice(0, 3)
          : getReplacements(token.raw, options.glossaryMap),
        explanation,
        uncertain: token.result.uncertain,
      });
      continue;
    }

    if (matchingRule?.mode === "allow" || allowedByBuiltin) {
      checkedWords.push({
        id: `ok-${checkedWords.length + 1}`,
        word: token.raw,
        normalized,
        start: token.start,
        end: token.end,
        statusLabel: matchingRule?.mode === "allow" ? "можно по правилам" : "можно использовать",
        details: explanation,
        uncertain: token.result.uncertain,
      });
      continue;
    }

    if (hasLatin) {
      const norm = getNorm("LAT_PROHIBITED", options.norms);
      violations.push({
        word: token.raw,
        position: { start: token.start, end: token.end },
        source: "email_text",
        type: "LAT_PROHIBITED",
        risk: getRisk("LAT_PROHIBITED"),
        norm: norm.norm,
        normUrl: norm.url,
        replacements: getReplacements(token.raw, options.glossaryMap),
        explanation,
        uncertain: token.result.uncertain,
      });
      continue;
    }

    if (!dictionaryAllows) {
      const norm = getNorm("CYR_NOT_IN_DICT", options.norms);
      violations.push({
        word: token.raw,
        position: { start: token.start, end: token.end },
        source: "email_text",
        type: "CYR_NOT_IN_DICT",
        risk: getRisk("CYR_NOT_IN_DICT"),
        norm: norm.norm,
        normUrl: norm.url,
        replacements: getReplacements(token.raw, options.glossaryMap),
        explanation,
        uncertain: token.result.uncertain,
      });
      continue;
    }

    checkedWords.push({
      id: `ok-${checkedWords.length + 1}`,
      word: token.raw,
      normalized,
      start: token.start,
      end: token.end,
      statusLabel: "можно использовать",
      details: explanation,
      uncertain: token.result.uncertain,
    });
  }

  return { html, plainText, violations, checkedWords };
}
