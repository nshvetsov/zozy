import type { CyrillicSqliteLookup } from "../dictionary/sqliteDictionary";
import { normalizeForSearch } from "../dictionary/normalizeForSearch";

export interface TextCheckNorm {
  code: "LAT_PROHIBITED" | "CYR_NOT_IN_DICT";
  norm: string;
  url?: string;
}

export interface TextCheckGlossaryEntry {
  original: string;
  replacements: string[];
  preferred: string;
  type: "LAT_PROHIBITED" | "CYR_NOT_IN_DICT";
}

export interface TextCheckTrademark {
  name: string;
}

export interface TextToken {
  raw: string;
  normalized: string;
  start: number;
  end: number;
}

export interface PhraseMatch {
  phrase: string;
  startTokenIdx: number;
  endTokenIdx: number;
  start: number;
  end: number;
}

export interface PlainTextViolation {
  word: string;
  position: { start: number; end: number };
  source: "email_text";
  type: "LAT_PROHIBITED" | "CYR_NOT_IN_DICT";
  risk: "HIGH" | "MEDIUM";
  norm: string;
  normUrl?: string;
  replacements: string[];
}

export function tokenizeText(text: string): TextToken[] {
  const regex = /[A-Za-zА-Яа-яЁё]+(?:-[A-Za-zА-Яа-яЁё]+)*/g;
  const result: TextToken[] = [];
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

export function matchPhrasesLongest(tokens: TextToken[], phrases: string[]): PhraseMatch[] {
  const normalizedPhrases = phrases
    .map((phrase) => phrase.trim().toLowerCase().split(/\s+/))
    .filter((words) => words.length > 1)
    .sort((a, b) => b.length - a.length);

  const matches: PhraseMatch[] = [];
  let i = 0;
  while (i < tokens.length) {
    let chosen: PhraseMatch | null = null;
    for (const phraseWords of normalizedPhrases) {
      const end = i + phraseWords.length - 1;
      if (end >= tokens.length) continue;
      let ok = true;
      for (let k = 0; k < phraseWords.length; k += 1) {
        if (tokens[i + k]!.normalized !== phraseWords[k]) {
          ok = false;
          break;
        }
      }
      if (ok) {
        chosen = {
          phrase: phraseWords.join(" "),
          startTokenIdx: i,
          endTokenIdx: end,
          start: tokens[i]!.start,
          end: tokens[end]!.end,
        };
        break;
      }
    }
    if (chosen) {
      matches.push(chosen);
      i = chosen.endTokenIdx + 1;
    } else {
      i += 1;
    }
  }
  return matches;
}

function isTrademarkPhrase(
  match: PhraseMatch,
  tokens: TextToken[],
  trademarks: TextCheckTrademark[],
): boolean {
  const phrase = tokens
    .slice(match.startTokenIdx, match.endTokenIdx + 1)
    .map((token) => token.normalized)
    .join(" ");
  return trademarks.some((item) => item.name.toLowerCase() === phrase);
}

export function isTrademarkToken(token: string, trademarks: TextCheckTrademark[]): boolean {
  return trademarks.some((entry) => {
    const name = entry.name.toLowerCase();
    if (name === token) return true;
    if (token.includes("-")) return token.split("-").includes(name);
    return false;
  });
}

export function filterViolationsByGlossaryAndTrademarks<V extends { word: string }>(
  violations: V[],
  glossaryMap: Map<string, TextCheckGlossaryEntry>,
  trademarks: TextCheckTrademark[],
): V[] {
  return violations.filter((violation) => {
    const normalized = violation.word.toLowerCase();
    if (glossaryMap.has(normalized)) return false;
    if (isTrademarkToken(normalized, trademarks)) return false;
    return true;
  });
}

export function isCyrillicWordToken(value: string): boolean {
  return /^[а-яё-]+$/i.test(value);
}

export function isLatinWordToken(value: string): boolean {
  return /^[a-z-]+$/i.test(value);
}

function getNorm(type: PlainTextViolation["type"], norms: TextCheckNorm[]): { norm: string; url?: string } {
  const item = norms.find((norm) => norm.code === type);
  return item ? { norm: item.norm, url: item.url } : { norm: "Норма не указана" };
}

function getRisk(type: PlainTextViolation["type"]): PlainTextViolation["risk"] {
  return type === "LAT_PROHIBITED" ? "HIGH" : "MEDIUM";
}

function getReplacements(value: string, glossaryMap: Map<string, TextCheckGlossaryEntry>): string[] {
  const entry = glossaryMap.get(value.toLowerCase());
  if (!entry) return [];
  const ordered = entry.preferred
    ? [entry.preferred, ...entry.replacements.filter((x) => x.toLowerCase() !== entry.preferred.toLowerCase())]
    : entry.replacements;
  return ordered.slice(0, 3);
}

/**
 * Scan plain text for LAT/CYR violations (batch + OCR). Latin tokens are flagged unless trademark-allowed; Cyrillic uses SQLite-backed lookup.
 */
export function collectPlainTextViolations(
  plainText: string,
  ctx: {
    norms: TextCheckNorm[];
    glossaryMap: Map<string, TextCheckGlossaryEntry>;
    trademarks: TextCheckTrademark[];
    cyrillicLookup: CyrillicSqliteLookup;
  },
): PlainTextViolation[] {
  const tokens = tokenizeText(plainText);
  const phrasePool = [
    ...Array.from(ctx.glossaryMap.keys()).filter((phrase) => phrase.includes(" ")),
    ...ctx.trademarks.map((item) => item.name.toLowerCase()).filter((name) => name.includes(" ")),
  ];
  const phraseMatches = matchPhrasesLongest(tokens, phrasePool);
  const consumedIndexes = new Set<number>();
  const violations: PlainTextViolation[] = [];

  for (const match of phraseMatches) {
    for (let i = match.startTokenIdx; i <= match.endTokenIdx; i += 1) consumedIndexes.add(i);
    const phraseText = plainText.slice(match.start, match.end);
    if (isTrademarkPhrase(match, tokens, ctx.trademarks)) continue;
    const type: PlainTextViolation["type"] = "LAT_PROHIBITED";
    const norm = getNorm(type, ctx.norms);
    violations.push({
      word: phraseText,
      position: { start: match.start, end: match.end },
      source: "email_text",
      type,
      risk: getRisk(type),
      norm: norm.norm,
      normUrl: norm.url,
      replacements: getReplacements(phraseText, ctx.glossaryMap),
    });
  }

  const cyrillicNorms: string[] = [];
  tokens.forEach((token, idx) => {
    if (consumedIndexes.has(idx)) return;
    if (!isCyrillicWordToken(token.normalized)) return;
    cyrillicNorms.push(normalizeForSearch(token.raw));
  });
  const allowedCyrillic = ctx.cyrillicLookup.allowsNormalizedBatch(cyrillicNorms);

  tokens.forEach((token, idx) => {
    if (consumedIndexes.has(idx)) return;
    if (isTrademarkToken(token.normalized, ctx.trademarks)) return;

    if (isCyrillicWordToken(token.normalized)) {
      const w = normalizeForSearch(token.raw);
      if (!w || allowedCyrillic.has(w)) return;
      const norm = getNorm("CYR_NOT_IN_DICT", ctx.norms);
      violations.push({
        word: token.raw,
        position: { start: token.start, end: token.end },
        source: "email_text",
        type: "CYR_NOT_IN_DICT",
        risk: getRisk("CYR_NOT_IN_DICT"),
        norm: norm.norm,
        normUrl: norm.url,
        replacements: getReplacements(token.raw, ctx.glossaryMap),
      });
      return;
    }

    if (isLatinWordToken(token.normalized)) {
      const type: PlainTextViolation["type"] = "LAT_PROHIBITED";
      const norm = getNorm(type, ctx.norms);
      violations.push({
        word: token.raw,
        position: { start: token.start, end: token.end },
        source: "email_text",
        type,
        risk: getRisk(type),
        norm: norm.norm,
        normUrl: norm.url,
        replacements: getReplacements(token.raw, ctx.glossaryMap),
      });
    }
  });

  return violations;
}
