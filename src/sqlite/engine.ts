import type { Database, Statement } from "sql.js";
import { russianStem } from "../russianStem";
import { normalizeForSearch } from "./normalization";

export interface DictionaryMatch {
  dictionaryCode: string;
  dictionaryTitle: string;
  entryId: number;
  headwordDisplay: string;
  pageStart: number;
  pageEnd: number;
  entryTextClean: string;
}

export type DictionaryStatus = "exact_match" | "wordform_match" | "compound_match" | "no_match";

export interface WordVerificationResult {
  inputWord: string;
  normalizedWord: string;
  lemma: string;
  status: DictionaryStatus;
  uncertain: boolean;
  matches: DictionaryMatch[];
  compoundParts: string[];
  reason: string;
}

export interface TextToken {
  raw: string;
  normalizedRaw: string;
  start: number;
  end: number;
}

let stemIndexPromise: Promise<Map<string, string[]>> | null = null;

function tokenize(text: string): TextToken[] {
  const regex = /[A-Za-zА-Яа-яЁё]+(?:-[A-Za-zА-Яа-яЁё]+)*/g;
  const result: TextToken[] = [];
  let match = regex.exec(text);
  while (match) {
    const raw = match[0];
    const start = match.index;
    const end = start + raw.length;
    result.push({ raw, normalizedRaw: raw.toLowerCase(), start, end });
    match = regex.exec(text);
  }
  return result;
}

function queryExactMatches(db: Database, normalizedWord: string): DictionaryMatch[] {
  const statement = db.prepare(`
    SELECT d.code as dictionary_code, d.title as dictionary_title, e.id as entry_id,
           h.headword_display as headword_display, e.page_start as page_start,
           e.page_end as page_end, e.entry_text_clean as entry_text_clean
    FROM headwords h
    JOIN entries e ON e.id = h.entry_id
    JOIN dictionaries d ON d.id = h.dictionary_id
    WHERE h.headword_norm = ?
    ORDER BY d.code, e.id
  `);
  statement.bind([normalizedWord]);
  const rows: DictionaryMatch[] = [];
  while (statement.step()) {
    const row = statement.getAsObject() as Record<string, string | number>;
    rows.push({
      dictionaryCode: String(row.dictionary_code),
      dictionaryTitle: String(row.dictionary_title),
      entryId: Number(row.entry_id),
      headwordDisplay: String(row.headword_display),
      pageStart: Number(row.page_start),
      pageEnd: Number(row.page_end),
      entryTextClean: String(row.entry_text_clean),
    });
  }
  statement.free();
  return rows;
}

async function buildStemIndex(db: Database): Promise<Map<string, string[]>> {
  const index = new Map<string, Set<string>>();
  const statement: Statement = db.prepare("SELECT DISTINCT headword_norm FROM headwords");
  while (statement.step()) {
    const row = statement.getAsObject() as Record<string, string>;
    const norm = String(row.headword_norm);
    if (!norm) continue;
    const stem = russianStem(norm);
    if (!stem) continue;
    if (!index.has(stem)) index.set(stem, new Set());
    index.get(stem)?.add(norm);
  }
  statement.free();
  const output = new Map<string, string[]>();
  index.forEach((value, key) => output.set(key, Array.from(value)));
  return output;
}

async function getStemIndex(db: Database): Promise<Map<string, string[]>> {
  if (!stemIndexPromise) stemIndexPromise = buildStemIndex(db);
  return stemIndexPromise;
}

async function resolveWordform(
  db: Database,
  normalizedWord: string,
): Promise<{ lemma: string; matches: DictionaryMatch[]; uncertain: boolean }> {
  const stem = russianStem(normalizedWord);
  if (!stem) return { lemma: normalizedWord, matches: [], uncertain: false };
  const stemIndex = await getStemIndex(db);
  const candidates = (stemIndex.get(stem) ?? []).filter((word) => word !== normalizedWord);
  if (!candidates.length) return { lemma: normalizedWord, matches: [], uncertain: false };
  const limited = candidates.slice(0, 6);
  for (const candidate of limited) {
    const matches = queryExactMatches(db, candidate);
    if (matches.length) {
      return { lemma: candidate, matches, uncertain: limited.length > 1 };
    }
  }
  return { lemma: normalizedWord, matches: [], uncertain: false };
}

async function hasWordEvidence(db: Database, word: string): Promise<{ ok: boolean; uncertain: boolean }> {
  const exact = queryExactMatches(db, word);
  if (exact.length) return { ok: true, uncertain: false };
  const wordform = await resolveWordform(db, word);
  return { ok: wordform.matches.length > 0, uncertain: wordform.uncertain };
}

async function resolveCompound(db: Database, normalizedWord: string): Promise<{ parts: string[]; uncertain: boolean }> {
  if (!normalizedWord || normalizedWord.length < 4) return { parts: [], uncertain: false };

  if (normalizedWord.includes("-")) {
    const parts = normalizedWord.split("-").map((p) => p.trim()).filter(Boolean);
    if (parts.length < 2) return { parts: [], uncertain: false };
    let uncertain = false;
    for (const part of parts) {
      const evidence = await hasWordEvidence(db, part);
      if (!evidence.ok) return { parts: [], uncertain: false };
      uncertain = uncertain || evidence.uncertain;
    }
    return { parts, uncertain };
  }

  const memo = new Map<number, { parts: string[]; uncertain: boolean } | null>();
  const minPartLength = 2;

  const walk = async (from: number): Promise<{ parts: string[]; uncertain: boolean } | null> => {
    if (from === normalizedWord.length) return { parts: [], uncertain: false };
    if (memo.has(from)) return memo.get(from) ?? null;
    for (let i = from + minPartLength; i <= normalizedWord.length - minPartLength; i += 1) {
      const part = normalizedWord.slice(from, i);
      const evidence = await hasWordEvidence(db, part);
      if (!evidence.ok) continue;
      const tail = await walk(i);
      if (!tail) continue;
      const found = { parts: [part, ...tail.parts], uncertain: evidence.uncertain || tail.uncertain };
      memo.set(from, found);
      return found;
    }
    memo.set(from, null);
    return null;
  };

  const result = await walk(0);
  if (!result || result.parts.length < 2) return { parts: [], uncertain: false };
  return result;
}

export async function verifyWord(db: Database, rawWord: string): Promise<WordVerificationResult> {
  const normalizedWord = normalizeForSearch(rawWord);
  if (!normalizedWord) {
    return {
      inputWord: rawWord,
      normalizedWord,
      lemma: normalizedWord,
      status: "no_match",
      uncertain: false,
      matches: [],
      compoundParts: [],
      reason: "Пустое слово после нормализации.",
    };
  }

  const exactMatches = queryExactMatches(db, normalizedWord);
  if (exactMatches.length) {
    return {
      inputWord: rawWord,
      normalizedWord,
      lemma: normalizedWord,
      status: "exact_match",
      uncertain: false,
      matches: exactMatches,
      compoundParts: [],
      reason: "Точное совпадение в словарях.",
    };
  }

  const wordform = await resolveWordform(db, normalizedWord);
  if (wordform.matches.length) {
    return {
      inputWord: rawWord,
      normalizedWord,
      lemma: wordform.lemma,
      status: "wordform_match",
      uncertain: wordform.uncertain,
      matches: wordform.matches,
      compoundParts: [],
      reason: wordform.uncertain
        ? "Совпадение найдено через неоднозначную словоформу."
        : "Совпадение найдено через словоформу.",
    };
  }

  const compound = await resolveCompound(db, normalizedWord);
  if (compound.parts.length) {
    return {
      inputWord: rawWord,
      normalizedWord,
      lemma: normalizedWord,
      status: "compound_match",
      uncertain: compound.uncertain,
      matches: [],
      compoundParts: compound.parts,
      reason: "Составное слово: части найдены в словарях.",
    };
  }

  return {
    inputWord: rawWord,
    normalizedWord,
    lemma: normalizedWord,
    status: "no_match",
    uncertain: false,
    matches: [],
    compoundParts: [],
    reason: "Слово не найдено в словарях.",
  };
}

export async function verifyText(db: Database, text: string): Promise<Array<TextToken & { result: WordVerificationResult }>> {
  const tokens = tokenize(text);
  const output: Array<TextToken & { result: WordVerificationResult }> = [];
  for (const token of tokens) {
    const result = await verifyWord(db, token.raw);
    output.push({ ...token, result });
  }
  return output;
}
