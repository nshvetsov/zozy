export interface RuleEntry {
  phrase: string;
  mode: "allow" | "deny";
  reason: string;
  replacements: string[];
}

export interface RuleGlossaryEntry {
  original: string;
  replacements: string[];
  preferred: string;
  type: "LAT_PROHIBITED" | "CYR_NOT_IN_DICT";
}

export interface RulesContext {
  denyGlossary: RuleGlossaryEntry[];
  allowTerms: string[];
}

const LATIN_TO_CYRILLIC_LOOKALIKES: Record<string, string> = {
  A: "А",
  B: "В",
  C: "С",
  E: "Е",
  H: "Н",
  K: "К",
  M: "М",
  O: "О",
  P: "Р",
  T: "Т",
  X: "Х",
  Y: "У",
  a: "а",
  c: "с",
  e: "е",
  o: "о",
  p: "р",
  x: "х",
  y: "у",
};

export function normalizeRulePhrase(raw: string): string {
  const trimmed = raw.trim();
  const hasCyrillic = /[а-яё]/i.test(trimmed);
  const hasLatin = /[a-z]/i.test(trimmed);
  if (!hasCyrillic || !hasLatin) return trimmed.toLowerCase();
  const unified = trimmed
    .split("")
    .map((ch) => LATIN_TO_CYRILLIC_LOOKALIKES[ch] ?? ch)
    .join("");
  return unified.toLowerCase();
}

export function normalizeRuleEntry(value: Partial<RuleEntry>): RuleEntry | null {
  const phrase = normalizeRulePhrase(value.phrase ?? "");
  if (!phrase) return null;
  const mode: RuleEntry["mode"] = value.mode === "deny" ? "deny" : "allow";
  const reason = (value.reason ?? "").trim();
  const replacements = mode === "deny" ? (value.replacements ?? []).slice(0, 5) : [];
  return { phrase, mode, reason, replacements };
}

export function buildRulesContext(rules: RuleEntry[]): RulesContext {
  const denyGlossary: RuleGlossaryEntry[] = [];
  const allowTerms: string[] = [];
  rules.forEach((rule) => {
    const phrase = rule.phrase.trim().toLowerCase();
    if (!phrase) return;
    if (rule.mode === "allow") {
      allowTerms.push(phrase);
      return;
    }
    const preferred = rule.replacements[0] ?? "";
    const type: RuleGlossaryEntry["type"] = /[a-z]/i.test(phrase) ? "LAT_PROHIBITED" : "CYR_NOT_IN_DICT";
    denyGlossary.push({
      original: phrase,
      preferred,
      replacements: rule.replacements,
      type,
    });
  });
  return { denyGlossary, allowTerms };
}
